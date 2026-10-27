import type { Message } from "@shared/types";

export function isBounceMessage(m: Message): boolean {
  const email = (m.from.email || "").toLowerCase();
  const name = (m.from.name || "").toLowerCase();
  const snip = (m.snippet || "").toLowerCase();
  const sub = (m.subject || "").toLowerCase();
  return (
    email.startsWith("postmaster@") ||
    email.startsWith("mailer-daemon@") ||
    name.includes("mail delivery subsystem") ||
    name.includes("postmaster") ||
    snip.includes("delivery has failed") ||
    snip.includes("address not found") ||
    snip.includes("mailbox is full") ||
    sub.startsWith("undeliverable:") ||
    sub.startsWith("delivery status notification")
  );
}

type TimelineItem =
  | { type: "message"; message: Message; index: number }
  | { type: "bounces"; count: number; messages: Message[] };

export function buildTimelineItems(messages: Message[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let currentBounces: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (isBounceMessage(m)) {
      currentBounces.push(m);
    } else {
      if (currentBounces.length > 0) {
        items.push({ type: "bounces", count: currentBounces.length, messages: currentBounces });
        currentBounces = [];
      }
      items.push({ type: "message", message: m, index: i });
    }
  }
  if (currentBounces.length > 0) {
    items.push({ type: "bounces", count: currentBounces.length, messages: currentBounces });
  }
  return items;
}
