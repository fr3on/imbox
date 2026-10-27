import type { Counts } from "@shared/types";

/** What the Updates tab counts: unread newsletters and notices, and unread receipts. */
export const updatesNew = (c: Counts | undefined): number | undefined => (c ? c.feed_new + c.paper_trail_new : undefined);
