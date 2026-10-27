import { describe, expect, it } from "vitest";
import { phishingSignal } from "../../src/shared/phishing";

const netflix = {
  from: { email: "support@nexcess.net", name: "SUPPORT" },
  subject: "Account Restricted: Immediate action needed",
  text_body: "Hi, This is your last opportunity to renew your Netflix Premium membership at $2.99/month. NETFLIX Don't lose access to your watchlist.",
};

describe("phishingSignal", () => {
  it("flags mail that puts on a known name and rushes you, sent from somewhere else", () => {
    expect(phishingSignal(netflix)).toEqual({ brand: "Netflix", domain: "nexcess.net", reason: "It says Netflix, but it was sent from nexcess.net." });
  });

  it("reads the brand out of an HTML-only message", () => {
    const html = { ...netflix, text_body: "", html_body: "<style>.a{}</style><h1>NETFLIX</h1><p>Your account has been suspended. Verify your account with Netflix.</p>" };
    expect(phishingSignal(html)?.brand).toBe("Netflix");
  });

  it("leaves the company's own mail, and its subdomains, alone", () => {
    expect(phishingSignal({ ...netflix, from: { email: "info@mailer.netflix.com", name: "Netflix" } })).toBeNull();
  });

  it("needs the rushing, so a mention is not enough", () => {
    expect(phishingSignal({ from: { email: "friend@example.org", name: "Sam" }, subject: "Movie night", text_body: "Want to watch something on Netflix? Netflix has the new one." })).toBeNull();
  });

  it("needs the name, so urgent mail from anyone is not flagged", () => {
    expect(phishingSignal({ from: { email: "billing@acme.test", name: "Acme" }, subject: "Final notice", text_body: "Your invoice is overdue. Pay within 3 days." })).toBeNull();
  });

  it("never flags your own mail", () => {
    expect(phishingSignal({ ...netflix, is_from_me: true })).toBeNull();
  });

  const expiry = {
    from: { email: "dana@jonmarier.example", name: "0x200.com" },
    to: [{ email: "ahmed@0x200.com" }],
    subject: "Password Expiry Notice for ahmed@0x200.com",
    text_body: "Dear ahmed, The password to your email ahmed@0x200.com is scheduled to expire in 4 days. To continue using this email use the button below. Please note that failure to update your password will lead to temporary blocking of your email account.",
  };

  it("flags a sender name that is a web address other than the one it was sent from", () => {
    expect(phishingSignal(expiry)).toEqual({ brand: "0x200.com", domain: "jonmarier.example", reason: "The name says 0x200.com, but it was sent from jonmarier.example." });
  });

  it("flags mail about your own domain's password from someone else, even with an ordinary name", () => {
    const sig = phishingSignal({ ...expiry, from: { email: "it-desk@jonmarier.example", name: "IT Desk" } });
    expect(sig?.reason).toBe("It talks about your 0x200.com account, but it was sent from jonmarier.example.");
  });

  it("leaves your own domain's real notices alone", () => {
    expect(phishingSignal({ ...expiry, from: { email: "admin@0x200.com", name: "0x200.com" } })).toBeNull();
    expect(phishingSignal({ ...expiry, from: { email: "noreply@mail.0x200.com", name: "IT Desk" } })).toBeNull();
  });

  it("does not take a shared mail provider for your own domain", () => {
    const gmailUser = { ...expiry, from: { email: "x@elsewhere.example", name: "Help" }, to: [{ email: "me@gmail.com" }], text_body: "Your gmail.com password will expire in 2 days. Update your password." };
    expect(phishingSignal(gmailUser)).toBeNull();
  });

  it("needs the pressure, so a name that is an address is not enough", () => {
    expect(phishingSignal({ from: { email: "news@substack.example", name: "Acme.com" }, subject: "Weekly notes", text_body: "Here is what we read this week." })).toBeNull();
  });

  it("reads a password that is about to lapse, however the sentence goes", () => {
    const quiet = { from: { email: "it@elsewhere.example", name: "IT Desk" }, to: [{ email: "me@0x200.com" }], subject: "Notice", text_body: "The password for me@0x200.com will expire tomorrow." };
    expect(phishingSignal(quiet)?.brand).toBe("0x200.com");
  });

  const urgent = { from: { email: "alerts@secure-notify.example", name: "Account team" }, subject: "Action needed", text_body: "Your account will be closed within 2 days. Click below to keep it." };
  const withLink = (href: string, text: string) => ({ ...urgent, html_body: `<p>Your account will be closed within 2 days.</p><a href="${href}">${text}</a>` });

  it("flags a link whose text says one address and goes to another", () => {
    expect(phishingSignal(withLink("https://evil.example/login", "https://www.bank-secure.example/login"))?.reason).toBe("A link says www.bank-secure.example, but goes to evil.example.");
  });

  it("flags a link that goes to a number, hides its address, is shortened or uses look-alike letters", () => {
    expect(phishingSignal(withLink("http://203.0.113.9/login", "Keep my account"))?.reason).toContain("goes straight to a number");
    expect(phishingSignal(withLink("https://paypal.com@evil.example/x", "Keep my account"))?.reason).toContain("hides its real address");
    expect(phishingSignal(withLink("https://bit.ly/3abc", "Keep my account"))?.reason).toContain("is shortened");
    expect(phishingSignal(withLink("https://xn--pypal-4ve.example/x", "Keep my account"))?.reason).toContain("look-alike characters");
  });

  it("leaves a link through a sending service, and a link to the sender's own site, alone", () => {
    expect(phishingSignal(withLink("https://u123.ct.sendgrid.net/ls/click?upn=abc", "https://www.secure-notify.example/account"))).toBeNull();
    expect(phishingSignal(withLink("https://www.secure-notify.example/account", "Keep my account"))).toBeNull();
  });

  it("flags urgent login mail whose link goes somewhere other than the sender, but not other urgent mail", () => {
    const login = { from: { email: "support@acme.example", name: "Acme" }, subject: "Your password expires", text_body: "Your password will expire in 2 days.", html_body: '<p>Your password will expire in 2 days.</p><a href="https://acme-login.example/reset">Keep my password</a>' };
    expect(phishingSignal(login)?.reason).toBe("The link goes to acme-login.example, not acme.example.");
    expect(phishingSignal({ ...login, html_body: '<a href="https://www.acme.example/reset">Keep my password</a>' })).toBeNull();
  });

  it("flags replies that go to another domain, while the mail presses you", () => {
    expect(phishingSignal({ ...urgent, reply_to: "help@somewhere-else.example" })?.reason).toBe("Replies go to somewhere-else.example, not secure-notify.example.");
    expect(phishingSignal({ ...urgent, subject: "Hello", text_body: "See you soon.", reply_to: "help@somewhere-else.example" })).toBeNull();
  });

  it("is stronger when the server could not verify the sender, and flags pressing mail it could not verify at all", () => {
    expect(phishingSignal({ ...expiry, auth: "spf=fail dkim=none dmarc=fail" })?.reason).toBe("The name says 0x200.com, but it was sent from jonmarier.example. The server that received it could not verify the sender.");
    expect(phishingSignal({ ...urgent, auth: "spf=softfail dkim=none dmarc=fail" })?.reason).toBe("It presses you to act, and the server that received it could not verify it came from secure-notify.example.");
    expect(phishingSignal({ ...urgent, auth: "spf=pass dkim=pass dmarc=pass" })).toBeNull();
    expect(phishingSignal({ ...urgent, subject: "Hello", text_body: "See you soon.", auth: "spf=fail dkim=none dmarc=fail" })).toBeNull();
  });

  it("goes by what the owner decided before", () => {
    expect(phishingSignal({ ...expiry, verdict: "ok" })).toBeNull();
    expect(phishingSignal({ from: { email: "x@jonmarier.example", name: "Hi" }, subject: "Hi", text_body: "Hello.", verdict: "bad" })?.reason).toBe("You reported mail from jonmarier.example before.");
  });
});
