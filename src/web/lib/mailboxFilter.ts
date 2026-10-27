import type { StalwartMailbox } from "@shared/types";

/** The "no domain filter" value. Cannot collide with a domain name. */
export const ALL_DOMAINS = "*";

/** How many mailboxes each domain has, domains in alphabetical order. */
export function domainCounts(list: StalwartMailbox[]): { domain: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of list) counts.set(m.domain, (counts.get(m.domain) ?? 0) + 1);
  return [...counts].map(([domain, count]) => ({ domain, count })).sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * Keep the mailboxes on one domain (or all of them) whose address or description contains every word
 * of the query, ignoring case and extra spaces. "dike sec" finds security@dike.it.com.
 */
export function filterMailboxes(list: StalwartMailbox[], domain: string, query: string): StalwartMailbox[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((m) => {
    if (domain !== ALL_DOMAINS && m.domain !== domain) return false;
    if (terms.length === 0) return true;
    const hay = `${m.email} ${m.description ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** One folder per domain, alphabetical, with the mailboxes inside each sorted by address. */
export function groupByDomain(list: StalwartMailbox[]): { domain: string; items: StalwartMailbox[] }[] {
  const groups = new Map<string, StalwartMailbox[]>();
  for (const m of list) groups.set(m.domain, [...(groups.get(m.domain) ?? []), m]);
  return [...groups]
    .map(([domain, items]) => ({ domain, items: [...items].sort((a, b) => a.email.localeCompare(b.email)) }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
