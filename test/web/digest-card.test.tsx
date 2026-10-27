import { describe, expect, it } from "vitest";
import { html, NOW } from "./render";
import { DigestCard } from "@/components/DigestCard";
import type { DigestResponse } from "@/api";

// The Updates digest as it first paints, from the answer already in the cache: the themes with their sources, nothing at all when there is no AI or nothing to
// read, and the placeholder while the first one is being written. (Effects, and so the request for a fresh one, do not run here.)

const digest = (o: Partial<DigestResponse> = {}): DigestResponse => ({
  digest: {
    day: "2026-10-03",
    count: 4,
    covers: [],
    created_at: NOW,
    sections: [
      { theme: "Engineering", text: "Small teams are dropping weekly planning.", sources: [{ thread_id: "t1", from: "The Leverage", subject: "Why small teams ship faster" }, { thread_id: "t2", from: "Sam's Weekly", subject: "Ten links" }] },
      { theme: "Money", text: "Power BI renewed at $10.", sources: [{ thread_id: "t3", from: "Microsoft", subject: "Your invoice" }] },
    ],
  } as DigestResponse["digest"],
  count: 4,
  stale: false,
  ai_enabled: true,
  key: "4:abc",
  ...o,
});
const draw = (r: DigestResponse | undefined) => html(<DigestCard />, "/updates", (qc) => r && qc.setQueryData(["digest"], r));

describe("DigestCard", () => {
  it("shows each theme with its sentence and links the mails it came from", () => {
    const out = draw(digest());
    expect(out).toContain("Engineering.");
    expect(out).toContain("Small teams are dropping weekly planning.");
    expect(out).toContain('href="/t/t1"');
    expect(out).toContain("The Leverage");
    expect(out).toContain("Written from 4 mails");
  });

  it("shows nothing with no AI set up, or with nothing to read", () => {
    expect(draw(digest({ ai_enabled: false }))).toBe("");
    expect(draw(digest({ count: 0, digest: null }))).toBe("");
    expect(draw(undefined)).toBe("");
  });
});
