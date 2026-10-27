// What the Node host does to a request before the API sees it, and to a static file on the way out. Kept apart from run.mjs so it can be tested
// without starting a server.

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

/** An address as Node reports it, without the IPv4-in-IPv6 wrapper. */
const bare = (a) => String(a ?? "").replace(/^::ffff:/i, "");

/**
 * Who is really on the other end. The API counts failed logins per address, so this has to be the browser's address and nothing the browser
 * can choose. The proxy in front (Caddy, on this machine) says who it saw in X-Forwarded-For, and is believed only when the connection to us
 * is from this machine. Anyone else reaching the port directly is taken at the address the connection came from, whatever headers they send.
 * The nearest proxy appends, so the last entry is the one it vouches for.
 */
export function clientAddress(req) {
  const remote = bare(req.socket?.remoteAddress);
  if (!LOOPBACK.test(remote) && remote !== "") return remote;
  const chain = String(req.headers?.["x-forwarded-for"] ?? "")
    .split(",")
    .map((s) => bare(s.trim()))
    .filter(Boolean);
  return chain.length ? chain[chain.length - 1] : remote || "127.0.0.1";
}

/** Headers a client must not be able to set for the API: the ones it trusts to say who the caller is or where the call came in. */
export const STRIPPED_REQUEST_HEADERS = ["host", "connection", "content-length", "transfer-encoding", "cf-connecting-ip", "x-real-ip", "x-forwarded-for", "true-client-ip"];

/** The `_headers` file format: a path pattern on its own line, then indented `Name: value` lines. `*` matches anything, `:name` one path segment. */
export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      const pattern = raw.trim();
      const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z_]\w*/g, "[^/]+").replace(/\*/g, ".*") + "$");
      current = { re, headers: {} };
      rules.push(current);
      continue;
    }
    const i = raw.indexOf(":");
    if (current && i > 0) current.headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  return rules;
}

/** The headers every matching rule adds for this path, later rules over earlier ones. */
export function headersFor(rules, pathname) {
  const out = {};
  for (const r of rules) if (r.re.test(pathname)) Object.assign(out, r.headers);
  return out;
}
