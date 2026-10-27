import { describe, expect, it } from "vitest";
import type { Draft } from "@shared/types";
import { html, NOW } from "./render";
import { DraftsChip } from "@/components/DraftsChip";
import { draftPreview } from "@/lib/draftPeople";

// The chip beside Write: it shows how many drafts are waiting, and nothing at all when there are none (a scheduled or failed message is not a draft).

const draft = (id: string, o: Partial<Draft> = {}): Draft => ({
  account_id: "a-gmail",
  id,
  thread_id: null,
  reply_to_message_id: null,
  to: [{ email: "sara@example.org", name: "Sara" }],
  cc: [],
  bcc: [],
  subject: "Quarterly numbers",
  body_html: "<p>Looks right to me.</p>",
  send_at: null,
  status: "draft",
  error: null,
  created_at: NOW - 7_200_000,
  updated_at: NOW - 3_600_000,
  ...o,
});
const chip = (drafts: Draft[]) => html(<DraftsChip />, "/", (qc) => qc.setQueryData(["drafts"], drafts));

describe("DraftsChip", () => {
  it("says how many drafts are waiting", () => {
    const out = chip([draft("d1"), draft("d2", { subject: "Lunch Thursday?" })]);
    expect(out).toContain("Drafts");
    expect(out).toContain('aria-label="2 drafts waiting"');
  });

  it("says one draft in the singular", () => {
    expect(chip([draft("d1")])).toContain('aria-label="1 draft waiting"');
  });

  it("shows nothing without drafts, and does not count scheduled, failed or sending mail", () => {
    expect(chip([])).toBe("");
    expect(chip([draft("s", { status: "scheduled", send_at: NOW + 3_600_000 }), draft("f", { status: "failed" }), draft("x", { status: "sending" })])).toBe("");
  });
});

describe("draftPreview", () => {
  it("leaves out the signature and the quoted message", () => {
    expect(draftPreview('<p>Thanks, see you Thursday.</p><div class="hey-signature">Maya</div>')).toBe("Thanks, see you Thursday.");
    expect(draftPreview('<p>Yes.</p><div class="imbox-quote">On Monday Sam wrote</div>')).toBe("Yes.");
    expect(draftPreview('<p>Thanks.</p><div class="imbox-signature">Maya</div>')).toBe("Thanks.");
    // Drafts saved before the rename.
    expect(draftPreview('<p>Yes.</p><div class="hey-quote">On Monday Sam wrote</div>')).toBe("Yes.");
  });
});
