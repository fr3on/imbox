import { describe, expect, it } from "vitest";
import type { Domain } from "@shared/types";
import { html, DOMAIN } from "./render";
import { ReceivingSteps, stepsFor } from "@/settings/domains/ReceivingSteps";

// The set-up steps for a domain that is not receiving yet: which step is next, what each one shows, and that they go away once mail arrives.

const pending = (over: Partial<Omit<Domain, "inbound">> & { inbound?: Partial<Domain["inbound"]> } = {}): Domain => ({
  ...DOMAIN,
  status: "pending",
  mailboxes: [],
  catch_all_account_id: null,
  ...over,
  inbound: { enabled: false, url: "https://mail.example.test/inbound/mail", last_received_at: null, ...over.inbound },
});
const render = (d: Domain) => html(<ReceivingSteps d={d} checking={false} onCheck={() => {}} onNewMailbox={() => {}} />);

describe("the receiving steps", () => {
  it("starts at the secret when the server has none", () => {
    const d = pending();
    expect(stepsFor(d).map((s) => s.done)).toEqual([false, false, false, false]);
    const out = render(d);
    expect(out).toContain("Not receiving yet");
    expect(out).toContain("Step 1 of 4: set the inbound secret.");
    expect(out).toContain("openssl rand -hex 32");
    expect(out).toContain("Next: MX records");
    expect(out).toContain("Check again");
  });

  it("moves on to the MX records once the secret is set", () => {
    const d = pending({ inbound: { enabled: true } });
    expect(stepsFor(d).map((s) => s.done)).toEqual([true, false, false, false]);
    const out = render(d);
    expect(out).toContain("Step 2 of 4: point the mx records.");
    expect(out).toContain("MX records tell the internet where to deliver mail");
    expect(out).not.toContain("openssl rand");
  });

  it("counts the MX records, forwarding and test message as done only once mail has arrived", () => {
    const d = pending({ inbound: { enabled: true, last_received_at: 1 } });
    expect(stepsFor(d).map((s) => s.key)).toEqual(["secret", "mx", "forward", "mailbox"]);
    expect(stepsFor(d).every((s) => s.done)).toBe(true);
  });

  it("is a single line once mail is arriving", () => {
    const out = render(DOMAIN);
    expect(out).toContain("Receiving mail. Last message");
    expect(out).not.toContain("Not receiving yet");
    expect(out).not.toContain("Check again");
  });
});
