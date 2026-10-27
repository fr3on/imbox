import type { ThreadRow } from "./db";
import type { ParsedSearch } from "@shared/searchQuery";
import { scoreThread } from "./searchRank";

export { addFiles, addMatches } from "./searchRank";

// Finding mail: which conversations match (this file), how they are put in order and shown (searchRank), and the counts that let a
// search be narrowed (searchFacets). Every word has to be somewhere in the conversation (not necessarily next to the others, or in the same message), the
// results are put best match first, and each one says where its words were found and shows the line around them.

/** How many of the newest matches are ranked. Beyond this, matches are older and ranked as the page after. */
const CANDIDATES = 300;

const like = (term: string) => `%${term}%`;

/**
 * The text of a thread that a search looks in, and of its messages, as one string each. The two expressions are written the same way in the
 * migration that indexes them (0023_search_indexes.sql), which is what lets a search use the index instead of reading every message; change one and
 * the other must change with it. chr(31) keeps a phrase from matching across two fields.
 */
export const THREAD_TEXT = (a: string) => `${a}.subject || chr(31) || COALESCE(${a}.custom_subject, '') || chr(31) || ${a}.snippet || chr(31) || ${a}.participants_json || chr(31) || ${a}.note`;
export const MESSAGE_TEXT = (a: string) => `${a}.from_email || chr(31) || ${a}.subject || chr(31) || ${a}.text_body`;
/** The recipients of a message, as migration 0033_person_indexes.sql writes them: the people it was sent to, then the people copied. */
export const RECIPIENTS_TEXT = (a: string) => `${a}.to_json || chr(31) || ${a}.cc_json`;
/** An address book entry's address and name, as the same migration writes them. */
export const ADDRESS_TEXT = (a: string) => `${a}.email || chr(31) || ${a}.name`;
/** The same for a contact: its address, name and notes, written as migration 0031_contacts_search.sql writes them. */
export const CONTACT_TEXT = (a: string) => `${a}.email || chr(31) || ${a}.name || chr(31) || ${a}.notes`;

/** A word in at least this many messages is "common": the newest few hundred matches are found sooner by walking the threads newest first. */
const COMMON_AT = 1000;

/**
 * Which of the search's words are common. Two ways to find a word are fast, for opposite cases: for a rare one, the index lists the few threads that
 * hold it; for a common one, walking the threads newest first stops after the first few hundred matches, where the index would list every thread.
 * One short query per word tells them apart, and it stops counting at COMMON_AT.
 *
 * The answer for a word hardly changes (it takes a thousand more messages to flip it), and finding it for a common word reads a thousand messages, about
 * a third of what a search costs the database. So an answer is kept for ten minutes, for up to COMMON_KEPT words. It is asked of every message, not of the
 * searcher's: it only picks a way of looking, never what is found.
 */
const COMMON_KEPT = 2000;
const COMMON_FOR = 10 * 60_000;
const known = new Map<string, { common: boolean; at: number }>();

/** Forget what is known about words (for a test that changes the messages). */
export function clearCommonTerms(): void {
  known.clear();
}

export async function commonTerms(db: Db, parsed: ParsedSearch, now = Date.now()): Promise<Set<string>> {
  const common = new Set<string>();
  await Promise.all(
    [...new Set([...parsed.terms, ...parsed.excluded])].map(async (term) => {
      const kept = known.get(term);
      if (kept && now - kept.at < COMMON_FOR) {
        if (kept.common) common.add(term);
        return;
      }
      const r = await db.prepare(`SELECT 1 AS x FROM messages m WHERE (${MESSAGE_TEXT("m")}) ILIKE ? LIMIT 1 OFFSET ${COMMON_AT - 1}`).bind(like(term)).first();
      known.delete(term);
      known.set(term, { common: !!r, at: now });
      // The oldest answer goes first, so the words people keep asking about stay.
      if (known.size > COMMON_KEPT) known.delete(known.keys().next().value as string);
      if (r) common.add(term);
    })
  );
  return common;
}

/** SQL that is true when `term` is in the conversation: its subject, people, note, preview, or the text of any message in it. */
export function termSql(term: string, common = false): { sql: string; params: string[] } {
  const l = like(term);
  if (common) {
    return { sql: `((${THREAD_TEXT("t")}) ILIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND (${MESSAGE_TEXT("m")}) ILIKE ?))`, params: [l, l] };
  }
  return {
    sql: `t.id IN (SELECT x.id FROM threads x WHERE (${THREAD_TEXT("x")}) ILIKE ? UNION SELECT m.thread_id FROM messages m WHERE (${MESSAGE_TEXT("m")}) ILIKE ?)`,
    params: [l, l],
  };
}

