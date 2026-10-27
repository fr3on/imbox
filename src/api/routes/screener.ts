import { Hono } from "hono";
import { logActivity } from "../activity";
import type { AppEnv } from "../env";
import type { ContactRow, MessageRow, ThreadRow } from "../db";
import { LOOKUP_CHUNK, now, toContact, threadsWithLabels, safeJson, inClause, ownedRow, chunk } from "../db";
import { suggestBucket } from "../sync";
import { effectiveSuggestion, generateMissing, loadSuggestions, needsRefresh, screenerAiEnabled, type AiSuggestion, type SenderFacts } from "../ai/screener";
import type { ScreenStatus } from "@shared/types";
import { isId, searchTerm } from "../input";
import { mergeContacts } from "./contacts";

const screener = new Hono<AppEnv>();

export type DecisionScope = "all" | "account";

/** Which accounts a decision touches: every account the user has connected, or just this one. */
async function scopeAccountIds(db: Db, accountId: string, scope: DecisionScope): Promise<string[]> {
  if (scope === "account") return [accountId];
  const siblings = await db
    .prepare(`SELECT id FROM accounts WHERE user_id = (SELECT user_id FROM accounts WHERE id = ?)`)
    .bind(accountId)
    .all<{ id: string }>();
  const ids = siblings.results.map((r) => r.id);
  if (!ids.includes(accountId)) ids.push(accountId);
  return ids;
}

/**
 * Screening decisions are user-wide by default: deciding for a sender applies to that email across every account the
 * user has connected (contact rows are created where missing), and re-buckets their threads everywhere. Pass
 * scope "account" to touch only the account the contact row belongs to.
 */
