// Which threads were in the list you opened this one from, in order, so the thread page can step to the one before or after it without
// going back to the list. Kept in memory only; a thread opened some other way (a link, a search) simply has no neighbours.

let ids: string[] = [];

export function setThreadNav(list: string[]): void {
  ids = list;
}

export interface Neighbours {
  prev: string | null;
  next: string | null;
  /** 1-based position, and how many threads are in the list. */
  position: number;
  total: number;
}

export function threadNeighbours(id: string): Neighbours | null {
  const at = ids.indexOf(id);
  if (at < 0 || ids.length < 2) return null;
  return { prev: at > 0 ? ids[at - 1] : null, next: at < ids.length - 1 ? ids[at + 1] : null, position: at + 1, total: ids.length };
}
