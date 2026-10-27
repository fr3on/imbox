import { type QueryClient } from "@tanstack/react-query";

export const keys = {
  me: ["me"] as const,
  counts: ["counts"] as const,
  imbox: ["imbox"] as const,
  threads: (bucket: string, q?: string, label?: string, extra?: string) => ["threads", bucket, q ?? "", label ?? "", extra ?? ""] as const,
  feed: (bucket: "feed" | "paper_trail" | "library" = "feed") => ["feed", bucket] as const,
  /**
   * A peek and a real open are two different queries. A peek (`?peek=1`) leaves the thread unread on
   * the server; an open marks it read. They shared one key, and the assistant panel peeks whatever
   * thread is on screen — so opening a thread raced its own peek, the peek usually won, and the
   * thread stayed unread until something else happened to refetch it. That was the lag.
   */
  thread: (id: string, peek = false) => (peek ? (["thread", id, "peek"] as const) : (["thread", id] as const)),
  screener: ["screener"] as const,
  screenedOut: ["screened-out"] as const,
  contacts: (q: string) => ["contacts", q] as const,
  contact: (id: string) => ["contact", id] as const,
  labels: ["labels"] as const,
  collections: ["collections"] as const,
  collection: (id: string) => ["collection", id] as const,
  clips: ["clips"] as const,
  files: ["files"] as const,
  drafts: ["drafts"] as const,
  search: (q: string, sort = "best", exact = false, relax = false) => ["search", q, sort, exact, relax] as const,
  savedSearches: ["saved-searches"] as const,
  extensionTokens: ["extension-tokens"] as const,
  // Calendar. Every calendar key starts with "cal" so invalidateCalendar can sweep them in one call.
  calRange: (from: string, to: string) => ["cal", "range", from, to] as const,
  calSources: ["cal", "sources"] as const,
  calDay: (d: string) => ["cal", "day", d] as const,
  dayCovers: ["cal", "covers"] as const,
  calSettings: ["cal", "settings"] as const,
};

export function invalidateMail(qc: QueryClient) {
  for (const k of [["imbox"], ["threads"], ["feed"], ["thread"], ["counts"], ["screener"], ["screened-out"], ["search"], ["collection"], ["contact"], ["clips"]]) {
    qc.invalidateQueries({ queryKey: k });
  }
}

/** Invalidate every calendar cache: ranges, sources, days, settings. */
export function invalidateCalendar(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["cal"] });
}
