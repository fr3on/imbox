import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { now, uid } from "../db";
import { LIMITS, normalizeWorkflow, type Action, type WorkflowDef } from "../../shared/workflows";
import { parseList, previewMatches, type WorkflowRow } from "../workflows/run";
import { checkThread, checkup, recentThreads, suggestions } from "../workflows/insights";

/** Managing workflows: rules that act on mail on their own. Everything here is behind the owner's login. */
const workflows = new Hono<AppEnv>();

interface RunRow {
  id: string;
  workflow_id: string;
  thread_id: string;
  status: string;
  summary: string;
  subject: string;
  created_at: number;
}

function serialize(w: WorkflowRow, extra: { today: number; total: number; recent: RunRow[] }) {
  return {
    id: w.id,
    name: w.name,
    enabled: !!w.enabled,
    trigger: w.trigger,
    trigger_days: w.trigger_days,
    match: w.match,
    conditions: parseList(w.conditions),
    actions: parseList(w.actions),
    account_ids: parseList<string>(w.account_ids),
    daily_limit: w.daily_limit,
    last_run_at: w.last_run_at,
    created_at: w.created_at,
    runs_today: extra.today,
    runs_total: extra.total,
    recent: extra.recent,
  };
}

async function ownedWorkflow(c: Context<AppEnv>, id: string): Promise<WorkflowRow | null> {
  return c.env.DB.prepare(`SELECT * FROM workflows WHERE id = ? AND user_id = ?`).bind(id, c.get("user").id).first<WorkflowRow>();
}

async function describeAll(c: Context<AppEnv>, list: WorkflowRow[]) {
  const since = now() - 24 * 3600_000;
  const out = [];
  for (const w of list) {
    const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ? AND created_at > ?`).bind(w.id, since).first<{ n: number }>();
    const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ?`).bind(w.id).first<{ n: number }>();
    const recent = await c.env.DB.prepare(`SELECT id, workflow_id, thread_id, status, summary, subject, created_at FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 3`).bind(w.id).all<RunRow>();
    out.push(serialize(w, { today: today?.n ?? 0, total: total?.n ?? 0, recent: recent.results }));
  }
  return out;
}

/** The user's own mailboxes, never one lent to an outside agent. Null when the list holds anything else. */
async function usableAccountIds(c: Context<AppEnv>, wanted: string[]): Promise<string[] | null> {
  if (!wanted.length) return [];
  const rows = await c.env.DB.prepare(`SELECT a.id FROM accounts a WHERE a.user_id = ? AND NOT EXISTS (SELECT 1 FROM agent_mailboxes m WHERE m.account_id = a.id)`).bind(c.get("user").id).all<{ id: string }>();
  const ok = new Set(rows.results.map((r) => r.id));
  return wanted.every((i) => ok.has(i)) ? wanted : null;
}

/** Labels and collections the actions name must be the user's own. */
async function ownsTargets(c: Context<AppEnv>, actions: Action[]): Promise<boolean> {
  for (const a of actions) {
    if (a.type !== "label" && a.type !== "collection") continue;
    const table = a.type === "label" ? "labels" : "collections";
    const r = await c.env.DB.prepare(`SELECT 1 AS ok FROM ${table} x JOIN accounts a ON a.id = x.account_id WHERE x.id = ? AND a.user_id = ?`).bind(a.id, c.get("user").id).first();
    if (!r) return false;
  }
  return true;
}

/** `draft`: a workflow that is switched off may be unfinished, so a name alone is enough and half-filled rows are dropped. Switching one on needs it whole. */
async function checked(c: Context<AppEnv>, raw: unknown, draft = false): Promise<{ def: WorkflowDef } | { res: Response }> {
  const v = normalizeWorkflow(raw, { draft });
  if ("error" in v) return { res: c.json({ error: "invalid_workflow", message: v.error }, 400) };
  const ids = await usableAccountIds(c, v.ok.account_ids);
  if (ids === null) return { res: c.json({ error: "invalid_mailboxes", message: "Pick from your own mailboxes." }, 400) };
  if (!(await ownsTargets(c, v.ok.actions))) return { res: c.json({ error: "invalid_target", message: "That label or collection is not yours." }, 400) };
  return { def: { ...v.ok, account_ids: ids } };
}

