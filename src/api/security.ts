import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

/**
 * Cross-site request forgery. The session cookie is SameSite=Lax, which stops a page on another *site* from riding it, but a page on a
 * sibling subdomain of the same registrable domain is the same site, and Lax says nothing about it. So a request that changes something
 * must also come from this app's own origin.
 *
 * A browser says where a request came from in `Sec-Fetch-Site` and `Origin`; either one naming another origin refuses the request. A
 * request with neither (a script, curl, the native apps) cannot be a browser acting on a cookie it was tricked into using, and one that
 * sends its own `Authorization` header is not using the cookie at all.
 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (c.req.header("authorization")) return next();

  const site = c.req.header("sec-fetch-site");
  const origin = c.req.header("origin");
  if (site && site !== "same-origin" && site !== "none") return refuse(c.req.url, site);
  if (origin !== undefined) {
    const own = new Set<string>([new URL(c.req.url).host]);
    try {
      if (c.env.APP_URL) own.add(new URL(c.env.APP_URL).host);
    } catch {
      // an APP_URL that is not a URL names nothing
    }
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      // "null" and anything else that is not an origin
    }
    if (!host || !own.has(host)) return refuse(c.req.url, origin);
  }
  return next();
};

function refuse(_url: string, _from: string): Response {
  return Response.json({ error: "cross_site_request", message: "This request did not come from the app." }, { status: 403 });
}

/** What every answer from the API carries. Anything a route already set (an attachment's own policy, say) is left as it was. */
const BASE: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  // The API's own answers are JSON, or a small page with its style inline: nothing to run, load, frame or submit.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  let changed = false;
  // A PDF is the one answer that must stay open to the browser's own viewer, which does not run under a CSP or inside a frame check.
  const pdf = /^application\/pdf/i.test(headers.get("content-type") ?? "");
  for (const [k, v] of Object.entries(BASE)) {
    if (pdf && (k === "content-security-policy" || k === "x-frame-options")) continue;
    if (!headers.has(k)) {
      headers.set(k, v);
      changed = true;
    }
  }
  // Only over https: a browser ignores the header on plain http, and on a development machine it would be wrong to claim it.
  if (new URL(c.req.url).protocol === "https:" && !headers.has("strict-transport-security")) {
    headers.set("strict-transport-security", "max-age=31536000");
    changed = true;
  }
  // The answer to a request that carries a cookie, or sets one, must never be kept by a cache that is not the browser's own.
  if (!headers.has("cache-control") && c.req.method !== "GET") {
    headers.set("cache-control", "no-store");
    changed = true;
  }
  if (changed) c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
};
