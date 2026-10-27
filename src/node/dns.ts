// DNS questions for the records check: Node's resolver behind a small interface, so the check can be tested with canned answers.
import { Resolver } from "node:dns/promises";

export type RecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT";

/** What a name holds for a type, one line per record (MX as "10 host", TXT joined into one string). Empty when the name has none. */
export type Lookup = (name: string, type: RecordType) => Promise<string[]>;

const EMPTY = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN", "NODATA"]);

export function systemLookup(): Lookup {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  return async (name, type) => {
    try {
      switch (type) {
        case "A": return await r.resolve4(name);
        case "AAAA": return await r.resolve6(name);
        case "CNAME": return await r.resolveCname(name);
        case "MX": return (await r.resolveMx(name)).map((m) => `${m.priority} ${m.exchange}`);
        case "TXT": return (await r.resolveTxt(name)).map((parts) => parts.join(""));
      }
    } catch (e) {
      if (EMPTY.has((e as { code?: string }).code ?? "")) return [];
      throw e;
    }
  };
}
