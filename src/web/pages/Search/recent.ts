export const RECENT_KEY = "inbox.search.recent";

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

/** Searches you ran lately, newest first. Kept in this browser only; losing them just means the list is empty. */
export function rememberSearch(q: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 6)));
  } catch {
    /* storage can be blocked */
  }
}
