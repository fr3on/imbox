export interface Announceable {
  id: string;
  kind: string;
  at: number;
}

/**
 * Which items deserve a pop-up now. Only what is newer than the moment the app started watching (so opening it never replays the
 * inbox), that has not been announced before, and of a kind worth interrupting for: mail, a new sender, a mailbox that broke,
 * an invitation. Returned oldest first, so they pop up in the order they arrived.
 */
export function pickToAnnounce<T extends Announceable>(items: T[], announced: Set<string>, since: number): T[] {
  return items
    .filter((i) => i.at > since && !announced.has(i.id))
    .sort((a, b) => a.at - b.at);
}
