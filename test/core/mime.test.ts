import { describe, expect, it } from "vitest";
import { buildRfc822, decodeRfc2047, parseAddressList, stripSubjectPrefixes } from "../../src/api/mime";

describe("addresses and subjects", () => {
  it("reads a list of addresses with names, quotes and commas", () => {
    expect(parseAddressList('"Chen, Maya" <maya@chen.test>, sam@example.org')).toEqual([
      { name: "Chen, Maya", email: "maya@chen.test" },
      { name: "", email: "sam@example.org" },
    ]);
  });
  it("decodes encoded words and strips reply prefixes", () => {
    expect(decodeRfc2047("=?UTF-8?B?w4lj?=")).toBe("Éc");
    expect(stripSubjectPrefixes("Re: Fwd: RE: Plan")).toBe("Plan");
  });
});

describe("a message we send", () => {
  const base = { from: { name: "Maya Chen", email: "maya@chen.test" }, to: [{ name: "Sam", email: "sam@example.org" }], subject: "Plan", html: "<p>Hello</p>", text: "Hello" };

  it("has the headers a mail server expects", () => {
    const raw = buildRfc822(base);
    expect(raw).toMatch(/^From: .*maya@chen\.test/m);
    expect(raw).toMatch(/^To: .*sam@example\.org/m);
    expect(raw).toMatch(/^Subject: Plan/m);
    expect(raw).toMatch(/^Message-ID: </m);
  });

  it("cannot be made to carry an extra header by a name or subject with a line break", () => {
    const raw = buildRfc822({ ...base, subject: "Plan\r\nBcc: attacker@evil.test", from: { name: "Maya\r\nBcc: x@evil.test", email: "maya@chen.test" } });
    const head = raw.split(/\r\n\r\n/)[0];
    expect(head).not.toMatch(/^Bcc:/im);
  });

  it("can leave Bcc out of the headers when the server sends it as an envelope recipient", () => {
    const params = { ...base, bcc: [{ name: "", email: "hidden@example.org" }] };
    expect(buildRfc822(params)).toContain("hidden@example.org");
    expect(buildRfc822(params, { includeBcc: false })).not.toContain("hidden@example.org");
  });
});