export async function applyScreenDecision(db: Db, accountId: string, contact: ContactRow, decision: ScreenStatus, scope: DecisionScope = "all") {
  const t = now();
  const bucket = decision === "pending" ? "screener" : decision;
  const ids = await scopeAccountIds(db, accountId, scope);
  const stmts: DbStatement[] = [];
  for (const id of ids) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, avatar_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)
           ON CONFLICT(account_id, email) DO UPDATE SET screen_status = excluded.screen_status, screened_at = excluded.screened_at`
        )
        .bind(crypto.randomUUID(), id, contact.email, contact.name, decision, t, t, t, contact.avatar_url ?? "")
    );
  }
  const inSql = `(${ids.map(() => "?").join(",")})`;
  // Threads are matched the same way for every decision: the ones whose latest message is from this sender. A thread where
  // someone else wrote last stays with that person's decision, so deciding for one sender never moves another's conversation.
  // Moving someone who was already decided takes their old bucket along, but never mail you filed elsewhere by hand.
  const was = contact.screen_status;
  const from: string[] = decision === "screened_out" ? ["screener", "imbox", "feed", "paper_trail"] : decision === "pending" ? ["screened_out", "imbox", "feed", "paper_trail"] : ["screener", "screened_out"];
  if (decision !== "screened_out" && decision !== "pending") {
    if (["imbox", "feed", "paper_trail"].includes(was) && was !== decision) from.push(was);
  }
  if (decision === "screened_out") {
    stmts.push(
      db
        .prepare(
          `UPDATE threads SET bucket = 'screened_out', reply_later = 0, set_aside = 0, updated_at = ? WHERE account_id IN ${inSql} AND bucket IN (${from.map(() => "?").join(",")}) AND is_sent_only = 0 AND lower(last_from_email) = ?`
        )
        .bind(t, ...ids, ...from, contact.email.toLowerCase())
    );
  } else {
    stmts.push(
      db
        .prepare(
          `UPDATE threads SET bucket = ?, updated_at = ? WHERE account_id IN ${inSql} AND bucket IN (${from.map(() => "?").join(",")}) AND is_sent_only = 0 AND lower(last_from_email) = ?`
        )
        .bind(bucket, t, ...ids, ...from, contact.email.toLowerCase())
    );
  }
  if (decision !== "pending") {
    // Whether the person went with the AI's suggestion for this sender, kept so its quality can be judged.
    stmts.push(
      db
        .prepare(`UPDATE screener_suggestions SET outcome = CASE WHEN bucket = ? THEN 'accepted' ELSE 'overridden' END WHERE user_id = (SELECT user_id FROM accounts WHERE id = ?) AND email = ?`)
        .bind(decision, accountId, contact.email.toLowerCase())
    );
  } else {
    // Back to waiting: the suggestion is open to a fresh look again, since the person has not accepted or overridden it.
    stmts.push(db.prepare(`UPDATE screener_suggestions SET outcome = NULL WHERE user_id = (SELECT user_id FROM accounts WHERE id = ?) AND email = ?`).bind(accountId, contact.email.toLowerCase()));
  }
  await db.batch(stmts);
}

/** Bundle flag is user-wide too by default; scope "account" limits it to this one account's row. */
export async function applyBundleFlag(db: Db, accountId: string, contact: ContactRow, on: boolean, scope: DecisionScope = "all") {
  const t = now();
  const ids = await scopeAccountIds(db, accountId, scope);
  const stmts: DbStatement[] = ids.map((id) =>
    db
      .prepare(
        `INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, avatar_url, bundled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?)
         ON CONFLICT(account_id, email) DO UPDATE SET bundled = excluded.bundled`
      )
      .bind(crypto.randomUUID(), id, contact.email, contact.name, contact.screen_status, contact.screened_at, t, t, contact.avatar_url ?? "", on ? 1 : 0)
  );
  await db.batch(stmts);
}

// Screening decisions apply user-wide (see scopeAccountIds), so the queue is grouped by sender email alone: a
// sender who has landed in more than one of the user's connected accounts still gets a single card.
const SENDERS_SHOWN = 100;
const THREADS_SHOWN = 5;

screener.get("/", async (c) => {
  const db = c.env.DB;
  const t = now();
  const sc = inClause(c.get("accountIds"));
  const keyOf = (email: string) => email.toLowerCase();
  // Who is waiting, newest first, and how many threads each has: a narrow query the index answers on its own. Only the senders that will be shown
  // are worked on from here (their contacts, labels and latest messages cost a query per few dozen senders), and of those only the newest few
  // threads are read in full.
  const limit = Math.min(500, Math.max(1, Math.floor(Number(c.req.query("limit"))) || SENDERS_SHOWN));
  // Only the page of senders comes back, with how many wait in all counted beside them: with a long backlog the list of every sender was thousands of rows
  // read to show a hundred.
  const waiting = await db
    .prepare(
      `SELECT k, n, latest, COUNT(*) OVER () AS total FROM (
         SELECT LOWER(t.last_from_email) AS k, COUNT(*) AS n, MAX(t.last_message_at) AS latest FROM threads t
         WHERE t.account_id IN ${sc.sql} AND t.bucket = 'screener' AND t.merged_into IS NULL AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?)
         GROUP BY LOWER(t.last_from_email)
       ) g ORDER BY latest DESC NULLS LAST LIMIT ?`
    )
    .bind(...sc.params, t, limit)
    .all<{ k: string; n: number; latest: number; total: number }>();
  const total = waiting.results[0]?.total ?? 0;
  const shownKeys = waiting.results;
  const counts = new Map(shownKeys.map((w) => [w.k, w.n]));
  const picked: ThreadRow[] = shownKeys.length
    ? (
        await db
          .prepare(
            // One index probe per sender for their newest few threads (idx_threads_screener_sender), instead of numbering every waiting thread.
            `SELECT x.* FROM (VALUES ${shownKeys.map(() => "(?)").join(", ")}) AS a(k)
             CROSS JOIN LATERAL (SELECT t.* FROM threads t WHERE t.bucket = 'screener' AND t.merged_into IS NULL AND t.account_id IN ${sc.sql}
               AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?) AND LOWER(t.last_from_email) = a.k ORDER BY t.last_message_at DESC LIMIT ${THREADS_SHOWN}) x
             ORDER BY x.last_message_at DESC`
          )
          .bind(...shownKeys.map((w) => w.k), ...sc.params, t)
          .all<ThreadRow>()
      ).results
    : [];
  const emails = [...new Set(picked.map((r) => r.last_from_email))];
  const contacts = new Map<string, ContactRow>();
  // What the page needs from the database, asked together: each query is a round trip, and none depends on another. The threads with their labels and pictures;
  // the senders' contacts; the latest message of each sender (across every account) for the suggestion heuristics, and whether the assistant has a say.
  // Only the few columns the guess needs: selecting whole messages pulled every body of every message in every waiting thread into memory, and a Screener
  // with a few long threads in it used far more memory than the page needed. DISTINCT ON takes each sender's newest, so the database sends a row for each
  // sender and not one for each message.
  type Glance = Pick<MessageRow, "from_email" | "date" | "subject" | "list_unsubscribe" | "list_id" | "precedence" | "gmail_labels_json">;
  const latest = new Map<string, Glance>();
  const userId = c.get("user").id;
  const [threads, contactParts, glanceParts, aiOn] = await Promise.all([
    threadsWithLabels(db, picked),
    Promise.all(
      chunk(emails, LOOKUP_CHUNK).map((part) =>
        db
          .prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND email IN (${part.map(() => "?").join(",")})`)
          .bind(...sc.params, ...part)
          .all<ContactRow>()
      )
    ),
    Promise.all(
      chunk(picked.map((r) => r.id), LOOKUP_CHUNK).map((part) =>
        db
          .prepare(
            `SELECT DISTINCT ON (LOWER(m.from_email)) m.from_email, m.date, m.subject, m.list_unsubscribe, m.list_id, m.precedence, m.gmail_labels_json FROM messages m
             WHERE m.thread_id IN (${part.map(() => "?").join(",")}) AND m.is_from_me = 0 ORDER BY LOWER(m.from_email) NULLS LAST, m.date DESC, m.id DESC`
          )
          .bind(...part)
          .all<Glance>()
      )
    ),
    screenerAiEnabled(c.env, userId),
  ]);
  const byKey = new Map<string, typeof threads>();
  for (const th of threads) {
    const key = keyOf(th.last_from.email);
    const arr = byKey.get(key) ?? [];
    arr.push(th);
    byKey.set(key, arr);
  }
  for (const cr of contactParts) {
    for (const r of cr.results) {
      const key = keyOf(r.email);
      const existing = contacts.get(key);
      if (!existing || r.screen_status === "pending") contacts.set(key, r);
    }
  }
  for (const ms of glanceParts) {
    for (const m of ms.results) {
      const key = keyOf(m.from_email);
      const existing = latest.get(key);
      if (!existing || m.date > existing.date) latest.set(key, m);
    }
  }
  // A waiting sender with no contact row (mail that arrived before contacts were kept, or a row removed by hand) still has to be
  // shown and counted, so the row is made now. Without one there is nothing to decide on.
  const absent = [...byKey.entries()].filter(([k]) => !contacts.has(k));
  if (absent.length) {
    await db.batch(
      absent.map(([k, ths]) =>
        db
          .prepare(
            `INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, avatar_url)
             VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?, ?, '', '') ON CONFLICT(account_id, email) DO NOTHING`
          )
          .bind(crypto.randomUUID(), ths[0].account_id, ths[0].last_from.email, ths[0].last_from.name ?? "", ths[ths.length - 1].first_message_at ?? t, ths[0].last_message_at ?? t, counts.get(k) ?? ths.length)
      )
    );
    for (const part of chunk(absent.map(([, ths]) => ths[0].last_from.email), LOOKUP_CHUNK)) {
      const cr = await db
        .prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND email IN (${part.map(() => "?").join(",")})`)
        .bind(...sc.params, ...part)
        .all<ContactRow>();
      for (const r of cr.results) {
        const key = keyOf(r.email);
        if (!contacts.has(key) || r.screen_status === "pending") contacts.set(key, r);
      }
    }
  }
  const facts = new Map<string, SenderFacts>();
  const senders = [...byKey.entries()]
    .map(([key, ths]) => {
      const contact = contacts.get(key);
      const email = ths[0].last_from.email;
      const accountId = ths[0].account_id;
      const m = latest.get(key);
      const suggestion = suggestBucket({
        subject: m?.subject ?? ths[0]?.subject ?? "",
        from_email: email,
        list_unsubscribe: m?.list_unsubscribe ?? "",
        list_id: m?.list_id ?? "",
        precedence: m?.precedence ?? "",
        labels: safeJson<string[]>(m?.gmail_labels_json ?? "[]", []),
      });
      facts.set(key, {
        email,
        name: ths[0]?.last_from.name ?? "",
        subjects: ths.slice(0, 3).map((x) => x.original_subject || x.subject),
        snippet: ths[0]?.snippet ?? "",
        unsubscribe: !!(m?.list_unsubscribe || m?.list_id),
        messages: counts.get(key) ?? ths.length,
        rule_guess: suggestion,
      });
      return {
        account_id: accountId,
        contact: contact
          ? toContact(contact)
          : { id: "", account_id: accountId, email, name: ths[0]?.last_from.name ?? "", screen_status: "pending" as ScreenStatus, screened_at: null, first_seen_at: ths[0]?.first_message_at ?? t, last_seen_at: ths[0]?.last_message_at ?? t, message_count: counts.get(key) ?? ths.length, notes: "", avatar_url: "" },
        threads: ths,
        suggestion,
      };
    })
    .filter((s) => s.contact.id)
    .sort((a, b) => b.threads[0].last_message_at - a.threads[0].last_message_at);
  // A page of senders, newest first, and a few threads from each: with a long backlog the whole list was hundreds of kilobytes. The page says how
  // many more there are, and a decision about a sender reaches all of their threads whichever of them were sent.
  const shown = senders.map((s) => ({ ...s, thread_count: counts.get(keyOf(s.contact.email)) ?? s.threads.length }));

  // The AI's word on where each sender belongs, when it has one. Senders it has not looked at yet are worked out in
  // the background; the page asks again shortly and picks them up.
  let aiPending = 0;
  let out: ((typeof shown)[number] & { ai?: AiSuggestion; suggestion_source?: "ai" | "rules" })[] = shown;
  if (aiOn) {
    const saved = await loadSuggestions(db, userId, shown.map((s) => s.contact.email));
    out = shown.map((s) => {
      const ai = saved.get(s.contact.email.toLowerCase());
      const eff = effectiveSuggestion(s.suggestion, ai);
      return { ...s, suggestion: eff.suggestion, suggestion_source: eff.source, ...(ai ? { ai } : {}) };
    });
    const missing = shown.filter((s) => needsRefresh(saved.get(s.contact.email.toLowerCase()))).map((s) => facts.get(keyOf(s.contact.email))).filter((f): f is SenderFacts => !!f);
    aiPending = missing.length;
    if (missing.length) {
      const job = generateMissing(c.env, userId, c.get("accountIds"), missing);
      try {
        c.executionCtx.waitUntil(job);
      } catch {
        // No execution context (a unit test): the job just runs on its own.
      }
    }
  }
  return c.json({ senders: out, total, ai_pending: aiPending });
});

// The next senders waiting for a decision, kept small for the browser extension: who, what they wrote, and how many threads.
screener.get("/waiting", async (c) => {
  const db = c.env.DB;
  const t = now();
  const sc = inClause(c.get("accountIds"));
  const limit = Math.min(10, Math.max(1, Math.floor(Number(c.req.query("limit"))) || 5));
  const rows = await db
    .prepare(
      `SELECT t.account_id, t.last_from_email AS email, t.last_from_name AS name, COALESCE(t.custom_subject, t.subject) AS subject, t.snippet, t.last_message_at AS at
       FROM threads t WHERE t.account_id IN ${sc.sql} AND t.bucket = 'screener' AND t.merged_into IS NULL AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?)
       ORDER BY t.last_message_at DESC LIMIT 400`
    )
    .bind(...sc.params, t)
    .all<{ account_id: string; email: string; name: string; subject: string; snippet: string; at: number }>();
  const bySender = new Map<string, { account_id: string; email: string; name: string; subject: string; snippet: string; at: number; threads: number }>();
  for (const r of rows.results) {
    const key = r.email.toLowerCase();
    const seen = bySender.get(key);
    if (seen) seen.threads += 1;
    else bySender.set(key, { ...r, threads: 1 });
  }
  const top = [...bySender.values()].slice(0, limit);
  const ids = new Map<string, string>();
  if (top.length) {
    const cr = await db
      .prepare(`SELECT id, email FROM contacts WHERE account_id IN ${sc.sql} AND LOWER(email) IN (${top.map(() => "?").join(",")}) ORDER BY (screen_status = 'pending') DESC NULLS LAST`)
      .bind(...sc.params, ...top.map((s) => s.email.toLowerCase()))
      .all<{ id: string; email: string }>();
    for (const r of cr.results) if (!ids.has(r.email.toLowerCase())) ids.set(r.email.toLowerCase(), r.id);
  }
  return c.json({
    total: bySender.size,
    senders: top.flatMap((s) => {
      const contact_id = ids.get(s.email.toLowerCase());
      return contact_id ? [{ contact_id, email: s.email, name: s.name, subject: s.subject, snippet: s.snippet.slice(0, 160), threads: s.threads, at: s.at }] : [];
    }),
  });
});

screener.post("/decide", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ contact_id?: string; decision?: ScreenStatus; scope?: DecisionScope }>().catch(() => ({}) as any);
  const decision = body.decision;
  if (!decision || !["imbox", "feed", "paper_trail", "screened_out"].includes(decision)) return c.json({ error: "invalid_decision" }, 400);
  const contact = await ownedRow<ContactRow>(db, "contacts", isId(body.contact_id) ? body.contact_id : "", c.get("user").id);
  if (!contact) return c.json({ error: "not_found" }, 404);
  await applyScreenDecision(db, contact.account_id, contact, decision, body.scope === "account" ? "account" : "all");
  const who = contact.name ? `${contact.name} (${contact.email})` : contact.email;
  await logActivity(db, c.get("user").id, { actor: "you", kind: "screen", summary: decision === "screened_out" ? `Screened out ${who}` : `Let in ${who}`, why: decision === "screened_out" ? "Their mail will not reach you" : `Their mail goes to ${decision === "imbox" ? "the Imbox" : decision === "feed" ? "the Feed" : "Receipts"}`, accountId: contact.account_id });
  return c.json({ ok: true });
});

// People let in without asking (the "Let obvious people in" setting) that have not been looked over yet.
screener.get("/auto", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT id, email, name, reason, source, created_at FROM auto_let_ins WHERE user_id = ? AND undone_at IS NULL AND seen_at IS NULL ORDER BY created_at DESC LIMIT 50`)
    .bind(c.get("user").id)
    .all();
  return c.json({ people: rows.results });
});

