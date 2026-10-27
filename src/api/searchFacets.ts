import { type ParsedSearch } from "@shared/searchQuery";
import { commonTerms, threadFilters } from "./search";

// The counts that let a search be narrowed with a click: who the mail is from, where it sits, which year, which mailbox. They are counted over
// the newest few hundred matches of the words alone (the filters these counts would change are left off), so each button shows what it would give.

const SAMPLE = 500;

export interface SearchFacets {
  senders: { email: string; name: string; count: number }[];
  places: { bucket: string; count: number }[];
  years: { year: number; count: number }[];
  mailboxes: { email: string; count: number }[];
}

export async function searchFacets(db: Db, accountSql: string, accountParams: string[], parsed: ParsedSearch, common?: Set<string>): Promise<SearchFacets> {
  const narrowed = { ...parsed, from: "", bucket: "", after: null, before: null, mailbox: "" };
  const f = threadFilters(narrowed, common ?? (await commonTerms(db, narrowed)));
  const rows = await db
    .prepare(`SELECT t.last_from_email AS email, t.last_from_name AS name, t.bucket, t.last_message_at AS at, t.account_id FROM threads t WHERE ${[accountSql, ...f.sql].join(" AND ")} ORDER BY t.last_message_at DESC LIMIT ${SAMPLE}`)
    .bind(...accountParams, ...f.params)
    .all<{ email: string; name: string; bucket: string; at: number; account_id: string }>();
  const senders = new Map<string, { email: string; name: string; count: number }>();
  const places = new Map<string, number>();
  const years = new Map<number, number>();
  const boxes = new Map<string, number>();
  for (const r of rows.results) {
    const key = (r.email || "").toLowerCase();
    if (key) {
      const s = senders.get(key) ?? { email: r.email, name: r.name || "", count: 0 };
      s.count++;
      if (!s.name && r.name) s.name = r.name;
      senders.set(key, s);
    }
    // Feeds and Paper Trail are both Updates to the person, so they are counted as one place.
    const place = r.bucket === "feed" || r.bucket === "paper_trail" ? "updates" : r.bucket;
    places.set(place, (places.get(place) ?? 0) + 1);
    const y = new Date(r.at).getUTCFullYear();
    years.set(y, (years.get(y) ?? 0) + 1);
    boxes.set(r.account_id, (boxes.get(r.account_id) ?? 0) + 1);
  }
  let mailboxes: SearchFacets["mailboxes"] = [];
  if (boxes.size > 1) {
    const ids = [...boxes.keys()];
    const em = await db
      .prepare(`SELECT id, email FROM accounts WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ id: string; email: string }>();
    mailboxes = em.results.map((a) => ({ email: a.email, count: boxes.get(a.id) ?? 0 })).sort((a, b) => b.count - a.count);
  }
  return {
    senders: [...senders.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    places: [...places].map(([bucket, count]) => ({ bucket, count })).sort((a, b) => b.count - a.count),
    years: [...years].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year),
    mailboxes,
  };
}
