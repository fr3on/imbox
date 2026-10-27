import type { Address, ThreadSummary } from "@shared/types";

export interface SentPerson {
  /** Their address, lower-case; the same person in two of your accounts is one entry. */
  key: string;
  person: Address;
  /** Every thread with them, newest first. */
  threads: ThreadSummary[];
  /** How many of those you wrote last on, still waiting for an answer. */
  waiting: number;
}

const DAY_MS = 86_400_000;

/** You wrote last, so the ball is with them. */
export function wroteLast(t: ThreadSummary, me: string): boolean {
  return t.last_from.email.toLowerCase() === me.toLowerCase();
}

/** Whole days since the thread last moved. 0 is today. */
export function daysSince(ms: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}

export function ageLabel(days: number): string {
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days`;
}

/**
 * The people you have written to, most recent first, each with their threads. A thread goes under the first person on it who is not
 * you; a thread with several people sits under the first of them. `myEmail` gives the address of the account a thread belongs to.
 */
export function groupByPerson(threads: ThreadSummary[], myEmail: (accountId: string) => string): SentPerson[] {
  const byKey = new Map<string, SentPerson>();
  for (const t of threads) {
    const me = myEmail(t.account_id).toLowerCase();
    const other = t.participants.find((p) => p.email.toLowerCase() !== me) ?? t.last_from;
    const key = other.email.toLowerCase();
    let g = byKey.get(key);
    if (!g) {
      g = { key, person: other, threads: [], waiting: 0 };
      byKey.set(key, g);
    }
    g.threads.push(t);
    if (wroteLast(t, me)) g.waiting++;
  }
  const people = [...byKey.values()];
  for (const g of people) g.threads.sort((a, b) => b.last_message_at - a.last_message_at);
  return people.sort((a, b) => b.threads[0].last_message_at - a.threads[0].last_message_at);
}
