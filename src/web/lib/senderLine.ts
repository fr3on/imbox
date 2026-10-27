import type { ThreadSummary } from "@shared/types";

/**
 * Who a thread is between. Pass the mailbox's own address and your side reads as "You" rather than as your own name, so a
 * thread you last wrote in says who you wrote to ("You → Pat") instead of listing your address among the senders.
 */
export function senderLine(t: ThreadSummary, me?: string): string {
  const mine = (me ?? "").toLowerCase();
  const isMe = (email: string) => !!mine && email.toLowerCase() === mine;
  const short = (p: { name?: string; email: string }) => p.name?.trim().split(" ")[0] || p.email.split("@")[0];
  const others = t.participants.filter((p) => p.email !== t.last_from.email && !isMe(p.email));
  if (isMe(t.last_from.email)) {
    if (others.length === 0) return "You";
    const rest = others.length - 1;
    return `You → ${short(others[0])}${rest > 0 ? ` +${rest}` : ""}`;
  }
  const first = t.last_from.name?.trim() || t.last_from.email;
  if (others.length === 0) return first;
  const names = [first, ...others.map(short)];
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}
