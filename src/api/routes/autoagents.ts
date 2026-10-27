import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { now, uid } from "../db";
import { z } from "zod";
import { loadAiConfig, makeProvider } from "../ai/provider";
import { clampLimit, MAX_INSTRUCTIONS, parseAccountIds, previewPrompt, type AutoAgent } from "../autoagent";

/** Managing the agents that work a mailbox on their own. Everything here is behind the owner's login. */
const autoAgents = new Hono<AppEnv>();

const MODES = ["draft", "auto"] as const;

interface RunRow {
  id: string;
  agent_id: string;
  thread_id: string;
  status: string;
  summary: string;
  draft_id: string | null;
  subject: string;
  from_email: string;
  created_at: number;
}

function serialize(a: AutoAgent, extra: { today: number; recent: RunRow[]; memoryCount?: number }) {
  return {
    id: a.id,
    name: a.name,
    instructions: a.instructions,
    account_ids: parseAccountIds(a.account_ids),
    mode: a.mode,
    enabled: !!a.enabled,
    only_screened_in: !!a.only_screened_in,
    senders: a.senders,
    daily_limit: a.daily_limit,
    last_run_at: a.last_run_at,
    created_at: a.created_at,
    replies_today: extra.today,
    recent: extra.recent,
    memory_count: extra.memoryCount ?? 0,
  };
}

async function ownedAgent(c: Context<AppEnv>, id: string): Promise<AutoAgent | null> {
  return c.env.DB.prepare(`SELECT * FROM auto_agents WHERE id = ? AND user_id = ?`).bind(id, c.get("user").id).first<AutoAgent>();
}

/** The mailboxes an agent may be given: the user's own, and never one already lent to an outside agent. */
async function usableAccountIds(c: Context<AppEnv>, wanted: unknown): Promise<string[] | null> {
  if (!Array.isArray(wanted)) return null;
  const ids = [...new Set(wanted.filter((x): x is string => typeof x === "string"))];
  if (!ids.length) return [];
  const rows = await c.env.DB.prepare(
    `SELECT a.id FROM accounts a WHERE a.user_id = ? AND NOT EXISTS (SELECT 1 FROM agent_mailboxes m WHERE m.account_id = a.id)`
  )
    .bind(c.get("user").id)
    .all<{ id: string }>();
  const ok = new Set(rows.results.map((r) => r.id));
  return ids.every((i) => ok.has(i)) ? ids : null;
}

async function describeAll(c: Context<AppEnv>, agents: AutoAgent[]) {
  const since = now() - 24 * 3600_000;
  const out = [];
  for (const a of agents) {
    const today = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM auto_agent_runs WHERE agent_id = ? AND status IN ('replied', 'drafted') AND created_at > ?`).bind(a.id, since).first<{ n: number }>();
    const recent = await c.env.DB.prepare(`SELECT id, agent_id, thread_id, status, summary, draft_id, subject, from_email, created_at FROM auto_agent_runs WHERE agent_id = ? AND status <> 'skipped' AND status <> 'running' ORDER BY created_at DESC LIMIT 3`).bind(a.id).all<RunRow>();
    const mem = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM auto_agent_memory WHERE agent_id = ?`).bind(a.id).first<{ n: number }>().catch(() => null);
    out.push(serialize(a, { today: today?.n ?? 0, recent: recent.results, memoryCount: mem?.n ?? 0 }));
  }
  return out;
}

