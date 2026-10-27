import type { Address } from "@shared/types";

/** A list of addresses as typed or pasted: "Name <a@b.com>", or bare addresses, split by commas, semicolons or lines. Anything that is not an address is dropped. */
export function parseAddresses(s: string): Address[] {
  const out: Address[] = [];
  for (const part of s.split(/[,;\n]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
    if (m) out.push({ name: m[1].trim(), email: m[2].trim().toLowerCase() });
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) out.push({ name: "", email: p.toLowerCase() });
  }
  return out;
}
