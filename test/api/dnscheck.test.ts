import { describe, expect, it } from "vitest";
import { checkDomainDns } from "../../src/api/dnscheck";
import type { Lookup } from "../../src/node/dns";

const ZONE = `$ORIGIN chen.studio.
@ 3600 IN MX 10 mail.chen.studio.
@ IN TXT "v=spf1 mx -all"
mail IN A 203.0.113.7
default._domainkey IN TXT ( "v=DKIM1; k=rsa; " "p=MIIBIjANBgkqh" )
_dmarc IN TXT "v=DMARC1; p=quarantine"
_25._tcp.mail IN TLSA 3 1 1 abcdef
elsewhere.example.org. IN A 203.0.113.9`;

const answers = (table: Record<string, string[]>, fail: string[] = []): Lookup => async (name, type) => {
  if (fail.includes(`${type} ${name}`)) throw new Error("timeout");
  return table[`${type} ${name}`] ?? [];
};
const byId = (r: Awaited<ReturnType<typeof checkDomainDns>>) => Object.fromEntries(r.map((x) => [x.purpose + " " + x.type, x.status]));

describe("checking a domain's DNS records", () => {
  it("says which records are live, missing or different", async () => {
    const out = await checkDomainDns(
      ZONE,
      "chen.studio",
      answers({
        "MX chen.studio": ["10 mail.chen.studio"],
        // Another TXT on the same name does not hide the SPF record, and a different SPF is a different record.
        "TXT chen.studio": ["google-site-verification=abc", "v=spf1 include:other.example -all"],
        "A mail.chen.studio": ["203.0.113.7"],
        "TXT _dmarc.chen.studio": ["v=DMARC1; p=quarantine"],
      }),
    );
    const s = byId(out);
    expect(s["MX (Mail Exchange) MX"]).toBe("ok");
    expect(s["SPF TXT"]).toBe("mismatch");
    expect(s["Mail Server A"]).toBe("ok");
    expect(s["DMARC TXT"]).toBe("ok");
    expect(s["DKIM TXT"]).toBe("missing");
    expect(out.find((r) => r.purpose === "SPF")?.found).toContain("v=spf1 include:other.example -all");
  });

  it("matches a TXT record split into strings, ignoring spacing and case", async () => {
    const out = await checkDomainDns(ZONE, "chen.studio", answers({ "TXT default._domainkey.chen.studio": ["V=DKIM1;  k=rsa; p=MIIBIjANBgkqh"] }));
    expect(byId(out)["DKIM TXT"]).toBe("ok");
  });

  it("treats a name with only an unrelated TXT record as missing", async () => {
    const out = await checkDomainDns(ZONE, "chen.studio", answers({ "TXT chen.studio": ["google-site-verification=abc"] }));
    expect(byId(out)["SPF TXT"]).toBe("missing");
  });

  it("reports a failed lookup as unknown and a type it does not look up as unchecked", async () => {
    const out = await checkDomainDns(ZONE, "chen.studio", answers({}, ["A mail.chen.studio"]));
    const s = byId(out);
    expect(s["Mail Server A"]).toBe("unknown");
    expect(s["TLSA (25) TLSA"]).toBe("unchecked");
  });

  it("only looks up names under the domain", async () => {
    const asked: string[] = [];
    await checkDomainDns(ZONE, "chen.studio", async (name) => {
      asked.push(name);
      return [];
    });
    expect(asked).not.toContain("elsewhere.example.org");
    expect(asked).toContain("mail.chen.studio");
  });
});
