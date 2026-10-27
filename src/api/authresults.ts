// What the mail server that received a message said about who sent it, from its Authentication-Results header: did the sending server pass SPF,
// is the message signed (DKIM), and does the From domain agree with both (DMARC). Kept short, as "spf=pass dkim=pass dmarc=fail".

const METHODS = ["spf", "dkim", "dmarc"] as const;

/** The result for each method in an Authentication-Results header value, first mention of each. Empty when the header says nothing we use. */
export function parseAuthResults(header: string | undefined | null): string {
  if (!header) return "";
  const out: string[] = [];
  for (const m of METHODS) {
    const hit = new RegExp(`(?:^|[;\\s])${m}\\s*=\\s*([a-z]+)`, "i").exec(header);
    if (hit) out.push(`${m}=${hit[1].toLowerCase()}`);
  }
  return out.join(" ");
}
