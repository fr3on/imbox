import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AiUsageData } from "@shared/types";
import { html, NOW } from "./render";
import AiUsagePage from "@/pages/AiUsage";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const DAY = 86_400_000;
const feature = (feature: string, calls: number, tokens_in: number, tokens_out: number, failed = 0) => ({ feature, calls, tokens_in, tokens_out, failed, estimated: 0 });

const USAGE: AiUsageData = {
  overview: { configured: true, provider: "openai_compatible", preset: "custom", model: "google.gemma-4-31b" },
  days: 30,
  counting_since: NOW - 40 * DAY,
  totals: { calls: 1000, tokens_in: 600_000, tokens_out: 100_000, failed: 0, estimated_calls: 0, median_ms: 721 },
  series: [{ day: Math.floor(NOW / DAY) - 3, tokens: 400_000 }, { day: Math.floor(NOW / DAY), tokens: 300_000 }],
  by_feature: [feature("gist", 782, 300_000, 14_000), feature("jev_screener", 99, 120_000, 16_000, 2), feature("chat", 21, 100_000, 13_000), feature("brief", 34, 50_000, 2_000), feature("digest", 5, 20_000, 1_000)],
  skipped_runs: 7,
  activity: [
    { id: "c1", kind: "chat", title: "General Review Request", subtitle: "Assistant chat", status: "chat", time: NOW - 2 * DAY },
    { id: "a1", kind: "agent", title: "Re: Sign in broken", subtitle: "A draft was made", status: "replied", time: NOW - 7 * DAY, link: "/t/x" },
    { id: "l1", kind: "let_in", title: "Hannah Cole", subtitle: "Let in automatically", status: "let_in", time: NOW - 3 * DAY },
  ],
};
const seed = (u: AiUsageData) => (qc: import("@tanstack/react-query").QueryClient) => qc.setQueryData(["ai", "usage", 30], u);

describe("the AI usage page", () => {
  it("shows the top three features with their share, and a way to see them all", () => {
    const out = html(<AiUsagePage />, "/ai-usage", seed(USAGE));
    expect(out).toContain("Top features");
    expect(out).toContain("One-line summaries");
    expect(out).toContain("Screener suggestions (Jev)");
    expect(out).toContain("Assistant chat");
    expect(out).not.toContain("Daily brief");
    expect(out).toContain("Show all 5");
    // 314k of 700k tokens.
    expect(out).toContain("45%");
    expect(out).toContain("782 calls · 314k tokens");
    expect(out).toContain("2 failed");
  });

  it("puts the recent items in tabs with their counts, the first one that has anything open", () => {
    const out = html(<AiUsagePage />, "/ai-usage", seed(USAGE));
    expect(out).toContain("Conversations");
    expect(out).toContain("Agent runs");
    expect(out).toContain("Let in");
    // Agent runs count the mails agents skipped.
    expect(out).toMatch(/Agent runs\s*<span[^>]*>8</);
    expect(out).toContain("General Review Request");
    expect(out).not.toContain("Re: Sign in broken");
  });

  it("opens on agent runs when there are no conversations, and says when nothing has happened", () => {
    const agentsOnly = html(<AiUsagePage />, "/ai-usage", seed({ ...USAGE, activity: USAGE.activity.filter((a) => a.kind === "agent") }));
    expect(agentsOnly).toContain("Re: Sign in broken");
    expect(agentsOnly).toContain("7 mails skipped by agents");
    expect(agentsOnly).not.toContain("Let in</button>");
    const quiet = html(<AiUsagePage />, "/ai-usage", seed({ ...USAGE, activity: [], skipped_runs: 0 }));
    expect(quiet).toContain("Nothing yet.");
  });
});
