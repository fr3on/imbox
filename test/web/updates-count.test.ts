import { describe, expect, it } from "vitest";
import type { Counts } from "@shared/types";
import { updatesNew } from "@/lib/updatesCount";

describe("updatesNew", () => {
  it("adds unread receipts to unread newsletters and notices", () => {
    expect(updatesNew({ feed_new: 17, paper_trail_new: 45 } as Counts)).toBe(62);
  });
  it("is nothing before the counts have loaded", () => {
    expect(updatesNew(undefined)).toBeUndefined();
  });
});
