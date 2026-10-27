import type { ThreadRow } from "./db";
import type { ThreadSummary } from "@shared/types";
import { highlightTerms, type ParsedSearch } from "@shared/searchQuery";
import { readableText } from "@shared/readable";

// Putting found conversations in order, and saying why each one was found: the score, the line of text around the words, and the files in it.

const DAY = 86_400_000;
const like = (term: string) => `%${term}%`;

const has = (hay: string | null | undefined, term: string) => !!hay && hay.toLowerCase().includes(term);

/** How well a conversation matches: a word in the subject counts most, then in who it is with, then the note and preview, then the body. A little extra for newer. */
export function scoreThread(t: ThreadRow, terms: string[], now: number): number {
  let score = 0;
  const subject = `${t.custom_subject ?? ""} ${t.subject}`;
  const people = `${t.participants_json} ${t.last_from_email} ${t.last_from_name}`;
  for (const raw of terms) {
    const term = raw.toLowerCase();
    if (has(subject, term)) score += 8;
    else if (has(people, term)) score += 5;
    else if (has(t.note, term)) score += 3;
    else if (has(t.snippet, term)) score += 3;
    else score += 1;
  }
  const ageDays = Math.max(0, (now - t.last_message_at) / DAY);
  return score + 2 * Math.exp(-ageDays / 90);
}

/** About 180 characters of `text` around the first of `terms` it contains, with "…" where it was cut. Empty when none is there. */
export function excerptAround(text: string, terms: string[]): string {
  const flat = readableText(text).replace(/\s+/g, " ").trim();
  const low = flat.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return "";
  const start = Math.max(0, at - 70);
  const end = Math.min(flat.length, at + 120);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** Adds `match` to each result: where the words were found, and the line of the newest message that has one. */
export async function addMatches(db: Db, rows: ThreadRow[], summaries: ThreadSummary[], parsed: ParsedSearch): Promise<ThreadSummary[]> {
  const terms = highlightTerms(parsed);
  if (!terms.length || !rows.length) return summaries;
  const ph = rows.map(() => "?").join(",");
  const first = like(terms[0]);
  const msgs = await db
    .prepare(
      `SELECT thread_id, substr(text_body, 1, 40000) AS body FROM messages WHERE thread_id IN (${ph}) AND text_body ILIKE ? ORDER BY date DESC LIMIT 400`
    )
    .bind(...rows.map((r) => r.id), first)
    .all<{ thread_id: string; body: string }>();
  const body = new Map<string, string>();
  for (const m of msgs.results) {
    if (body.has(m.thread_id)) continue;
    const e = excerptAround(m.body, terms);
    if (e) body.set(m.thread_id, e);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return summaries.map((s) => {
    const t = byId.get(s.id);
    if (!t) return s;
    const excerpt = body.get(s.id) ?? "";
    const subject = `${t.custom_subject ?? ""} ${t.subject}`;
    const people = `${t.participants_json} ${t.last_from_email} ${t.last_from_name}`;
    const any = (hay: string) => terms.some((w) => has(hay, w));
    const why = any(subject) ? "subject" : any(people) ? "sender" : any(t.note ?? "") ? "note" : "body";
    return { ...s, match: { why, excerpt } };
  });
}

/** Adds the first few files of each result (not inline pictures), so a search for an invoice shows the invoice. */
export async function addFiles(db: Db, ids: string[], summaries: ThreadSummary[]): Promise<ThreadSummary[]> {
  if (!ids.length) return summaries;
  const ph = ids.map(() => "?").join(",");
  const rows = await db
    .prepare(`SELECT id, message_id, thread_id, filename, mime_type, size FROM attachments WHERE thread_id IN (${ph}) AND is_inline = 0 AND filename <> '' ORDER BY created_at DESC LIMIT 300`)
    .bind(...ids)
    .all<{ id: string; message_id: string; thread_id: string; filename: string; mime_type: string; size: number }>();
  const by = new Map<string, NonNullable<ThreadSummary["found_files"]>>();
  for (const r of rows.results) {
    const a = by.get(r.thread_id) ?? [];
    if (a.length < 3) a.push({ id: r.id, message_id: r.message_id, filename: r.filename, mime_type: r.mime_type, size: r.size });
    by.set(r.thread_id, a);
  }
  return summaries.map((s) => (by.has(s.id) ? { ...s, found_files: by.get(s.id) } : s));
}
