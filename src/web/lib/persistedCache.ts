/** localStorage key the React Query persister (wired up in main.tsx) reads and writes. */
export const PERSIST_KEY = "inbox-query-cache";

/**
 * `qc.clear()` empties the in-memory cache; the persister mirrors that to localStorage on its own
 * debounce, but logout navigates away immediately after, so drop the copy on disk right here too —
 * otherwise the next person to log in on this browser would paint from the last person's mail.
 */
export function clearPersistedCache() {
  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
}
