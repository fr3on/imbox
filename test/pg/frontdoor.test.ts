import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import { clientAddress, headersFor, parseHeadersFile, STRIPPED_REQUEST_HEADERS } from "../../server/frontdoor.mjs";

const req = (remoteAddress: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress }, headers });

describe("clientAddress: the address failed logins are counted against", () => {
  it("is the address Caddy reports, when Caddy (on this machine) is the one connecting", () => {
    expect(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientAddress(req("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientAddress(req("::1", { "x-forwarded-for": "2001:db8::5" }))).toBe("2001:db8::5");
  });

  it("is the last entry of a chain, which is the one the nearest proxy added, not one the caller made up", () => {
    expect(clientAddress(req("127.0.0.1", { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("is the connection's own address when somebody reaches the port directly, whatever they claim", () => {
    expect(clientAddress(req("198.51.100.9", { "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" }))).toBe("198.51.100.9");
    expect(clientAddress(req("::ffff:198.51.100.9", { "x-forwarded-for": "1.2.3.4" }))).toBe("198.51.100.9");
  });

  it("falls back to the loopback address when a local caller says nothing", () => {
    expect(clientAddress(req("127.0.0.1"))).toBe("127.0.0.1");
  });

  it("two different visitors behind the proxy are two different addresses (they used to share one rate-limit bucket)", () => {
    expect(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.1" }))).not.toBe(clientAddress(req("127.0.0.1", { "x-forwarded-for": "203.0.113.2" })));
  });

  it("strips every header the Worker would believe about the caller's address", () => {
    for (const h of ["cf-connecting-ip", "x-real-ip", "x-forwarded-for", "true-client-ip"]) expect(STRIPPED_REQUEST_HEADERS).toContain(h);
  });
});

describe("_headers", () => {
  const rules = parseHeadersFile("# comment\n/*\n  X-A: 1\n  Content-Security-Policy: default-src 'self'; img-src https:\n\n/assets/*\n  Cache-Control: immutable\n/exact.js\n  X-B: 2\n");

  it("parses patterns and values (a value may hold colons and semicolons)", () => {
    expect(headersFor(rules, "/anything")).toEqual({ "x-a": "1", "content-security-policy": "default-src 'self'; img-src https:" });
    expect(headersFor(rules, "/assets/app.js")).toMatchObject({ "x-a": "1", "cache-control": "immutable" });
    expect(headersFor(rules, "/exact.js")).toMatchObject({ "x-a": "1", "x-b": "2" });
    expect(headersFor(rules, "/exact.json")).not.toHaveProperty("x-b");
  });

  it("the shipped file puts a policy on every page and a long cache only on hashed assets", () => {
    const shipped = parseHeadersFile(fs.readFileSync(path.resolve(__dirname, "../../public/_headers"), "utf8"));
    const page = headersFor(shipped, "/some/spa/route");
    expect(page["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(page["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(page["content-security-policy"]).toMatch(/object-src 'none'/);
    expect(page["content-security-policy"]).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(page["content-security-policy"]).not.toMatch(/'unsafe-eval'/);
    expect(page["x-content-type-options"]).toBe("nosniff");
    expect(page["x-frame-options"]).toBe("DENY");
    expect(page["cache-control"]).toBeUndefined();
    expect(headersFor(shipped, "/assets/index-abc.js")["cache-control"]).toMatch(/immutable/);
    expect(headersFor(shipped, "/sw.js")["cache-control"]).toBe("no-cache");
  });
});
