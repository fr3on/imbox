// Letting obvious people in without asking, the "Let obvious people in" setting. Two kinds of sender qualify with no model involved: someone
// in your address book, and someone answering a mail you sent. Both are checked while mail is stored, so they never wait in the Screener.
// The AI's part (a sender it is sure is a person writing to you) is in autoletin-job.ts. Anything let in is logged, so it can be undone.

import type { ParsedMessage } from "./mime";
import { uid, now, chunk, safeJson } from "./db";
import type { UserSettings } from "@shared/types";

export async function autoLetInOn(db: Db, userId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT settings_json FROM users WHERE id = ?`).bind(userId).first<{ settings_json: string }>();
  return safeJson<UserSettings>(row?.settings_json ?? "{}", {}).autoLetIn === true;
}

/** Newsletters and other bulk mail are never let in by a rule, even from someone in your address book. */
export function isBulk(h: { list_unsubscribe?: string; list_id?: string; precedence?: string }): boolean {
  return !!h.list_unsubscribe?.trim() || !!h.list_id?.trim() || /bulk|list|junk/i.test(h.precedence ?? "");
}

/** Senders the person has undone: they are never let in automatically again. */
export async function undoneEmails(db: Db, userId: string, emails: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunk([...new Set(emails.map((e) => e.toLowerCase()))], 90)) {
    if (!part.length) continue;
    const rows = await db
      .prepare(`SELECT email FROM auto_let_ins WHERE user_id = ? AND undone_at IS NOT NULL AND email IN (${part.map(() => "?").join(",")})`)
      .bind(userId, ...part)
      .all<{ email: string }>();
    for (const r of rows.results) out.add(r.email);
  }
  return out;
}

const idsIn = (...fields: string[]) => fields.flatMap((f) => f.match(/<[^>\s]+>/g) ?? []);

/**
 * Which of these incoming messages are from someone to let in, and why. Pass only mail from senders still waiting. The key is the sender's
 * lowercase address.
 */
export async function ruleLetIns(db: Db, userId: string, incoming: ParsedMessage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const plain = incoming.filter((p) => p.from.email && !isBulk({ list_unsubscribe: p.listUnsubscribe, list_id: p.listId, precedence: p.precedence }));
  if (!plain.length) return out;
  const undone = await undoneEmails(db, userId, plain.map((p) => p.from.email));
  const eligible = plain.filter((p) => !undone.has(p.from.email.toLowerCase()));
  if (!eligible.length) return out;

  // Answering a mail you sent.
  const asked = [...new Set(eligible.flatMap((p) => idsIn(p.inReplyTo, p.references)))];
  const mine = new Set<string>();
  for (const part of chunk(asked, 90)) {
    const rows = await db
      .prepare(`SELECT message_id_header AS id FROM messages WHERE is_from_me = 1 AND account_id IN (SELECT id FROM accounts WHERE user_id = ?) AND message_id_header IN (${part.map(() => "?").join(",")})`)
      .bind(userId, ...part)
      .all<{ id: string }>();
    for (const r of rows.results) mine.add(r.id);
  }
  for (const p of eligible) {
    if (idsIn(p.inReplyTo, p.references).some((id) => mine.has(id))) out.set(p.from.email.toLowerCase(), "Replied to a mail you sent");
  }

  // In your address book.
  const left = [...new Set(eligible.map((p) => p.from.email.toLowerCase()))].filter((e) => !out.has(e));
  for (const part of chunk(left, 90)) {
    const rows = await db
      .prepare(`SELECT DISTINCT lower(email) AS email FROM address_book WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?) AND lower(email) IN (${part.map(() => "?").join(",")})`)
      .bind(userId, ...part)
      .all<{ email: string }>();
    for (const r of rows.results) out.set(r.email, "In your address book");
  }
  return out;
}

/** The statement that records one let-in. Writing it again for the same sender refreshes it, unless they were undone. */
export function logLetIn(db: Db, userId: string, email: string, name: string, reason: string, source: "rules" | "ai"): DbStatement {
  return db
    .prepare(
      `INSERT INTO auto_let_ins (id, user_id, email, name, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, email) DO UPDATE SET name = excluded.name, reason = excluded.reason, source = excluded.source, created_at = excluded.created_at, seen_at = NULL
       WHERE auto_let_ins.undone_at IS NULL`
    )
    .bind(uid(), userId, email.toLowerCase(), name, reason, source, now());
}
