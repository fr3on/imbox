import { describe, expect, it } from "vitest";
import type { Workflow } from "@/api";
import { brief, iconFor } from "@/components/WorkflowsSection";

// What a tile on the Workflows page says: the rule in one line, and the icon of where it sends mail.

const wf = (over: Partial<Workflow>): Workflow => ({
  id: "w1", name: "W", enabled: true, trigger: "message_arrives", trigger_days: 3, match: "all", conditions: [], actions: [], account_ids: [], daily_limit: 200, last_run_at: null, runs_today: 0, runs_total: 0, recent: [], ...over,
});

describe("a workflow tile", () => {
  it("says a new one is not set up", () => {
    expect(brief(wf({}))).toBe("Not set up yet");
    expect(iconFor(wf({}))).toBe("workflows");
  });

  it("puts the rule in one line: the first condition, how many more, and what it does", () => {
    const w = wf({ conditions: [{ field: "from", op: "is", value: "amazon.com" }, { field: "subject", op: "contains", value: "bill" }], actions: [{ type: "label", id: "l1" }, { type: "move", tray: "paper_trail" }] });
    expect(brief(w)).toBe("sender is amazon.com +1 → label, Paper Trail");
  });

  it("says how long a thread waits for the no-reply kind", () => {
    expect(brief(wf({ trigger: "no_reply", trigger_days: 3, actions: [{ type: "reply_later" }] }))).toBe("No reply for 3 days → Reply Later");
    expect(brief(wf({ trigger: "no_reply", trigger_days: 1, actions: [{ type: "reply_later" }] }))).toBe("No reply for 1 day → Reply Later");
  });

  it("takes its icon from where it sends mail, else its first step", () => {
    expect(iconFor(wf({ actions: [{ type: "label", id: "l" }, { type: "move", tray: "paper_trail" }] }))).toBe("paper-trail");
    expect(iconFor(wf({ actions: [{ type: "move", tray: "feed" }] }))).toBe("feed");
    expect(iconFor(wf({ actions: [{ type: "snooze", hours: 24 }] }))).toBe("bubble-up");
    expect(iconFor(wf({ trigger: "no_reply", actions: [{ type: "reply_later" }] }))).toBe("reply-later");
  });
});