/** Everything after the account limit in the WHERE clause. */
export function threadFilters(parsed: ParsedSearch, common: Set<string> = new Set()): { sql: string[]; params: unknown[] } {
  const sql: string[] = ["t.merged_into IS NULL"];
  const params: unknown[] = [];
  if (parsed.bucket === "updates") sql.push("t.bucket IN ('feed', 'paper_trail')");
  else if (parsed.bucket) {
    sql.push("t.bucket = ?");
    params.push(parsed.bucket);
  } else sql.push("t.bucket <> 'trash'");
  if (parsed.unread !== null) {
    sql.push("t.seen = ?");
    params.push(parsed.unread ? 0 : 1);
  }
  if (parsed.hasAttachment) sql.push("EXISTS (SELECT 1 FROM attachments a WHERE a.thread_id = t.id AND a.is_inline = 0)");
  if (parsed.filename) {
    sql.push("EXISTS (SELECT 1 FROM attachments a WHERE a.thread_id = t.id AND a.is_inline = 0 AND a.filename ILIKE ?)");
    params.push(like(parsed.filename));
  }
  if (parsed.mailbox) {
    sql.push("t.account_id IN (SELECT id FROM accounts WHERE email ILIKE ?)");
    params.push(like(parsed.mailbox));
  }
  if (parsed.from) {
    sql.push("(t.last_from_email ILIKE ? OR t.participants_json ILIKE ?)");
    params.push(`%${parsed.from}%`, `%${parsed.from}%`);
  }
  if (parsed.to) {
    sql.push("EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND (m.to_json ILIKE ? OR m.cc_json ILIKE ?))");
    params.push(`%${parsed.to}%`, `%${parsed.to}%`);
  }
  if (parsed.after !== null) {
    sql.push("t.last_message_at >= ?");
    params.push(parsed.after);
  }
  if (parsed.before !== null) {
    sql.push("t.last_message_at < ?");
    params.push(parsed.before);
  }
  for (const term of parsed.terms) {
    const t = termSql(term, common.has(term));
    sql.push(t.sql);
    params.push(...t.params);
  }
  for (const word of parsed.excluded) {
    const t = termSql(word, common.has(word));
    sql.push(`NOT ${t.sql}`);
    params.push(...t.params);
  }
  return { sql, params };
}

/** The best-matching conversations of this page, in order, and whether more follow. */
export async function searchThreads(
  db: Db,
  accountSql: string,
  accountParams: string[],
  parsed: ParsedSearch,
  /** `common`: the words already known to be common, when the caller has asked (a search asks once and shares the answer). */
  opts: { sort: "best" | "newest"; page: number; pageSize: number; now?: number; common?: Set<string> }
): Promise<{ rows: ThreadRow[]; hasMore: boolean }> {
  const f = threadFilters(parsed, opts.common ?? (await commonTerms(db, parsed)));
  const where = [accountSql, ...f.sql].join(" AND ");
  const { sort, page, pageSize } = opts;
  const now = opts.now ?? Date.now();
  if (sort === "newest" || !parsed.terms.length) {
    const r = await db
      .prepare(`SELECT t.* FROM threads t WHERE ${where} ORDER BY t.last_message_at DESC LIMIT ? OFFSET ?`)
      .bind(...accountParams, ...f.params, pageSize + 1, page * pageSize)
      .all<ThreadRow>();
    return { rows: r.results.slice(0, pageSize), hasMore: r.results.length > pageSize };
  }
  const r = await db
    .prepare(`SELECT t.* FROM threads t WHERE ${where} ORDER BY t.last_message_at DESC LIMIT ?`)
    .bind(...accountParams, ...f.params, CANDIDATES)
    .all<ThreadRow>();
  const ranked = r.results
    .map((t) => ({ t, s: scoreThread(t, parsed.terms, now) }))
    .sort((a, b) => b.s - a.s || b.t.last_message_at - a.t.last_message_at)
    .map((x) => x.t);
  const from = page * pageSize;
  return { rows: ranked.slice(from, from + pageSize), hasMore: ranked.length > from + pageSize };
}
