import { describe, expect, it } from "vitest";
import { buildStream, foldLabel, isAlert, labelOf } from "../../src/web/lib/updates";
import type { Message, ThreadSummary } from "../../src/shared/types";

// How the Updates list tells its rows apart: what each is called, and how a run of them is summed up.

type T = ThreadSummary & { latest_message: Message };
const thread = (o: { id?: string; bucket?: string; from?: string; name?: string; subject?: string; unsub?: string; body?: string; at?: number }): T =>
  ({
    id: o.id ?? "t",
    bucket: o.bucket ?? "feed",
    subject: o.subject ?? "Hello",
    last_message_at: o.at ?? 1_000_000,
    last_from: { email: o.from ?? "news@example.org", name: o.name ?? "News" },
    latest_message: { id: "m", list_unsubscribe: o.unsub ?? "", text_body: o.body ?? "", html_body: "" },
  }) as unknown as T;

describe("what a row is called", () => {
  it("calls a newsletter with a way to unsubscribe a Newsletter, in the header or in the footer text", () => {
    expect(labelOf(thread({ unsub: "<https://x.test/u>" }))).toBe("Newsletter");
    expect(labelOf(thread({ body: "Great week.\n\nUnsubscribe at any time." }))).toBe("Newsletter");
  });

  it("calls mail from an error tracker or monitor an Alert, even when it sits with the receipts", () => {
    expect(labelOf(thread({ bucket: "paper_trail", from: "alerts@md.getsentry.com", name: "Sentry", subject: "ORM-7P - OperationalError" }))).toBe("Alert");
    expect(isAlert(thread({ from: "noreply@pagerduty.com" }))).toBe(true);
  });

  it("calls an unsubscribable-less Updates mail worded like a failure an Alert, but not a receipt", () => {
    expect(labelOf(thread({ subject: "Your deployment failed" }))).toBe("Alert");
    expect(labelOf(thread({ bucket: "paper_trail", subject: "Your payment failed" }))).toBe("Receipt");
  });

  it("calls the rest of the Paper Trail a Receipt and other plain notices a Notice", () => {
    expect(labelOf(thread({ bucket: "paper_trail", from: "billing@acme.test", subject: "Invoice 42" }))).toBe("Receipt");
    expect(labelOf(thread({ subject: "Case 123 updated", from: "support@acme.test" }))).toBe("Notice");
  });
});

describe("summing up a run", () => {
  const sentry = (i: number) => thread({ id: `s${i}`, bucket: "paper_trail", from: "alerts@md.getsentry.com", name: "Sentry", subject: `ORM-${i}` });

  it("says alerts when they all are", () => {
    expect(foldLabel([sentry(1), sentry(2), sentry(3), sentry(4)])).toBe("4 alerts · Sentry");
  });

  it("says receipts for receipts and updates for a mix", () => {
    const r = (i: number) => thread({ id: `r${i}`, bucket: "paper_trail", from: `b${i}@acme.test`, name: `Shop ${i}`, subject: "Invoice" });
    expect(foldLabel([r(1), r(2), r(3), r(4)])).toBe("4 receipts · Shop 1, Shop 2, Shop 3, +1");
    expect(foldLabel([r(1), sentry(2)])).toBe("2 updates · Shop 1, Sentry");
  });

  it("folds a long run of alerts into one line", () => {
    const items = buildStream([sentry(1), sentry(2), sentry(3), sentry(4), sentry(5)], new Set(), 1_000_000);
    expect(items.map((i) => i.type)).toEqual(["day", "fold"]);
  });
});
