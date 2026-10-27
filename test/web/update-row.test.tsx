import { describe, expect, it } from "vitest";
import { html, NOW } from "./render";
import { UpdateRow } from "@/components/UpdateRow";
import type { FeedThread } from "@/api";

// One row of the Updates list as it first paints: the same shape for every kind, with its label, its summary line and where it goes.

const row = (o: Record<string, unknown> = {}) =>
  ({
    id: "t1", account_id: "a-gmail", bucket: "paper_trail", subject: "ORM-7P - OperationalError", snippet: "Statement timeout in production", seen: false, unread: true,
    last_message_at: NOW - 3_600_000, last_from: { email: "alerts@md.getsentry.com", name: "Sentry" }, files: [], gist: null,
    latest_message: { id: "m1", text_body: "A query was cancelled due to a statement timeout.", html_body: "", list_unsubscribe: "" }, ...o,
  }) as unknown as FeedThread;

describe("UpdateRow", () => {
  it("shows the title, who it is from, the line under it, the kind and the time, and links to the thread", () => {
    const out = html(<UpdateRow t={row()} to="/t/t1" onDone={() => {}} />);
    expect(out).toContain("ORM-7P - OperationalError");
    expect(out).toContain("Sentry");
    expect(out).toContain("A query was cancelled due to a statement timeout.");
    expect(out).toContain(">Alert<");
    expect(out).toContain('href="/t/t1"');
    expect(out).toContain('aria-label="New"');
  });

  it("uses the saved one-line summary when the list sent one, and drops the dot and the Done button once read", () => {
    const out = html(<UpdateRow t={row({ gist: "Five links on testing.", seen: true, unread: false, bucket: "feed", last_from: { email: "news@example.org", name: "Sam" }, latest_message: { id: "m", text_body: "Hi. Unsubscribe", html_body: "", list_unsubscribe: "" } })} onOpen={() => {}} onDone={() => {}} />);
    expect(out).toContain("Five links on testing.");
    expect(out).toContain(">Newsletter<");
    expect(out).not.toContain('aria-label="New"');
    expect(out).not.toContain("Done");
    expect(out).toContain("Read");
  });
});
