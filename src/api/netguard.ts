// One answer to "may the server connect to this host name?" for every place it fetches an address somebody else supplied: sender picture
// lookups, calendar feeds, webhooks, a Stalwart server, a push endpoint. A host that names this machine or a private network is refused.
//
// This only sees the name. A public name can still resolve to a private address, so the server also checks the address at connect time
// (server/egress.mjs); a firewall rule is a second layer.

/** Names that point at whatever address is written in them, which makes them a way round a check on the name. */
const WILDCARD_DNS = /(^|\.)(nip\.io|sslip\.io|xip\.io|traefik\.me|localtest\.me|lvh\.me|vcap\.me|lacolhost\.com)$/;

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function privateV4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // protocol assignments and documentation
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** True for a host name that is, or points at, this machine or a private network. Takes a URL hostname (IPv6 may be in brackets). */
export function isPrivateHost(input: string): boolean {
  const host = input.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(":") && !host.includes(".")) return true; // a bare name resolves on the local network
  if (WILDCARD_DNS.test(host)) return true;
  const v4 = ipv4(host);
  if (v4) return privateV4(v4);
  if (host.includes(":")) return true; // every IPv6 literal: loopback, mapped IPv4, unique-local and link-local all hide in here, and no mail server needs one
  if (/^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return true; // a number or a shortened dotted form; the URL parser normally rewrites these first
  return false;
}
