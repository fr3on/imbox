import type { MergedContact, ScreenStatus } from "@shared/types";

export type ContactKind = "person" | "service";
export type ContactTab = "all" | "people" | "services" | "waiting" | "out";
export type ContactSort = "latest" | "name" | "messages";

// Addresses and names that are plainly a machine: no-reply senders, mail-system notices, notifications.
const AUTOMATED_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer[-_.]?daemon|postmaster|bounces?|alerts?|newsletter|automated|auto[-_.]?reply)\b/i;
const AUTOMATED_NAME = /\b(mail delivery|no[- ]?reply|noreply|notifications?|newsletter|automated|postmaster)\b/i;

/**
 * A person, or a service that writes to you. Something that sends from a no-reply address, or that you have sorted into Feeds or the
 * Paper Trail, is a service; the rest are people. It is a guess, meant only to keep the two apart on the Contacts page.
 */
export function contactKind(c: Pick<MergedContact, "email" | "name" | "screen_status">): ContactKind {
  const local = c.email.split("@")[0] ?? "";
  if (AUTOMATED_LOCAL.test(local) || AUTOMATED_NAME.test(c.name ?? "")) return "service";
  return c.screen_status === "feed" || c.screen_status === "paper_trail" ? "service" : "person";
}

/** What the person says it is, by address, when they have corrected the guess. */
export type KindOverrides = Record<string, ContactKind>;
export const kindOf = (c: MergedContact, overrides?: KindOverrides): ContactKind => overrides?.[c.email.toLowerCase()] ?? contactKind(c);

const inTab = (c: MergedContact, tab: ContactTab, overrides?: KindOverrides): boolean => {
  const status: ScreenStatus = c.screen_status;
  switch (tab) {
    case "waiting":
      return status === "pending";
    case "out":
      return status === "screened_out";
    case "people":
      return status !== "pending" && status !== "screened_out" && kindOf(c, overrides) === "person";
    case "services":
      return status !== "pending" && status !== "screened_out" && kindOf(c, overrides) === "service";
    default:
      return true;
  }
};

/** How many contacts each tab would show, so the tabs can carry their counts. */
export function tabCounts(list: MergedContact[], overrides?: KindOverrides): Record<ContactTab, number> {
  const out: Record<ContactTab, number> = { all: list.length, people: 0, services: 0, waiting: 0, out: 0 };
  for (const c of list) for (const t of ["people", "services", "waiting", "out"] as const) if (inTab(c, t, overrides)) out[t] += 1;
  return out;
}

export function filterContacts(list: MergedContact[], tab: ContactTab, destination: ScreenStatus | "any", overrides?: KindOverrides): MergedContact[] {
  return list.filter((c) => inTab(c, tab, overrides) && (destination === "any" || c.screen_status === destination || (destination === "feed" && c.screen_status === "paper_trail")));
}

const label = (c: MergedContact) => (c.name || c.email.split("@")[0]).toLowerCase();

export function sortContacts(list: MergedContact[], sort: ContactSort): MergedContact[] {
  const out = [...list];
  if (sort === "name") return out.sort((a, b) => label(a).localeCompare(label(b)));
  if (sort === "messages") return out.sort((a, b) => b.message_count - a.message_count || b.last_seen_at - a.last_seen_at);
  return out.sort((a, b) => b.last_seen_at - a.last_seen_at);
}
