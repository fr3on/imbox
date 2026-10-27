import { inClause } from "./db";
import { RECIPIENTS_TEXT } from "./search";

// What the mail itself says about one person: what is open between you, how often you wrote over the months, and the files you swapped.
// All of it comes from messages already stored. Nothing here calls out or uses a model.

const DAY = 86_400_000;
/** Older than this and a conversation is history, not something open. */
const OPEN_WINDOW_DAYS = 120;
/** A message you sent a moment ago is not "waiting" yet. */
const NUDGE_AFTER_DAYS = 2;
const CHART_MONTHS = 36;

export interface OpenLoop {
  thread_id: string;
  account_id: string;
  subject: string;
  at: number;
  days: number;
}

export interface ContactInsights {
  waiting_on_you: OpenLoop[];
  waiting_on_them: OpenLoop[];
  /** Messages per month, oldest first, with no gaps. `m` is "YYYY-MM". */
  months: { m: string; n: number }[];
  busiest: { m: string; n: number } | null;
  files: { id: string; filename: string; size: number; at: number; thread_id: string }[];
  file_count: number;
  /** How many conversations they have had with you, for the "let them in" nudge. */
  conversations: number;
}

const toMs = (n: number) => (n < 1e12 ? n * 1000 : n);

export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Counts per month from the first message to `now`, the last CHART_MONTHS of them, with empty months kept so gaps show as gaps. */
export function monthSeries(dates: number[], now: number): { m: string; n: number }[] {
  if (!dates.length) return [];
  const counts = new Map<string, number>();
  let first = Infinity;
  for (const raw of dates) {
    const ms = toMs(raw);
    first = Math.min(first, ms);
    const k = monthOf(ms);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: { m: string; n: number }[] = [];
  const start = new Date(first);
  const end = new Date(now);
  let y = start.getUTCFullYear();
  let mo = start.getUTCMonth();
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && mo <= end.getUTCMonth())) {
    const k = `${y}-${String(mo + 1).padStart(2, "0")}`;
    out.push({ m: k, n: counts.get(k) ?? 0 });
    mo += 1;
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
  }
  return out.slice(-CHART_MONTHS);
}

/** Messages from them (btree on `from_email`) or to them (the trigram index over both recipient lists, migration 0033). */
const WITH_THEM = `(m.from_email = ? OR (${RECIPIENTS_TEXT("m")}) ILIKE ?)`;

export async function contactInsights(db: Db, accountIds: string[], email: string, now = Date.now()): Promise<ContactInsights> {
  const sc = inClause(accountIds);
  const like = `%"${email}"%`;
  const empty: ContactInsights = { waiting_on_you: [], waiting_on_them: [], months: [], busiest: null, files: [], file_count: 0, conversations: 0 };
  if (!accountIds.length) return empty;

  // Every message with them, newest first: theirs, and yours to them.
  const msgs = await db
    .prepare(
      `SELECT m.thread_id, m.account_id, m.is_from_me, m.date, m.subject, m.list_unsubscribe, t.bucket, t.custom_subject
       FROM messages m JOIN threads t ON t.id = m.thread_id
       WHERE m.account_id IN ${sc.sql} AND t.merged_into IS NULL AND ${WITH_THEM}
       ORDER BY m.date DESC LIMIT 20000`
    )
    .bind(...sc.params, email, like)
    .all<{ thread_id: string; account_id: string; is_from_me: number; date: number; subject: string; list_unsubscribe: string; bucket: string; custom_subject: string | null }>();

  const rows = msgs.results;
  const months = monthSeries(rows.map((r) => r.date), now);
  const busiest = months.reduce<{ m: string; n: number } | null>((b, x) => (x.n > 0 && (!b || x.n > b.n) ? x : b), null);

  // The newest message of each conversation says who spoke last.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.thread_id)) latest.set(r.thread_id, r);

  const waiting_on_you: OpenLoop[] = [];
  const waiting_on_them: OpenLoop[] = [];
  for (const r of latest.values()) {
    if (r.bucket === "trash" || r.bucket === "screened_out") continue;
    const at = toMs(r.date);
    const days = Math.floor((now - at) / DAY);
    if (days > OPEN_WINDOW_DAYS) continue;
    const loop: OpenLoop = { thread_id: r.thread_id, account_id: r.account_id, subject: r.custom_subject || r.subject || "(no subject)", at, days };
    if (!r.is_from_me) {
      // Mass mail does not wait for an answer.
      if (!r.list_unsubscribe) waiting_on_you.push(loop);
    } else if (days >= NUDGE_AFTER_DAYS) {
      waiting_on_them.push(loop);
    }
  }
  waiting_on_you.sort((a, b) => b.days - a.days);
  waiting_on_them.sort((a, b) => b.days - a.days);

  const fileWhere = `a.account_id IN ${sc.sql} AND a.is_inline = 0 AND ${WITH_THEM}`;
  const [files, fileCount] = await Promise.all([
    db
      .prepare(`SELECT a.id, a.filename, a.size, a.created_at, a.thread_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE ${fileWhere} ORDER BY m.date DESC LIMIT 5`)
      .bind(...sc.params, email, like)
      .all<{ id: string; filename: string; size: number; created_at: number; thread_id: string }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM attachments a JOIN messages m ON m.id = a.message_id WHERE ${fileWhere}`)
      .bind(...sc.params, email, like)
      .first<{ n: number }>(),
  ]);

  return {
    waiting_on_you: waiting_on_you.slice(0, 4),
    waiting_on_them: waiting_on_them.slice(0, 4),
    months,
    busiest,
    files: files.results.map((f) => ({ id: f.id, filename: f.filename, size: f.size, at: toMs(f.created_at), thread_id: f.thread_id })),
    file_count: fileCount?.n ?? 0,
    conversations: latest.size,
  };
}
