import type { Account } from "@shared/types";

/** The part after the last @, lower-cased. Empty when there is none. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).toLowerCase();
}

/** The part before the last @, or the whole string when there is no @. */
export function emailLocal(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? email : email.slice(0, at);
}

/** Every word of the query must appear in the address or display name, in any order, ignoring case. */
export function matchesAccount(a: Account, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${a.email} ${a.display_name ?? ""}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** One group per email domain, domains alphabetical, accounts by address — after applying the search. */
export function groupAccounts(accounts: Account[], query = ""): { domain: string; items: Account[] }[] {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    if (!matchesAccount(a, query)) continue;
    const d = emailDomain(a.email);
    groups.set(d, [...(groups.get(d) ?? []), a]);
  }
  return [...groups]
    .map(([domain, items]) => ({ domain, items: [...items].sort((x, y) => x.email.localeCompare(y.email)) }))
    .sort((x, y) => x.domain.localeCompare(y.domain));
}

/** True when an account needs the person's attention: a sync error, or one that stopped syncing. */
export function needsAttention(a: Account): boolean {
  return a.sync_status === "error" || a.sync_status === "disconnected";
}
