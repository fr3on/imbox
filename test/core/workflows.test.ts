import { describe, expect, it } from "vitest";
import { normalizeWorkflow, passes, conditionHolds, type Facts } from "../../src/shared/workflows";

const facts = (o: Partial<Facts> = {}): Facts => ({
  from_email: "news@shop.example.com",
  from_name: "The Shop",
  recipients: ["me@mine.test", "team@mine.test"],
  subject: "Your weekly offers",
  body: "Click to unsubscribe from this list",
  has_attachment: false,
  has_unsubscribe: true,
  tray: "feed",
  ...o,
});

describe("workflow conditions", () => {
  it("matches text without caring about case", () => {
    expect(conditionHolds({ field: "subject", op: "contains", value: "WEEKLY" }, facts())).toBe(true);
    expect(conditionHolds({ field: "subject", op: "not_contains", value: "weekly" }, facts())).toBe(false);
    expect(conditionHolds({ field: "body", op: "contains", value: "invoice" }, facts())).toBe(false);
  });

  it("treats a sender 'is' as the address, or the whole domain when no @ is given", () => {
    expect(conditionHolds({ field: "from", op: "is", value: "news@shop.example.com" }, facts())).toBe(true);
    expect(conditionHolds({ field: "from", op: "is", value: "shop.example.com" }, facts())).toBe(true);
    expect(conditionHolds({ field: "from", op: "is", value: "example.com" }, facts())).toBe(false);
    expect(conditionHolds({ field: "from", op: "is", value: "evil@shop.example.com" }, facts())).toBe(false);
  });

  it("lets 'contains' on a sender look at the name too", () => {
    expect(conditionHolds({ field: "from", op: "contains", value: "the shop" }, facts())).toBe(true);
    expect(conditionHolds({ field: "from", op: "not_contains", value: "shop" }, facts())).toBe(false);
  });

  it("looks at every recipient on To and Cc", () => {
    expect(conditionHolds({ field: "to", op: "contains", value: "team@" }, facts())).toBe(true);
    expect(conditionHolds({ field: "to", op: "is", value: "mine.test" }, facts())).toBe(true);
  });

  it("handles yes/no fields and trays", () => {
    expect(conditionHolds({ field: "has_attachment", op: "is", value: "true" }, facts())).toBe(false);
    expect(conditionHolds({ field: "has_unsubscribe", op: "is", value: "true" }, facts())).toBe(true);
    expect(conditionHolds({ field: "tray", op: "is", value: "feed" }, facts())).toBe(true);
    expect(conditionHolds({ field: "tray", op: "not_contains", value: "feed" }, facts())).toBe(false);
  });

  it("combines with all or any", () => {
    const cs = [
      { field: "subject", op: "contains", value: "offers" },
      { field: "has_attachment", op: "is", value: "true" },
    ] as const;
    expect(passes([...cs], "all", facts())).toBe(false);
    expect(passes([...cs], "any", facts())).toBe(true);
    expect(passes([], "all", facts())).toBe(true);
  });
});

describe("normalizeWorkflow", () => {
  const good = {
    name: "  Newsletters ",
    conditions: [{ field: "has_unsubscribe", value: "true" }],
    actions: [{ type: "move", tray: "feed" }, { type: "mark_read" }],
  };

  it("returns a clean workflow with defaults", () => {
    const r = normalizeWorkflow(good);
    expect("ok" in r && r.ok).toMatchObject({ name: "Newsletters", trigger: "message_arrives", match: "all", daily_limit: 200, account_ids: [] });
  });

  it("refuses one with nothing to match, because it would touch every email", () => {
    const r = normalizeWorkflow({ ...good, conditions: [] });
    expect("error" in r && r.error).toMatch(/at least one condition/);
  });

  it("allows no conditions for the no-reply trigger", () => {
    expect("ok" in normalizeWorkflow({ ...good, trigger: "no_reply", conditions: [] })).toBe(true);
  });

  it("refuses actions it does not know, such as delete, and trays it may not move to", () => {
    expect("error" in normalizeWorkflow({ ...good, actions: [{ type: "delete" }] })).toBe(true);
    expect("error" in normalizeWorkflow({ ...good, actions: [{ type: "move", tray: "trash" }] })).toBe(true);
  });

  it("limits how many conditions and actions there are", () => {
    const many = Array.from({ length: 11 }, () => ({ field: "subject", value: "x" }));
    expect("error" in normalizeWorkflow({ ...good, conditions: many })).toBe(true);
    expect("error" in normalizeWorkflow({ ...good, actions: Array.from({ length: 6 }, () => ({ type: "mark_read" })) })).toBe(true);
  });

  it("needs a name, a target for labels, and clamps snooze time and limits", () => {
    expect("error" in normalizeWorkflow({ ...good, name: " " })).toBe(true);
    expect("error" in normalizeWorkflow({ ...good, actions: [{ type: "label" }] })).toBe(true);
    const r = normalizeWorkflow({ ...good, actions: [{ type: "snooze", hours: 99999 }], daily_limit: 99999 });
    expect("ok" in r && r.ok.actions[0].hours).toBe(24 * 90);
    expect("ok" in r && r.ok.daily_limit).toBe(1000);
  });
});
