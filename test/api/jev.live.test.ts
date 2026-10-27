import { describe, expect, it } from "vitest";
import { testEnv } from "../api-harness";
import { jevPhishing, jevSamples, jevSuggestOne, jevThreadChecks } from "../../src/api/ai/jev";

// Talks to the real api.typesafe.ai, so it only runs when a key is in the environment:  JEV_TEST_KEY=... npx vitest run test/api/jev.live.test.ts
// Made-up mail only. It prints what Jev answers, so a person can judge it.
const KEY = process.env.JEV_TEST_KEY ?? "";
const env = testEnv as any;

describe.skipIf(!KEY)("Jev, live", () => {
  it("answers the sample examples", async () => {
    const samples = await jevSamples(env, KEY);
    console.log(samples.map((s) => `${s.label}: ${s.output} (${s.ms} ms, ${s.tokens} tokens)`).join("\n"));
    expect(samples[0].output).toMatch(/likely phishing/);
    expect(samples.every((s) => s.ms > 0 && s.tokens > 0)).toBe(true);
  });

  it("tells the password-expiry scam from ordinary mail", async () => {
    const facts = (o: Partial<Parameters<typeof jevPhishing>[2]>) => ({ fromName: "", fromEmail: "x@example.test", replyTo: "", subject: "", text: "", html: "", auth: "", toDomains: ["0x200.com"], ...o });
    const scam = await jevPhishing(env, KEY, facts({ fromName: "0x200.com", fromEmail: "dana@jonmarier.example", subject: "Password Expiry Notice for ahmed@0x200.com", text: "Dear ahmed, The password to your email ahmed@0x200.com is scheduled to expire in 4 days. To continue using this email and keep same password kindly use the keep same password button below. Please note that failure to update your password will lead to temporary blocking of your email account.", html: '<a href="https://keep-same-pass.example/x">Keep Same Password</a>', auth: "spf=fail dkim=none dmarc=fail" }));
    const lunch = await jevPhishing(env, KEY, facts({ fromName: "Daniel Okafor", fromEmail: "daniel@example.test", subject: "Lunch on Thursday?", text: "Hi, are you free Thursday around 12:30? There is a new place near the office I wanted to try. Daniel", auth: "spf=pass dkim=pass dmarc=pass" }));
    const receipt = await jevPhishing(env, KEY, facts({ fromName: "Hearth Coffee", fromEmail: "receipts@hearthcoffee.example", subject: "Your receipt from Hearth Coffee", text: "Thanks for your order. Total $7.40, paid with Visa ending 4242. Order #2291. View your receipt online.", html: '<a href="https://hearthcoffee.example/r/2291">View receipt</a>', auth: "spf=pass dkim=pass dmarc=pass" }));
    console.log(`scam ${scam.probability.toFixed(2)} (pressure ${scam.pressure.toFixed(2)}, ${scam.ms} ms) | lunch ${lunch.probability.toFixed(2)} (${lunch.ms} ms) | receipt ${receipt.probability.toFixed(2)} (${receipt.ms} ms)`);
    expect(scam.probability).toBeGreaterThan(0.6);
    expect(lunch.probability).toBeLessThan(0.3);
    expect(receipt.probability).toBeLessThan(0.3);
  });

  it("sorts new senders", async () => {
    const base = { name: "", subjects: [] as string[], snippet: "", unsubscribe: false, messages: 1, rule_guess: "imbox" as const };
    const cases: [string, Parameters<typeof jevSuggestOne>[2], string][] = [
      ["a weekly newsletter", { ...base, email: "hello@designnotes.example", name: "Design Notes Weekly", subjects: ["Issue 88: what makes a list feel calm"], snippet: "This week: three small changes. Unsubscribe below.", unsubscribe: true }, "feed"],
      ["a receipt", { ...base, email: "receipts@tallyhost.example", name: "Tallyhost", subjects: ["Invoice 2291 is ready"], snippet: "Your invoice for October is attached. Amount due $24.00." }, "paper_trail"],
      ["a person", { ...base, email: "hannah@example.test", name: "Hannah Cole", subjects: ["Introduction from Daniel"], snippet: "Hi, Daniel suggested I write to you about the meetup in November." }, "imbox"],
      ["spam", { ...base, email: "deals@cheap-pills-now.example", name: "Best Offers", subjects: ["You won!!! Claim now"], snippet: "Cheap pills, no prescription, limited time. Click here." }, "screened_out"],
    ];
    const lines: string[] = [];
    for (const [label, facts, want] of cases) {
      const { suggestion, result } = await jevSuggestOne(env, KEY, facts, []);
      lines.push(`${label}: ${suggestion.bucket} (${suggestion.confidence}, person ${suggestion.person}) in ${result.ms} ms`);
      expect(suggestion.bucket, label).toBe(want);
    }
    console.log(lines.join("\n"));
  });

  it("answers the quick checks, and tells the scam from an ordinary message", async () => {
    const facts = (o: Partial<Parameters<typeof jevPhishing>[2]>) => ({ fromName: "", fromEmail: "x@example.test", replyTo: "", subject: "", text: "", html: "", auth: "", toDomains: ["0x200.com"], ...o });
    const scam = await jevThreadChecks(env, KEY, facts({ fromName: "0x200.com", fromEmail: "dana@jonmarier.example", subject: "Password Expiry Notice for ahmed@0x200.com", text: "Dear ahmed, The password to your email ahmed@0x200.com is scheduled to expire in 4 days. To keep same password use the button below. Failure to update your password will lead to temporary blocking of your email account.", html: '<a href="https://keep-same-pass.example/x">Keep Same Password</a>', auth: "spf=fail dkim=none dmarc=fail" }));
    const lunch = await jevThreadChecks(env, KEY, facts({ fromName: "Daniel Okafor", fromEmail: "daniel@example.test", subject: "Lunch on Thursday?", text: "Hi, are you free Thursday around 12:30? There is a new place near the office I wanted to try. Let me know. Daniel", auth: "spf=pass dkim=pass dmarc=pass" }));
    const line = (r: Awaited<ReturnType<typeof jevThreadChecks>>) => r.checks.map((c) => `${c.label}: ${c.text} ${c.pct}%`).join(" | ") + ` (${r.ms} ms)`;
    console.log(`scam  -> ${line(scam)}\nlunch -> ${line(lunch)}`);
    expect(scam.checks.map((c) => c.id)).toEqual(["phishing", "pressure", "needs_reply", "has_deadline", "person", "place", "tone"]);
    expect(scam.checks.find((c) => c.id === "phishing")!.flag).toBe(true);
    expect(lunch.checks.find((c) => c.id === "phishing")!.flag).toBe(false);
    expect(lunch.checks.find((c) => c.id === "person")!.text).toBe("Yes");
    expect(lunch.checks.find((c) => c.id === "needs_reply")!.text).toBe("Yes");
  });
});
