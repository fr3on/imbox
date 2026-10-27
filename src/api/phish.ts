// What the owner decided about senders: Report remembers a sender (or a whole domain), "Looks fine" remembers a sender. The detector reads it back.

import { isSharedMailDomain } from "@shared/phishing";
import { now } from "./db";

export type Verdict = "bad" | "ok";

const domainOf = (email: string) => email.split("@").pop()?.trim().toLowerCase() ?? "";

/** A report is about the whole domain unless it is one anyone can have an address at; "looks fine" is only ever about the one address. */
export function verdictKey(email: string, verdict: Verdict): string {
  const e = email.trim().toLowerCase();
  const d = domainOf(e);
  return verdict === "bad" && d && !isSharedMailDomain(d) ? `@${d}` : e;
}

/** The keys to look under for a sender: the address first, then its domain. */
export const verdictKeys = (email: string): [string, string] => {
  const e = email.trim().toLowerCase();
  return [e, `@${domainOf(e)}`];
};

export async function recordVerdict(db: Db, userId: string, email: string, verdict: Verdict): Promise<void> {
  if (!email.includes("@")) return;
  await db
    .prepare(`INSERT INTO phish_verdicts (user_id, key, verdict, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at`)
    .bind(userId, verdictKey(email, verdict), verdict, now())
    .run();
}

/** Who the latest message of a thread that is not from the owner came from. */
export async function lastSenderOf(db: Db, threadId: string): Promise<string | null> {
  const r = await db.prepare(`SELECT from_email FROM messages WHERE thread_id = ? AND is_from_me = 0 ORDER BY date DESC LIMIT 1`).bind(threadId).first<{ from_email: string }>();
  return r?.from_email || null;
}