autoAgents.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM auto_agents WHERE user_id = ? ORDER BY created_at`).bind(c.get("user").id).all<AutoAgent>();
  return c.json(await describeAll(c, rows.results));
});

/**
 * "Try it": how an agent with these instructions would answer a sample email. The model is given no tools, so nothing is read, written,
 * organised or sent, and nothing is saved. It is a preview of the wording and of the choice to reply or leave the mail alone.
 */
autoAgents.post("/try", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const sample = String(b.sample ?? "").trim().slice(0, 2000);
  if (!sample) return c.json({ error: "missing_sample", message: "Write a sample email to try it on." }, 400);
  const cfg = await loadAiConfig(c.env, c.get("user").id);
  if (!cfg) return c.json({ error: "ai_not_configured", message: "Set up an AI provider in Settings → AI first." }, 400);
  const user = c.get("user");
  const res = await makeProvider(cfg).complete({
    feature: "agents",
    system: previewPrompt(String(b.name ?? "").trim().slice(0, 60) || "Agent", String(b.instructions ?? "").slice(0, MAX_INSTRUCTIONS), user.name || user.email),
    messages: [{ role: "user", content: `<email>\n${sample}\n</email>` }],
    schema: { name: "agent_preview", zod: z.object({ action: z.enum(["reply", "leave"]), text: z.string() }) },
    maxTokens: 700,
    effort: "low",
  });
  if (res.refused || !res.json) return c.json({ action: "leave", text: "The model declined to answer this one." });
  return c.json({ action: res.json.action, text: res.json.text.slice(0, 2000) });
});

autoAgents.post("/", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) return c.json({ error: "missing_name", message: "Give the agent a name." }, 400);
  const ids = await usableAccountIds(c, b.account_ids ?? []);
  if (ids === null) return c.json({ error: "invalid_mailboxes", message: "Pick from your own mailboxes." }, 400);
  const mode = MODES.includes(b.mode as never) ? (b.mode as string) : "draft";
  const t = now();
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO auto_agents (id, user_id, name, instructions, account_ids, mode, enabled, only_screened_in, senders, daily_limit, watermark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, c.get("user").id, name, String(b.instructions ?? "").slice(0, MAX_INSTRUCTIONS), JSON.stringify(ids), mode, b.only_screened_in === false ? 0 : 1, String(b.senders ?? "").slice(0, 1000), clampLimit(b.daily_limit), t, t, t)
    .run();
  const a = (await ownedAgent(c, id))!;
  return c.json((await describeAll(c, [a]))[0]);
});

autoAgents.put("/:id", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const next = { ...a };
  if (typeof b.name === "string") {
    next.name = b.name.trim().slice(0, 60);
    if (!next.name) return c.json({ error: "missing_name", message: "Give the agent a name." }, 400);
  }
  if (typeof b.instructions === "string") next.instructions = b.instructions.slice(0, MAX_INSTRUCTIONS);
  if (b.account_ids !== undefined) {
    const ids = await usableAccountIds(c, b.account_ids);
    if (ids === null) return c.json({ error: "invalid_mailboxes", message: "Pick from your own mailboxes." }, 400);
    next.account_ids = JSON.stringify(ids);
  }
  if (b.mode !== undefined) {
    if (!MODES.includes(b.mode as never)) return c.json({ error: "invalid_mode" }, 400);
    next.mode = b.mode as AutoAgent["mode"];
  }
  if (typeof b.only_screened_in === "boolean") next.only_screened_in = b.only_screened_in ? 1 : 0;
  if (typeof b.senders === "string") next.senders = b.senders.slice(0, 1000);
  if (b.daily_limit !== undefined) next.daily_limit = clampLimit(b.daily_limit);
  if (typeof b.enabled === "boolean") {
    if (b.enabled && !a.enabled) {
      if (!(await loadAiConfig(c.env, c.get("user").id))) return c.json({ error: "ai_not_configured", message: "Set up an AI provider in Settings → AI first." }, 400);
      if (!parseAccountIds(next.account_ids).length) return c.json({ error: "no_mailboxes", message: "Choose at least one mailbox for it to watch." }, 400);
      next.watermark = now(); // it starts with the next email, never the backlog
    }
    next.enabled = b.enabled ? 1 : 0;
  }
  await c.env.DB.prepare(
    `UPDATE auto_agents SET name = ?, instructions = ?, account_ids = ?, mode = ?, enabled = ?, only_screened_in = ?, senders = ?, daily_limit = ?, watermark = ?, updated_at = ? WHERE id = ?`
  )
    .bind(next.name, next.instructions, next.account_ids, next.mode, next.enabled, next.only_screened_in, next.senders, next.daily_limit, next.watermark, now(), a.id)
    .run();
  return c.json((await describeAll(c, [(await ownedAgent(c, a.id))!]))[0]);
});

autoAgents.delete("/:id", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM auto_agent_runs WHERE agent_id = ?`).bind(a.id),
    c.env.DB.prepare(`DELETE FROM auto_agent_memory WHERE agent_id = ?`).bind(a.id),
    c.env.DB.prepare(`DELETE FROM auto_agents WHERE id = ?`).bind(a.id),
  ]);
  return c.json({ ok: true });
});

