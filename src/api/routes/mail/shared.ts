import { inClause } from "../../db";
import { searchTerm } from "../../input";
import type { ParsedSearch } from "@shared/searchQuery";

export const VISIBLE = `t.merged_into IS NULL AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?)`;
export const PAGE = 50;
/** What a search box may hold: past this it is a paste, not a question, and each word is another clause for the database to run. */
export const MAX_QUERY = 300;
/** A word is eight bound values and several clauses, so a few words are as many as a search can sensibly carry. */
export const MAX_SEARCH_TERMS = 6;
export const MAX_EXCLUDED_TERMS = 4;
export const capTerms = (p: ParsedSearch): ParsedSearch => ({
  ...p,
  terms: p.terms.slice(0, MAX_SEARCH_TERMS).map((t) => searchTerm(t)),
  excluded: p.excluded.slice(0, MAX_EXCLUDED_TERMS).map((t) => searchTerm(t)),
  from: searchTerm(p.from),
  to: searchTerm(p.to),
  filename: searchTerm(p.filename),
  mailbox: searchTerm(p.mailbox),
});

/** `t.account_id IN (...)` for the accounts in scope (one account, or all of the user's in unified scope). */
export function scope(c: any, alias = "t"): { sql: string; params: string[] } {
  const ids: string[] = c.get("accountIds") ?? [];
  const inc = inClause(ids);
  return { sql: `${alias}.account_id IN ${inc.sql}`, params: inc.params };
}
