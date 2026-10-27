// Running workflows: the once-a-minute pass that finds mail a workflow applies to and does what it says.
//
// A workflow is plain rules, no model. It can only do what you can do by hand with one thread: label it, move it between the
// Imbox, Feed and Paper Trail, mark it read, set it aside, reply later, snooze it, add it to a collection. It cannot delete, send,
// forward or reach beyond the mailboxes it is given, and each piece of mail is handled once per workflow.

import type { Env } from "../env";
import type { AccountRow, MessageRow, UserRow } from "../db";
import { now, uid } from "../db";
import { Budget, UNLIMITED } from "../jobs";
import { logActivity } from "../activity";
import { applyAction, type ActionBody } from "../routes/mail";
import { shim, type ToolContext } from "../ai/tools/context";
import type { LlmProvider } from "../ai/provider";
import { type Action, type Condition, type Facts, type Trigger, conditionHolds, isAiCondition, passes } from "../../shared/workflows";
import { judge, providerFor } from "./ai";

export interface WorkflowRow {
  id: string;
  user_id: string;
  name: string;
  enabled: number;
  trigger: Trigger;
  trigger_days: number;
  match: "all" | "any";
  conditions: string;
  actions: string;
  account_ids: string;
  daily_limit: number;
  watermark: number;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Mail older than this is not worked on when a workflow is switched on late or the server was down: a backlog is not "arriving". */
export const MAX_AGE_MS = 24 * 3600_000;
const PER_PASS = 50;
/** How many questions one workflow may put to the AI in one pass. What is over waits for the next minute. */
export const AI_PER_PASS = 10;
/** Trays where mail is still waiting to be let in, or is gone: a workflow does not decide what leaves the Screener. */
const UNTOUCHED = ["screener", "screened_out", "trash"];

export function parseList<T>(json: string): T[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const addresses = (json: string): string[] => parseList<{ email?: string }>(json).map((a) => (a.email ?? "").toLowerCase()).filter(Boolean);

export function factsOf(m: MessageRow, tray: string): Facts {
  return {
    from_email: (m.from_email ?? "").toLowerCase(),
    from_name: m.from_name ?? "",
    recipients: [...addresses(m.to_json), ...addresses(m.cc_json)],
    subject: m.subject ?? "",
    body: (m.text_body ?? "").slice(0, 20_000),
    has_attachment: !!m.has_attachments,
    has_unsubscribe: !!m.list_unsubscribe || !!m.list_id,
    tray,
  };
}

/** The AI for one workflow's pass: asked at most so often, and only when a workflow has an AI condition. */
export class AiGate {
  calls = 0;
  private llm: LlmProvider | null | undefined;
  constructor(private env: Env, private userId: string, provider?: LlmProvider) {
    this.llm = provider;
  }
  get exhausted() {
    return this.calls >= AI_PER_PASS;
  }
  /** Null when the cap is used up (try again next pass). False when there is no AI or it could not answer: a mail it cannot judge does not match. */
  async ask(statement: string, f: Facts): Promise<boolean | null> {
    if (this.exhausted) return null;
    if (this.llm === undefined) this.llm = await providerFor(this.env, this.userId);
    if (!this.llm) return false;
    this.calls++;
    return (await judge(this.llm, statement, f)) === true;
  }
}

/** Whether a message passes, asking the AI about its AI conditions last and only if the plain ones have not already decided it. Null: out of AI questions for now. */
export async function matchesWith(conditions: Condition[], match: "all" | "any", f: Facts, gate: AiGate): Promise<boolean | null> {
  const ai = conditions.filter(isAiCondition);
  if (!ai.length) return passes(conditions, match, f);
  const plain = conditions.filter((c) => !isAiCondition(c)).map((c) => conditionHolds(c, f));
  if (match === "all") {
    if (plain.some((x) => !x)) return false;
  } else if (plain.some(Boolean)) {
    return true;
  }
  for (const c of ai) {
    const a = await gate.ask(c.value, f);
    if (a === null) return null;
    if (match === "all" && !a) return false;
    if (match === "any" && a) return true;
  }
  return match === "all";
}

/** The mailboxes a workflow works on: its own list, or all of the user's, never a disconnected one or one lent to an outside agent. */
async function boxesFor(env: Env, wf: WorkflowRow): Promise<{ user: UserRow; accounts: AccountRow[] } | null> {
  const db = env.DB;
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(wf.user_id).first<UserRow>();
  if (!user) return null;
  const all = (await db.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at`).bind(user.id).all<AccountRow>()).results;
  const lent = new Set((await db.prepare(`SELECT account_id FROM agent_mailboxes`).all<{ account_id: string }>()).results.map((r) => r.account_id));
  const wanted = parseList<string>(wf.account_ids);
  const accounts = all.filter((a) => (!wanted.length || wanted.includes(a.id)) && !lent.has(a.id) && a.sync_status !== "disconnected");
  return accounts.length ? { user, accounts } : null;
}

function bodyFor(a: Action, t: number): ActionBody | null {
  switch (a.type) {
    case "label":
      return a.id ? { action: "labels", add: [a.id] } : null;
    case "collection":
      return a.id ? { action: "collections", add: [a.id] } : null;
    case "move":
      return a.tray ? { action: "move", bucket: a.tray } : null;
    case "mark_read":
      return { action: "mark_read" };
    case "set_aside":
      return { action: "set_aside", on: true };
    case "reply_later":
      return { action: "reply_later", on: true };
    case "snooze":
      return { action: "bubble_up", at: t + Math.max(1, a.hours ?? 24) * 3600_000 };
  }
}

export function describeAction(a: Action, names: Map<string, string> = new Map()): string {
  switch (a.type) {
    case "label":
      return `label it "${names.get(a.id ?? "") ?? "a label"}"`;
    case "collection":
      return `add it to "${names.get(a.id ?? "") ?? "a collection"}"`;
    case "move":
      return `move it to ${a.tray === "paper_trail" ? "Paper Trail" : a.tray === "feed" ? "the Feed" : "the Imbox"}`;
    case "mark_read":
      return "mark it read";
    case "set_aside":
      return "set it aside";
    case "reply_later":
      return "add it to Reply Later";
    case "snooze":
      return `snooze it for ${a.hours ?? 24} hours`;
  }
}

/** Do the actions to one thread, in order. A label or collection that lives in another mailbox is skipped, not applied across. */
export async function applyActions(env: Env, user: UserRow, accounts: AccountRow[], threadId: string, threadAccountId: string, actions: Action[]): Promise<{ done: number; failed: string[] }> {
  const ctx: ToolContext = { env, user: { id: user.id, email: user.email, name: user.name ?? "" }, accounts, autoSend: false, emit: () => {} };
  const acc = accounts.find((a) => a.id === threadAccountId) ?? accounts[0];
  const t = now();
  let done = 0;
  const failed: string[] = [];
  for (const a of actions) {
    const body = bodyFor(a, t);
    if (!body) {
      failed.push(a.type);
      continue;
    }
    if ((a.type === "label" || a.type === "collection") && a.id) {
      const table = a.type === "label" ? "labels" : "collections";
      const owner = await env.DB.prepare(`SELECT account_id FROM ${table} WHERE id = ?`).bind(a.id).first<{ account_id: string }>();
      if (!owner || owner.account_id !== threadAccountId) {
        failed.push(`${a.type} is in another mailbox`);
        continue;
      }
    }
    try {
      const r = await applyAction(shim(ctx, acc), threadId, body);
      if ("error" in r) failed.push(`${a.type}: ${r.error}`);
      else done++;
    } catch (e) {
      failed.push(`${a.type}: ${(e as Error).message}`);
    }
  }
  return { done, failed };
}

async function nameMap(env: Env, actions: Action[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const a of actions) {
    if (!a.id || (a.type !== "label" && a.type !== "collection")) continue;
    const r = await env.DB.prepare(`SELECT name FROM ${a.type === "label" ? "labels" : "collections"} WHERE id = ?`).bind(a.id).first<{ name: string }>();
    if (r) out.set(a.id, r.name);
  }
  return out;
}

async function claim(env: Env, wf: WorkflowRow, threadId: string, key: string, subject: string): Promise<string | null> {
  const id = uid();
  const r = await env.DB
    .prepare(`INSERT INTO workflow_runs (id, workflow_id, user_id, thread_id, trigger_key, status, summary, subject, created_at) VALUES (?, ?, ?, ?, ?, 'done', '', ?, ?) ON CONFLICT DO NOTHING`)
    .bind(id, wf.id, wf.user_id, threadId, key, subject.slice(0, 300), now())
    .run();
  return r.meta.changes ? id : null;
}

async function finish(env: Env, wf: WorkflowRow, runId: string, threadId: string, accountId: string, subject: string, r: { done: number; failed: string[] }, total: number, what: string) {
  const status = r.failed.length ? (r.done ? "partial" : "error") : "done";
  const summary = r.failed.length ? `${what}. Not done: ${r.failed.join("; ")}` : what;
  await env.DB.prepare(`UPDATE workflow_runs SET status = ?, summary = ? WHERE id = ?`).bind(status, summary.slice(0, 600), runId).run();
  await logActivity(env.DB, wf.user_id, {
    actor: "rules",
    kind: "workflow",
    summary: `Workflow "${wf.name}" ran on "${subject.slice(0, 120)}" (${r.done} of ${total} steps)`,
    why: summary,
    threadId,
    accountId,
    level: status === "done" ? "info" : "warn",
  });
}

/** One workflow's turn: the new mail since it last looked (or, for no-reply, the threads that went quiet), within its daily limit. */
export async function processWorkflow(env: Env, wf: WorkflowRow, opts: { provider?: LlmProvider } = {}): Promise<{ handled: number }> {
  const db = env.DB;
  const boxes = await boxesFor(env, wf);
  if (!boxes) return { handled: 0 };
  const conditions = parseList<Condition>(wf.conditions);
  const actions = parseList<Action>(wf.actions);
  if (!actions.length) return { handled: 0 };
  const ids = boxes.accounts.map((a) => a.id);
  const marks = ids.map(() => "?").join(",");
  const own = new Set((await db.prepare(`SELECT lower(email) AS email FROM accounts WHERE user_id = ?`).bind(wf.user_id).all<{ email: string }>()).results.map((r) => r.email));

  const spent = await db.prepare(`SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ? AND created_at > ?`).bind(wf.id, now() - 24 * 3600_000).first<{ n: number }>();
  let used = spent?.n ?? 0;
  let handled = 0;
  const gate = new AiGate(env, wf.user_id, opts.provider);
  const names = await nameMap(env, actions);
  const what = `Did ${actions.map((a) => describeAction(a, names)).join(", then ")}`;

  if (wf.trigger === "message_arrives") {
    const fresh = (
      await db
        .prepare(
          `SELECT m.*, t.bucket AS t_bucket, t.merged_into AS t_merged FROM messages m JOIN threads t ON t.id = m.thread_id
           WHERE m.account_id IN (${marks}) AND m.is_from_me = 0 AND m.created_at > ? ORDER BY m.created_at ASC LIMIT ?`
        )
        .bind(...ids, wf.watermark, PER_PASS)
        .all<MessageRow & { t_bucket: string; t_merged: string | null }>()
    ).results;
    let watermark = wf.watermark;
    for (const m of fresh) {
      if (used >= wf.daily_limit) break; // the rest waits for tomorrow's allowance
      if (now() - m.date > MAX_AGE_MS || UNTOUCHED.includes(m.t_bucket) || m.t_merged || own.has((m.from_email ?? "").toLowerCase())) {
        watermark = Math.max(watermark, m.created_at);
        continue;
      }
      const ok = await matchesWith(conditions, wf.match, factsOf(m, m.t_bucket), gate);
      if (ok === null) break; // out of AI questions: this mail is looked at again next pass
      watermark = Math.max(watermark, m.created_at);
      if (!ok) continue;
      const runId = await claim(env, wf, m.thread_id, m.id, m.subject ?? "");
      if (!runId) continue;
      const r = await applyActions(env, boxes.user, boxes.accounts, m.thread_id, m.account_id, actions);
      await finish(env, wf, runId, m.thread_id, m.account_id, m.subject ?? "", r, actions.length, what);
      used++;
      handled++;
    }
    await db.prepare(`UPDATE workflows SET watermark = ?, last_run_at = ? WHERE id = ?`).bind(watermark, now(), wf.id).run();
    return { handled };
  }

  // No reply: a thread whose last message is yours and has had no answer for N days. Looked at for a month back, and done once per quiet spell.
  const cutoff = now() - wf.trigger_days * 24 * 3600_000;
  const quiet = (
    await db
      .prepare(
        `SELECT t.id, t.account_id, t.subject, t.bucket, t.last_message_at FROM threads t
         WHERE t.account_id IN (${marks}) AND t.merged_into IS NULL AND t.bucket NOT IN ('screener', 'screened_out', 'trash')
           AND t.last_message_at <= ? AND t.last_message_at > ?
           AND (SELECT m.is_from_me FROM messages m WHERE m.thread_id = t.id ORDER BY m.date DESC LIMIT 1) = 1
           AND NOT EXISTS (SELECT 1 FROM workflow_runs r WHERE r.workflow_id = ? AND r.trigger_key = 'noreply:' || t.last_message_at)
         ORDER BY t.last_message_at ASC LIMIT ?`
      )
      .bind(...ids, cutoff, cutoff - 30 * 24 * 3600_000, wf.id, PER_PASS)
      .all<{ id: string; account_id: string; subject: string; bucket: string; last_message_at: number }>()
  ).results;
  for (const t of quiet) {
    if (used >= wf.daily_limit) break;
    const last = await db.prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1`).bind(t.id).first<MessageRow>();
    if (last && conditions.length) {
      const ok = await matchesWith(conditions, wf.match, factsOf(last, t.bucket), gate);
      if (ok === null) break;
      if (!ok) continue;
    }
    const runId = await claim(env, wf, t.id, `noreply:${t.last_message_at}`, t.subject);
    if (!runId) continue;
    const r = await applyActions(env, boxes.user, boxes.accounts, t.id, t.account_id, actions);
    await finish(env, wf, runId, t.id, t.account_id, t.subject, r, actions.length, `No reply for ${wf.trigger_days} days. ${what}`);
    used++;
    handled++;
  }
  await db.prepare(`UPDATE workflows SET last_run_at = ? WHERE id = ?`).bind(now(), wf.id).run();
  return { handled };
}

/** What a workflow would do to the user's latest mail, without doing it: for "Try it on my recent mail". */
export async function previewMatches(env: Env, userId: string, def: { trigger: Trigger; match: "all" | "any"; conditions: Condition[]; account_ids: string[] }, limit = 8): Promise<{ scanned: number; total: number; ai_skipped: boolean; matches: { thread_id: string; subject: string; from: string }[] }> {
  const db = env.DB;
  const all = (await db.prepare(`SELECT id FROM accounts WHERE user_id = ? AND sync_status <> 'disconnected'`).bind(userId).all<{ id: string }>()).results.map((a) => a.id);
  const ids = def.account_ids.length ? all.filter((i) => def.account_ids.includes(i)) : all;
  const aiSkipped = def.conditions.some(isAiCondition);
  // The AI is not asked for a preview: it would be a question per email. The other conditions are applied, and the person is told.
  const plainOnly = def.conditions.filter((c) => !isAiCondition(c));
  if (!ids.length) return { scanned: 0, total: 0, ai_skipped: aiSkipped, matches: [] };
  const marks = ids.map(() => "?").join(",");
  const rows = (
    await db
      .prepare(
        `SELECT m.*, t.bucket AS t_bucket FROM messages m JOIN threads t ON t.id = m.thread_id
         WHERE m.account_id IN (${marks}) AND m.is_from_me = 0 AND t.merged_into IS NULL AND t.bucket NOT IN ('screener', 'screened_out', 'trash')
         ORDER BY m.date DESC LIMIT 200`
      )
      .bind(...ids)
      .all<MessageRow & { t_bucket: string }>()
  ).results;
  const seen = new Set<string>();
  const matches: { thread_id: string; subject: string; from: string }[] = [];
  let total = 0;
  for (const m of rows) {
    if (seen.has(m.thread_id) || !passes(plainOnly, def.match, factsOf(m, m.t_bucket))) continue;
    seen.add(m.thread_id);
    total++;
    if (matches.length < limit) matches.push({ thread_id: m.thread_id, subject: m.subject ?? "", from: m.from_name || m.from_email || "" });
  }
  return { scanned: rows.length, total: aiSkipped && !plainOnly.length ? 0 : total, ai_skipped: aiSkipped, matches: aiSkipped && !plainOnly.length ? [] : matches };
}

/** Cron: every switched-on workflow gets its turn. One failing workflow never stops the rest. */
export async function runWorkflows(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const list = await env.DB.prepare(`SELECT * FROM workflows WHERE enabled = 1 ORDER BY COALESCE(last_run_at, 0) LIMIT 40`).all<WorkflowRow>();
  for (const wf of list.results) {
    if (budget.spent) break;
    try {
      await processWorkflow(env, wf);
    } catch (e) {
      console.error("workflow failed", wf.name, (e as Error).message);
    }
  }
}