workflows.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM workflows WHERE user_id = ? ORDER BY created_at`).bind(c.get("user").id).all<WorkflowRow>();
  return c.json(await describeAll(c, rows.results));
});

workflows.post("/", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM workflows WHERE user_id = ?`).bind(c.get("user").id).first<{ n: number }>();
  if ((n?.n ?? 0) >= LIMITS.workflows) return c.json({ error: "too_many", message: `You can have up to ${LIMITS.workflows} workflows.` }, 400);
  const r = await checked(c, b, b.enabled !== true);
  if ("res" in r) return r.res;
  const d = r.def;
  const t = now();
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO workflows (id, user_id, name, enabled, trigger, trigger_days, match, conditions, actions, account_ids, daily_limit, watermark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, c.get("user").id, d.name, b.enabled === true ? 1 : 0, d.trigger, d.trigger_days, d.match, JSON.stringify(d.conditions), JSON.stringify(d.actions), JSON.stringify(d.account_ids), d.daily_limit, t, t, t)
    .run();
  return c.json((await describeAll(c, [(await ownedWorkflow(c, id))!]))[0]);
});

/** Try a workflow on the latest mail without doing anything: which conversations it would pick out. */
workflows.post("/preview", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const r = await checked(c, b);
  if ("res" in r) return r.res;
  return c.json(await previewMatches(c.env, c.get("user").id, r.def));
});

workflows.put("/:id", async (c) => {
  const w = await ownedWorkflow(c, c.req.param("id"));
  if (!w) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  let enabled = w.enabled;
  let watermark = w.watermark;
  if (typeof b.enabled === "boolean") {
    if (b.enabled && !w.enabled) watermark = now(); // it starts with the next email, never the backlog
    enabled = b.enabled ? 1 : 0;
  }
  // A body of just { enabled } switches it on or off; anything else is the whole workflow again.
  const whole = Object.keys(b).some((k) => k !== "enabled");
  let d: WorkflowDef = {
    name: w.name,
    trigger: w.trigger,
    trigger_days: w.trigger_days,
    match: w.match,
    conditions: parseList(w.conditions),
    actions: parseList(w.actions),
    account_ids: parseList<string>(w.account_ids),
    daily_limit: w.daily_limit,
  };
  if (!whole && enabled && !w.enabled) {
    // Switching it on: it has to be whole.
    const r = await checked(c, d, false);
    if ("res" in r) return r.res;
  }
  if (whole) {
    const r = await checked(c, { ...d, ...b }, !enabled);
    if ("res" in r) return r.res;
    d = r.def;
  }
  await c.env.DB.prepare(
    `UPDATE workflows SET name = ?, enabled = ?, trigger = ?, trigger_days = ?, match = ?, conditions = ?, actions = ?, account_ids = ?, daily_limit = ?, watermark = ?, updated_at = ? WHERE id = ?`
  )
    .bind(d.name, enabled, d.trigger, d.trigger_days, d.match, JSON.stringify(d.conditions), JSON.stringify(d.actions), JSON.stringify(d.account_ids), d.daily_limit, watermark, now(), w.id)
    .run();
  return c.json((await describeAll(c, [(await ownedWorkflow(c, w.id))!]))[0]);
});

workflows.delete("/:id", async (c) => {
  const w = await ownedWorkflow(c, c.req.param("id"));
  if (!w) return c.json({ error: "not_found" }, 404);
  await c.env.DB.batch([c.env.DB.prepare(`DELETE FROM workflow_runs WHERE workflow_id = ?`).bind(w.id), c.env.DB.prepare(`DELETE FROM workflows WHERE id = ?`).bind(w.id)]);
  return c.json({ ok: true });
});

/** What the person keeps doing by hand that a workflow could do. */
workflows.get("/suggestions", async (c) => c.json({ suggestions: await suggestions(c.env, c.get("user").id) }));

/** What is wrong with the workflows they have: duplicates, clashes, steps that point at something deleted, ones that never match. */
workflows.get("/checkup", async (c) => c.json({ notes: await checkup(c.env, c.get("user").id) }));

/** The latest conversations, to pick one to test a workflow against. */
workflows.get("/recent", async (c) => c.json({ threads: await recentThreads(c.env, c.get("user").id) }));

/** Whether a workflow would act on this conversation, and for each condition whether it holds. Nothing is changed. */
workflows.post("/:id/check", async (c) => {
  const w = await ownedWorkflow(c, c.req.param("id"));
  if (!w) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const r = await checkThread(c.env, w, c.get("user").id, String(b.thread_id ?? ""));
  if (!r) return c.json({ error: "not_found", message: "That conversation isn't there." }, 404);
  return c.json(r);
});

/** What a workflow did, newest first. */
workflows.get("/:id/runs", async (c) => {
  const w = await ownedWorkflow(c, c.req.param("id"));
  if (!w) return c.json({ error: "not_found" }, 404);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 40));
  const rows = await c.env.DB.prepare(`SELECT id, workflow_id, thread_id, status, summary, subject, created_at FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ?`).bind(w.id, limit).all<RunRow>();
  return c.json({ runs: rows.results });
});

export default workflows;