/** What the agent did, and why it left things alone. `?skipped=1` includes the mail it deliberately did not touch. */
autoAgents.get("/:id/runs", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const skipped = c.req.query("skipped") === "1";
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 40));
  const rows = await c.env.DB.prepare(
    `SELECT id, agent_id, thread_id, status, summary, draft_id, subject, from_email, created_at FROM auto_agent_runs WHERE agent_id = ? AND status <> 'running' ${skipped ? "" : "AND status <> 'skipped'"} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(a.id, limit)
    .all<RunRow>();
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM auto_agent_runs WHERE agent_id = ? AND status = 'skipped'`).bind(a.id).first<{ n: number }>();
  return c.json({ runs: rows.results, skipped_count: n?.n ?? 0 });
});

/* ---------- Agent Memory ---------- */
const MAX_AGENT_MEMORIES = 300;
const AGENT_MEMORY_KINDS = ["rule", "faq", "fact", "tone", "contact"] as const;

interface AgentMemoryRow {
  id: string;
  agent_id: string;
  user_id: string;
  kind: string;
  content: string;
  source: string;
  created_at: number;
  updated_at: number;
}

autoAgents.get("/:id/memory", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT id, agent_id, kind, content, source, created_at, updated_at FROM auto_agent_memory WHERE agent_id = ? ORDER BY kind, updated_at DESC`
  )
    .bind(a.id)
    .all<AgentMemoryRow>();
  return c.json(rows.results);
});

autoAgents.post("/:id/memory", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ kind?: string; content?: string }>().catch(() => ({} as Record<string, unknown>));
  const content = typeof b.content === "string" ? b.content.trim().slice(0, 1000) : "";
  if (!content) return c.json({ error: "missing_content", message: "Memory content cannot be empty." }, 400);
  const kind = AGENT_MEMORY_KINDS.includes(b.kind as never) ? (b.kind as string) : "fact";
  // Everything an agent remembers goes into its prompt, so the list has a ceiling.
  const held = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM auto_agent_memory WHERE agent_id = ?`).bind(a.id).first<{ n: number }>();
  if ((held?.n ?? 0) >= MAX_AGENT_MEMORIES) return c.json({ error: "too_many_memories", message: "This agent remembers enough already. Delete some first." }, 400);
  const id = uid();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO auto_agent_memory (id, agent_id, user_id, kind, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'user', ?, ?)`
  )
    .bind(id, a.id, c.get("user").id, kind, content, t, t)
    .run();
  return c.json({ id, agent_id: a.id, kind, content, source: "user", created_at: t, updated_at: t });
});

autoAgents.patch("/:id/memory/:mid", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const mid = c.req.param("mid");
  const cur = await c.env.DB.prepare(
    `SELECT * FROM auto_agent_memory WHERE id = ? AND agent_id = ?`
  )
    .bind(mid, a.id)
    .first<AgentMemoryRow>();
  if (!cur) return c.json({ error: "not_found" }, 404);

  const b = await c.req.json<{ kind?: string; content?: string }>().catch(() => ({} as Record<string, unknown>));
  const kind = b.kind && AGENT_MEMORY_KINDS.includes(b.kind as never) ? (b.kind as string) : cur.kind;
  const content = typeof b.content === "string" ? b.content.trim().slice(0, 1000) : cur.content;
  if (!content) return c.json({ error: "missing_content", message: "Memory content cannot be empty." }, 400);
  const t = now();
  await c.env.DB.prepare(
    `UPDATE auto_agent_memory SET kind = ?, content = ?, updated_at = ? WHERE id = ?`
  )
    .bind(kind, content, t, mid)
    .run();
  return c.json({ ...cur, kind, content, updated_at: t });
});

autoAgents.delete("/:id/memory/:mid", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const mid = c.req.param("mid");
  const r = await c.env.DB.prepare(
    `DELETE FROM auto_agent_memory WHERE id = ? AND agent_id = ?`
  )
    .bind(mid, a.id)
    .run();
  return c.json({ ok: (r.meta.changes ?? 0) > 0 });
});

autoAgents.delete("/:id/memory", async (c) => {
  const a = await ownedAgent(c, c.req.param("id"));
  if (!a) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`DELETE FROM auto_agent_memory WHERE agent_id = ?`).bind(a.id).run();
  return c.json({ ok: true });
});

export default autoAgents;
