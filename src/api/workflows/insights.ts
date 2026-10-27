// What imbox can tell you about your workflows without running them or asking a model: what you keep doing by hand that a workflow could do,
// what is wrong with the ones you have, and why one did or did not match a given email. All of it is read from your own mail and history.

import type { Env } from "../env";
import type { MessageRow } from "../db";
import { now } from "../db";
import { type Action, type Condition, type WorkflowDef, conditionHolds, describeCondition, isAiCondition } from "../../shared/workflows";
import { MAX_AGE_MS, factsOf, parseList, type WorkflowRow } from "./run";

const DAY = 24 * 3600_000;
/** How many times a person has to do the same thing by hand before it is offered as a workflow. */
export const SUGGEST_AFTER = 3;

/* ---------- things you keep doing by hand ---------- */

export interface Suggestion {
  key: string;
  title: string;
  why: string;
  def: Pick<WorkflowDef, "name" | "conditions" | "actions">;
}

const TRAY_NAME: Record<string, string> = { feed: "the Feed", paper_trail: "Paper Trail" };

/** The sender (or domain) a workflow already covers with a "sender is" condition, so it is not offered again. */
function coveredSenders(workflows: WorkflowRow[]): Set<string> {
  const out = new Set<string>();
  for (const w of workflows) for (const c of parseList<Condition>(w.conditions)) if (c.field === "from" && c.op === "is") out.add(c.value.toLowerCase());
  return out;
}

/** Senders whose mail the person has moved by hand to the Feed or Paper Trail at least a few times, and no workflow handles yet. */
export async function suggestions(env: Env, userId: string): Promise<Suggestion[]> {
  const rows = (
    await env.DB
      .prepare(
        `SELECT lower(t.last_from_email) AS sender, t.bucket AS bucket, COUNT(DISTINCT t.id) AS n
         FROM activity_log a JOIN threads t ON t.id = a.thread_id JOIN accounts ac ON ac.id = t.account_id
         WHERE a.user_id = ? AND ac.user_id = ? AND a.actor = 'you' AND a.kind = 'move' AND a.at > ?
           AND t.bucket IN ('feed', 'paper_trail') AND t.last_from_email <> ''
           AND lower(t.last_from_email) NOT IN (SELECT lower(email) FROM accounts WHERE user_id = ?)
         GROUP BY lower(t.last_from_email), t.bucket
         HAVING COUNT(DISTINCT t.id) >= ?
         ORDER BY COUNT(DISTINCT t.id) DESC NULLS LAST, lower(t.last_from_email) NULLS LAST LIMIT 8`
      )
      .bind(userId, userId, now() - 60 * DAY, userId, SUGGEST_AFTER)
      .all<{ sender: string; bucket: string; n: number }>()
  ).results;
  if (!rows.length) return [];
  const existing = (await env.DB.prepare(`SELECT * FROM workflows WHERE user_id = ?`).bind(userId).all<WorkflowRow>()).results;
  const covered = coveredSenders(existing);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const r of rows) {
    const domain = r.sender.split("@")[1] ?? "";
    if (covered.has(r.sender) || (domain && covered.has(domain)) || seen.has(r.sender)) continue;
    seen.add(r.sender);
    const tray = r.bucket === "paper_trail" ? "paper_trail" : "feed";
    out.push({
      key: `move:${r.sender}:${tray}`,
      title: `Send mail from ${r.sender} to ${TRAY_NAME[tray]}`,
      why: `You moved ${r.n} of their emails there by hand.`,
      def: { name: `Mail from ${r.sender}`.slice(0, 80), conditions: [{ field: "from", op: "is", value: r.sender }], actions: [{ type: "move", tray }] },
    });
    if (out.length >= 4) break;
  }
  return out;
}

/* ---------- what is wrong with the ones you have ---------- */

export interface CheckupNote {
  kind: "duplicate" | "conflict" | "never_matched" | "missing_target" | "failing";
  workflow_ids: string[];
  message: string;
}

const norm = (w: WorkflowRow) => JSON.stringify([w.trigger, w.trigger_days, w.match, parseList<Condition>(w.conditions).map((c) => [c.field, c.op, c.value.toLowerCase()]).sort(), w.account_ids]);
const movesOf = (w: WorkflowRow) => parseList<Action>(w.actions).filter((a) => a.type === "move").map((a) => a.tray);