screener.post("/auto/seen", async (c) => {
  await c.env.DB.prepare(`UPDATE auto_let_ins SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL`).bind(now(), c.get("user").id).run();
  return c.json({ ok: true });
});

// Undo one: the person goes back to waiting in the Screener, their mail with them, and is never let in automatically again.
screener.post("/auto/:id/undo", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const row = await db.prepare(`SELECT * FROM auto_let_ins WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), userId).first<{ email: string; undone_at: number | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const contact = await db
    .prepare(`SELECT * FROM contacts WHERE lower(email) = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?) ORDER BY last_seen_at DESC LIMIT 1`)
    .bind(row.email, userId)
    .first<ContactRow>();
  if (contact) await applyScreenDecision(db, contact.account_id, contact, "pending");
  await logActivity(db, userId, { actor: "you", kind: "undo_let_in", summary: `Took back letting in ${row.email}`, why: "They wait in the Screener again and will not be let in automatically", accountId: contact?.account_id });
  await db.prepare(`UPDATE auto_let_ins SET undone_at = ? WHERE id = ?`).bind(now(), c.req.param("id")).run();
  return c.json({ ok: true });
});

const SCREENED_OUT_PAGE_SIZE = 50;

screener.get("/screened-out", async (c) => {
  const sc = inClause(c.get("accountIds"));
  const q = searchTerm((c.req.query("q") ?? "").trim());
  const like = `%${q}%`;
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query("page_size")) || SCREENED_OUT_PAGE_SIZE));
  // A contact row exists per (mailbox, sender); list each sender once, with the mailboxes that screened them out under `accounts`.
  // Paging happens after the merge, so a sender never straddles two pages.
  const rows = q
    ? await c.env.DB.prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND screen_status = 'screened_out' AND (email ILIKE ? OR name ILIKE ?) ORDER BY screened_at DESC NULLS LAST LIMIT 5000`).bind(...sc.params, like, like).all<ContactRow>()
    : await c.env.DB.prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND screen_status = 'screened_out' ORDER BY screened_at DESC NULLS LAST LIMIT 5000`).bind(...sc.params).all<ContactRow>();
  const merged = mergeContacts(rows.results).sort((a, b) => (b.screened_at ?? 0) - (a.screened_at ?? 0));
  const pages = Math.max(1, Math.ceil(merged.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(c.req.query("page"))) || 1));
  return c.json({ contacts: merged.slice((page - 1) * pageSize, page * pageSize), total: merged.length, page, pages, page_size: pageSize });
});

export default screener;
