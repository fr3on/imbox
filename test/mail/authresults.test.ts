import { describe, expect, it } from "vitest";
import { parseAuthResults } from "../../src/api/authresults";

describe("parseAuthResults", () => {
  it("keeps the result of each method", () => {
    const h = "mx.google.com; dkim=pass header.i=@acme.example header.s=s1; spf=pass (google.com: domain of a@acme.example designates 1.2.3.4 as permitted sender) smtp.mailfrom=a@acme.example; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=acme.example";
    expect(parseAuthResults(h)).toBe("spf=pass dkim=pass dmarc=pass");
  });
  it("reads failures and takes the first mention of a method", () => {
    expect(parseAuthResults("mx.example.net; spf=softfail smtp.mailfrom=x@y.example; dkim=none; dmarc=fail header.from=y.example; dkim=pass")).toBe("spf=softfail dkim=none dmarc=fail");
  });
  it("is empty when there is nothing to read", () => {
    expect(parseAuthResults("")).toBe("");
    expect(parseAuthResults(undefined)).toBe("");
    expect(parseAuthResults("mx.example.net; arc=pass")).toBe("");
  });
});
