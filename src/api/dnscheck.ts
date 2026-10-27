// Checks the DNS records a domain should have against what the internet answers. Only reads public DNS for names under the domain.
import { parseZoneFile, type ParsedDnsRecord } from "../shared/zone";
import type { DnsCheckResult } from "../shared/types";
import type { Lookup, RecordType } from "../node/dns";

const CHECKED = new Set(["A", "AAAA", "CNAME", "MX", "TXT"]);
/** A zone file for one domain has a few dozen records; this keeps a strange one from becoming a flood of lookups. */
const MAX_RECORDS = 60;

const clean = (s: string) => s.trim().replace(/\.$/, "").toLowerCase();
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Compares one record with what the name holds. Checks like-for-like: SPF with SPF, DKIM with the same selector. */
function judge(r: ParsedDnsRecord, found: string[]): Pick<DnsCheckResult, "status" | "found"> {
  if (!found.length) return { status: "missing", found: [] };
  let match: boolean;
  if (r.type === "MX") match = found.some((f) => clean(f.replace(/^(\d+)\s+/, "$1 ")) === clean(r.value.replace(/\s+/g, " ")));
  else if (r.type === "TXT") {
    const want = squash(r.value).toLowerCase();
    const kind = want.startsWith("v=") ? want.split(/[\s;]/)[0] : "";
    // A name can hold other TXT records (a verification code); only the ones of the same kind say anything about this one.
    const same = found.map((f) => squash(f).toLowerCase()).filter((f) => !kind || f.startsWith(kind));
    if (!same.length) return { status: "missing", found };
    match = same.includes(want);
  } else match = found.some((f) => clean(f) === clean(r.value));
  return { status: match ? "ok" : "mismatch", found };
}

export async function checkDomainDns(zone: string, domain: string, lookup: Lookup): Promise<DnsCheckResult[]> {
  const dom = clean(domain);
  const records = parseZoneFile(zone, dom).filter((r) => {
    return r.fqdn === dom || r.fqdn.endsWith(`.${dom}`);
  });
  const out: DnsCheckResult[] = [];
  const todo = records.slice(0, MAX_RECORDS);
  // A few at a time: enough to be quick, few enough to be polite to the resolver.
  for (let i = 0; i < todo.length; i += 8) {
    out.push(
      ...(await Promise.all(
        todo.slice(i, i + 8).map(async (r): Promise<DnsCheckResult> => {
          const base = { id: r.id, type: r.type, name: r.fqdn, value: r.value, purpose: r.purpose, essential: r.isEssential };
          if (!CHECKED.has(r.type)) return { ...base, status: "unchecked", found: [] };
          try {
            return { ...base, ...judge(r, await lookup(r.fqdn, r.type as RecordType)) };
          } catch {
            return { ...base, status: "unknown", found: [] };
          }
        }),
      )),
    );
  }
  return out;
}
