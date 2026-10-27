// The AI's part of "Let obvious people in": once a minute, for people who switched it on, look at the senders waiting in the Screener and let in
// the ones the model is sure are an individual writing to them. Everything else keeps waiting for a decision.

import type { Env } from "./env";
import { logActivity } from "./activity";
import { Budget, UNLIMITED } from "./jobs";
import type { ContactRow, MessageRow, ThreadRow } from "./db";
import { now, chunk, safeJson } from "./db";
import { suggestBucket } from "./sync";
import { applyScreenDecision } from "./routes/screener";
import { generateMissing, loadSuggestions, needsRefresh, screenerAiEnabled, type SenderFacts } from "./ai/screener";
import { isBulk, logLetIn, undoneEmails } from "./autoletin";

type Glance = Pick<MessageRow, "from_email" | "date" | "subject" | "list_unsubscribe" | "list_id" | "precedence" | "gmail_labels_json">;

/** One user's pass. Returns how many senders were let in. */
export async function autoLetInForUser(env: Env, userId: string): Promise<number> {
  const db = env.DB;
  if (!(await screenerAiEnabled(env, userId))) return 0;
  const accountIds = (await db.prepare(`SELECT id FROM accounts WHERE user_id = ?`).bind(userId).all<{ id: string }>()).results.map((r) => r.id);
  if (!accountIds.length) return 0;
  const inSql = `(${accountIds.map(() => "?").join(",")})`;
  const threads = (
    await db
      .prepare(`SELECT t.* FROM threads t WHERE t.account_id IN ${inSql} AND t.bucket = 'screener' AND t.merged_into IS NULL AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?) ORDER BY t.last_message_at DESC LIMIT 200`)
      .bind(...accountIds, now())
      .all<ThreadRow>()
  ).results;
  if (!threads.length) return 0;

  const byKey = new Map<string, ThreadRow[]>();
  for (const th of threads) {
    const key = (th.last_from_email ?? "").toLowerCase();
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), th]);
  }
  const latest = new Map<string, Glance>();
  for (const part of chunk(threads.map((t) => t.id), 90)) {
    const ms = await db
      .prepare(`SELECT m.from_email, m.date, m.subject, m.list_unsubscribe, m.list_id, m.precedence, m.gmail_labels_json FROM messages m WHERE m.thread_id IN (${part.map(() => "?").join(",")}) AND m.is_from_me = 0 ORDER BY m.date DESC`)
      .bind(...part)
      .all<Glance>();
    for (const m of ms.results) {
      const key = m.from_email.toLowerCase();
      const have = latest.get(key);
      if (!have || m.date > have.date) latest.set(key, m);
    }
  }
  const undone = await undoneEmails(db, userId, [...byKey.keys()]);
  const facts = new Map<string, SenderFacts>();
  for (const [key, ths] of byKey) {
    if (undone.has(key)) continue;
    const m = latest.get(key);
    // Bulk mail is never let in on a guess, whoever it appears to be from.
    if (m && isBulk(m)) continue;
    facts.set(key, {
      email: ths[0].last_from_email,
      name: ths[0].last_from_name ?? "",
      subjects: ths.slice(0, 3).map((x) => x.subject),
      snippet: ths[0].snippet ?? "",
      unsubscribe: false,
      messages: ths.length,
      rule_guess: suggestBucket({ subject: m?.subject ?? ths[0].subject, from_email: ths[0].last_from_email, list_unsubscribe: m?.list_unsubscribe ?? "", list_id: m?.list_id ?? "", precedence: m?.precedence ?? "", labels: safeJson<string[]>(m?.gmail_labels_json ?? "[]", []) }),
    });
  }
  if (!facts.size) return 0;

  let saved = await loadSuggestions(db, userId, [...facts.keys()]);
  const missing = [...facts].filter(([k]) => needsRefresh(saved.get(k))).map(([, f]) => f);
  if (missing.length) {
    await generateMissing(env, userId, accountIds, missing);
    saved = await loadSuggestions(db, userId, [...facts.keys()]);
  }

  let letIn = 0;
  for (const [key, f] of facts) {
    const ai = saved.get(key);
    if (ai?.bucket !== "imbox" || ai.confidence !== "high" || !ai.person || !ai.reason) continue;
    const ths = byKey.get(key)!;
    const contact = await db.prepare(`SELECT * FROM contacts WHERE account_id = ? AND lower(email) = ? AND screen_status = 'pending'`).bind(ths[0].account_id, key).first<ContactRow>();
    if (!contact) continue;
    await applyScreenDecision(db, ths[0].account_id, contact, "imbox");
    await db.prepare(`UPDATE screener_suggestions SET outcome = 'auto' WHERE user_id = ? AND email = ?`).bind(userId, key).run();
    await logLetIn(db, userId, key, f.name, ai.reason, "ai").run();
    await logActivity(db, userId, { actor: "ai", kind: "auto_let_in", summary: `Let in ${f.name ? `${f.name} (${key})` : key} automatically`, why: ai.reason, accountId: ths[0].account_id });
    letIn++;
  }
  return letIn;
}

/** The cron entry: everyone who turned the setting on and has an AI provider set up. */
export async function autoLetInDue(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const users = await env.DB
    .prepare(`SELECT u.id FROM users u JOIN ai_settings a ON a.user_id = u.id WHERE a.screener_suggest = 1 AND u.settings_json ILIKE '%"autoLetIn":true%'`)
    .all<{ id: string }>();
  for (const u of users.results) {
    if (budget.spent) break;
    try {
      await autoLetInForUser(env, u.id);
    } catch (e) {
      console.error("auto let-in failed", (e as Error).message);
    }
  }
}
