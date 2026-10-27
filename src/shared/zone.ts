

export interface ParsedDnsRecord {
  id: string;
  type: string;
  name: string;
  /** The full name the record is published at, with relative names and "@" read against the domain. */
  fqdn: string;
  shortName: string;
  ttl?: string;
  priority?: number;
  value: string;
  purpose: string;
  isEssential: boolean;
}

export function parseZoneFile(text: string, domainName?: string): ParsedDnsRecord[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const records: string[] = [];
  let current = "";
  let inParen = false;

  for (const rawLine of lines) {
    let clean = "";
    let inQuotes = false;
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (ch === '"' && (i === 0 || rawLine[i - 1] !== "\\")) inQuotes = !inQuotes;
      if (ch === ";" && !inQuotes) break;
      clean += ch;
    }
    clean = clean.trim();
    if (!clean && !inParen) continue;

    if (inParen) {
      if (clean.includes(")")) {
        inParen = false;
        const [before] = clean.split(")");
        current += " " + before;
        if (current.trim()) records.push(current.trim());
        current = "";
      } else {
        current += " " + clean;
      }
    } else {
      if (clean.includes("(")) {
        inParen = true;
        const [before, after] = clean.split(/\(/, 2);
        current = before + " " + (after || "");
        if (current.includes(")")) {
          inParen = false;
          current = current.replace(/\)/g, "");
          records.push(current.trim());
          current = "";
        }
      } else {
        records.push(clean);
      }
    }
  }

  const KNOWN_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "TLSA", "SRV", "CAA", "NS", "PTR"]);
  const parsed: ParsedDnsRecord[] = [];
  const domClean = (domainName || "").toLowerCase().replace(/\.+$/, "");
  const origin = domClean || (records.find((r) => /^\$ORIGIN\s/i.test(r))?.split(/\s+/)[1] ?? "").toLowerCase().replace(/\.+$/, "");
  const qualify = (n: string) => (n === "@" ? origin : n.endsWith(".") || !origin ? n.replace(/\.$/, "") : `${n}.${origin}`).toLowerCase();

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    if (raw.startsWith("$") || raw.toUpperCase().includes(" SOA ")) continue;
    const parts = raw.split(/\s+/);
    if (parts.length < 3) continue;

    let idx = 0;
    const name = parts[idx++];
    let ttl = "";
    if (/^\d+[smhdw]?$/i.test(parts[idx])) {
      ttl = parts[idx++];
    }
    if (parts[idx] && parts[idx].toUpperCase() === "IN") {
      idx++;
    }
    const type = parts[idx++]?.toUpperCase();
    if (!type || !KNOWN_TYPES.has(type)) continue;

    const rdataRaw = parts.slice(idx).join(" ");
    let cleanValue = rdataRaw;
    let priority: number | undefined;

    if (type === "TXT") {
      const quoteMatches = [...rdataRaw.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
      if (quoteMatches.length > 0) {
        cleanValue = quoteMatches.map((m) => m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")).join("");
      } else {
        cleanValue = rdataRaw.replace(/^"|"$/g, "");
      }
    } else if (type === "MX") {
      const mxParts = rdataRaw.split(/\s+/);
      if (mxParts.length >= 2 && !isNaN(Number(mxParts[0]))) {
        priority = Number(mxParts[0]);
        cleanValue = `${priority} ${mxParts.slice(1).join(" ").replace(/\.$/, "")}`;
      }
    } else if (type === "CNAME" || type === "A" || type === "AAAA" || type === "NS") {
      cleanValue = rdataRaw.replace(/\.$/, "");
    }

    let shortName = name.replace(/\.$/, "");
    if (domClean) {
      if (shortName.toLowerCase() === domClean) {
        shortName = "@";
      } else if (shortName.toLowerCase().endsWith("." + domClean)) {
        shortName = shortName.slice(0, -(domClean.length + 1));
      }
    }

    let purpose = type;
    let isEssential = false;

    if (type === "MX") {
      purpose = "MX (Mail Exchange)";
      isEssential = true;
    } else if (type === "TXT") {
      if (cleanValue.startsWith("v=spf1")) {
        purpose = "SPF";
        isEssential = true;
      } else if (cleanValue.startsWith("v=DKIM1") || shortName.includes("_domainkey")) {
        purpose = "DKIM";
        isEssential = true;
      } else if (cleanValue.startsWith("v=DMARC1") || shortName.startsWith("_dmarc")) {
        purpose = "DMARC";
        isEssential = true;
      } else if (cleanValue.startsWith("v=STSv1") || shortName.includes("_mta-sts")) {
        purpose = "MTA-STS";
      } else if (shortName.includes("_tls")) {
        purpose = "TLS-RPT";
      }
    } else if (type === "TLSA") {
      const portMatch = shortName.match(/_(\d+)\._/);
      purpose = portMatch ? `TLSA (${portMatch[1]})` : "TLSA";
    } else if (type === "CNAME" || type === "A" || type === "AAAA") {
      if (shortName.toLowerCase() === "mail") {
        purpose = "Mail Server";
        isEssential = true;
      } else if (shortName.includes("autodiscover") || shortName.includes("autoconfig")) {
        purpose = "Auto-Discovery";
      }
    }

    parsed.push({
      id: `${type}-${shortName}-${i}`,
      type,
      name: name.replace(/\.$/, ""),
      fqdn: qualify(name),
      shortName,
      ttl,
      priority,
      value: cleanValue,
      purpose,
      isEssential,
    });
  }

  return parsed;
}
