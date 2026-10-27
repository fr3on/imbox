import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "@shared/types";
import { html, NOW } from "./render";
import { ContactThreads, plain } from "@/components/ContactThreads";

// A contact's conversations: what waits on you first, then the rest by month.

const t = (id: string, subject: string, at: number, unread = false) =>
  ({ id, subject, snippet: "hello there", unread, last_from: { email: "a@b.co", name: "Ann" }, last_message_at: at } as unknown as ThreadSummary);

const DAY = 86_400_000;

describe("ContactThreads", () => {
  it("puts threads waiting on you in their own block, ahead of the rest", () => {
    const out = html(<ContactThreads threads={[t("1", "Older one", NOW - 40 * DAY), t("2", "Open question", NOW - 2 * DAY, true)]} waitingIds={new Set(["2"])} empty="none" />, "/");
    expect(out).toContain("Needs your reply");
    expect(out.indexOf("Open question")).toBeLessThan(out.indexOf("Older one"));
    expect(out).toContain("Ann");
    expect(out).toContain('aria-label="Unread"');
  });

  it("gives a waiting thread a Reply button, and every thread a menu of actions", () => {
    const out = html(<ContactThreads threads={[t("1", "Chat", NOW - DAY), t("2", "Open question", NOW - 2 * DAY)]} waitingIds={new Set(["2"])} empty="none" />, "/");
    expect(out.match(/>Reply</g)).toHaveLength(1);
    expect(out.match(/aria-label="More actions"/g)).toHaveLength(2);
  });

  it("has no waiting block when nothing waits", () => {
    const out = html(<ContactThreads threads={[t("1", "Just chat", NOW - DAY)]} waitingIds={new Set()} empty="none" />, "/");
    expect(out).not.toContain("Needs your reply");
    expect(out).toContain("Just chat");
  });

  it("shows only the words of a snippet that is raw markup", () => {
    const th = { ...t("1", "Markup", NOW - DAY), snippet: '<html dir="ltr"><head><meta charset="UTF-8"></head> Real words' };
    const out = html(<ContactThreads threads={[th]} waitingIds={new Set()} empty="none" />, "/");
    expect(out).toContain("Real words");
    expect(out).not.toContain("charset");
  });

  it("drops cut-off tags, links and the repeated subject from a preview", () => {
    expect(plain('Fraud Warning Notification <link rel="preconnect" href="https://u26', "Fraud Warning Notification")).toBe("");
    expect(plain("Hi &amp; welcome <style>a{color:red}</style> see https://x.co/a now", "Other")).toBe("Hi & welcome see now");
  });

  it("says so when there are no threads", () => {
    expect(html(<ContactThreads threads={[]} waitingIds={new Set()} empty="Nothing waiting." />, "/")).toContain("Nothing waiting.");
  });
});