export async function checkup(env: Env, userId: string): Promise<CheckupNote[]> {
  const list = (await env.DB.prepare(`SELECT * FROM workflows WHERE user_id = ? ORDER BY created_at`).bind(userId).all<WorkflowRow>()).results;
  const notes: CheckupNote[] = [];

  // The same thing written twice, and two that match the same mail but send it to different trays.
  const groups = new Map<string, WorkflowRow[]>();
  for (const w of list) {
    if (!parseList(w.actions).length) continue;
    groups.set(norm(w), [...(groups.get(norm(w)) ?? []), w]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const same = new Set(g.map((w) => JSON.stringify(parseList(w.actions))));
    if (same.size === 1) {
      notes.push({ kind: "duplicate", workflow_ids: g.map((w) => w.id), message: `${g.map((w) => `"${w.name}"`).join(" and ")} do the same thing. One of them can go.` });
      continue;
    }
    const on = g.filter((w) => w.enabled);
    const trays = new Set(on.flatMap(movesOf));
    if (on.length > 1 && trays.size > 1) {
      notes.push({ kind: "conflict", workflow_ids: on.map((w) => w.id), message: `${on.map((w) => `"${w.name}"`).join(" and ")} match the same mail but move it to different trays. Only one of them can win.` });
    }
  }

  // A label or collection that was deleted after the workflow was made.
  for (const w of list) {
    for (const a of parseList<Action>(w.actions)) {
      if ((a.type !== "label" && a.type !== "collection") || !a.id) continue;
      const hit = await env.DB.prepare(`SELECT 1 AS ok FROM ${a.type === "label" ? "labels" : "collections"} WHERE id = ?`).bind(a.id).first();
      if (!hit) {
        notes.push({ kind: "missing_target", workflow_ids: [w.id], message: `"${w.name}" uses a ${a.type} that no longer exists, so that step does nothing. Pick another.` });
        break;
      }
    }
  }

  // On for a while and never matched anything, and ones that keep failing a step.
  for (const w of list) {
    if (!w.enabled) continue;
    const runs = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status <> 'done' AND created_at > ? THEN 1 ELSE 0 END), 0) AS bad FROM workflow_runs WHERE workflow_id = ?`).bind(now() - 7 * DAY, w.id).first<{ n: number; bad: number }>();
    if ((runs?.n ?? 0) === 0 && now() - w.updated_at > 14 * DAY) {
      notes.push({ kind: "never_matched", workflow_ids: [w.id], message: `"${w.name}" has been on for over two weeks and hasn't matched anything. Its conditions may be too narrow.` });
    } else if ((runs?.bad ?? 0) >= 3) {
      notes.push({ kind: "failing", workflow_ids: [w.id], message: `"${w.name}" couldn't finish a step ${runs?.bad} times this week. Open its history to see which.` });
    }
  }
  return notes;
}

/* ---------- why it did, or didn't, match this email ---------- */

export interface ThreadCheck {
  subject: string;
  /** Would a workflow like this act on it if it arrived now? Null when the AI would have to be asked. */
  would_act: boolean | null;
  /** What is in the way, apart from the conditions. */
  blockers: string[];
  conditions: { text: string; ok: boolean | null }[];
}

export async function checkThread(env: Env, wf: WorkflowRow, userId: string, threadId: string): Promise<ThreadCheck | null> {
  const t = await env.DB
    .prepare(`SELECT t.id, t.account_id, COALESCE(t.custom_subject, t.subject) AS subject, t.bucket, t.merged_into FROM threads t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND a.user_id = ?`)
    .bind(threadId, userId)
    .first<{ id: string; account_id: string; subject: string; bucket: string; merged_into: string | null }>();
  if (!t) return null;
  const msg = await env.DB.prepare(`SELECT * FROM messages WHERE thread_id = ? AND is_from_me = 0 ORDER BY date DESC LIMIT 1`).bind(t.id).first<MessageRow>();
  const blockers: string[] = [];
  const accounts = parseList<string>(wf.account_ids);
  if (accounts.length && !accounts.includes(t.account_id)) blockers.push("It is in a mailbox this workflow doesn't work on.");
  if (["screener", "screened_out", "trash"].includes(t.bucket)) blockers.push(t.bucket === "trash" ? "It is in the Trash." : "It is waiting in the Screener, and workflows leave the Screener alone.");
  if (t.merged_into) blockers.push("It was merged into another conversation.");
  if (!msg) {
    return { subject: t.subject, would_act: false, blockers: [...blockers, "There is no message from someone else in it."], conditions: [] };
  }
  if (wf.trigger === "message_arrives" && now() - msg.date > MAX_AGE_MS) blockers.push("It is more than a day old. A workflow only acts on mail that has just arrived, so it wouldn't have acted on it.");
  const f = factsOf(msg, t.bucket);
  const conds = parseList<Condition>(wf.conditions);
  const results = conds.map((c) => ({ text: describeCondition(c), ok: isAiCondition(c) ? null : conditionHolds(c, f) }));
  const decided = results.filter((r) => r.ok !== null).map((r) => r.ok as boolean);
  let matched: boolean | null;
  if (!conds.length) matched = true;
  else if (wf.match === "all") matched = decided.includes(false) ? false : results.some((r) => r.ok === null) ? null : true;
  else matched = decided.includes(true) ? true : results.some((r) => r.ok === null) ? null : false;
  const would = blockers.length ? false : matched;
  return { subject: t.subject, would_act: would, blockers, conditions: results };
}

/** The user's latest conversations, for picking one to test a workflow against. */
export async function recentThreads(env: Env, userId: string, limit = 15): Promise<{ thread_id: string; subject: string; from: string }[]> {
  const rows = (
    await env.DB
      .prepare(
        `SELECT t.id, COALESCE(t.custom_subject, t.subject) AS subject, t.last_from_name AS name, t.last_from_email AS email FROM threads t JOIN accounts a ON a.id = t.account_id
         WHERE a.user_id = ? AND t.merged_into IS NULL AND t.bucket <> 'trash' ORDER BY t.last_message_at DESC LIMIT ?`
      )
      .bind(userId, limit)
      .all<{ id: string; subject: string; name: string; email: string }>()
  ).results;
  return rows.map((r) => ({ thread_id: r.id, subject: r.subject, from: r.name || r.email }));
}
