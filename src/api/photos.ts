// Sender pictures. A person gets their Gravatar photo if they have one; a company gets the icon of its site. Lookups
// happen here, on the server, and the result is served back through /api/avatar, so opening your inbox never makes your
// browser contact the sender or a third party (the same reason spy pixels are blocked). Misses are remembered.

import { CONSUMER_DOMAINS } from "./bimi";
import { isPrivateHost as namesPrivateHost } from "./netguard";
import { chunk, now, runBatch } from "./db";
import { SENDER_PICTURES_OFF, senderPicturesOn } from "./privacy";
import type { Env } from "./env";
import { Budget, UNLIMITED } from "./jobs";

const RECHECK_HIT_MS = 30 * 24 * 3600_000;
const RECHECK_MISS_MS = 14 * 24 * 3600_000;
const MAX_LOOKUPS = 8;
const MAX_IMAGE_BYTES = 300 * 1024;
const USER_AGENT = "inbox (sender pictures)";

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const domainOf = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
const VALID_DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** A picture is only ever fetched from a real host name, never an address, and never from anything that names a private network. */
function isPrivateHost(host: string): boolean {
  return namesPrivateHost(host) || /^[\d.]+$/.test(host) || host.includes(":");
}

/** Second-level suffixes like co.uk, so that `mail.acme.co.uk` is taken to belong to `acme.co.uk` and not to `co.uk`. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** The registrable-looking parent of a subdomain (`support.aws.com` gives `aws.com`), or null when it is already one. */
export function parentDomain(domain: string): string | null {
  const labels = domain.split(".");
  if (labels.length <= 2) return null;
  if (labels.length === 3 && SECOND_LEVEL.has(labels[1]) && labels[2].length === 2) return null;
  return labels.slice(1).join(".");
}

/** Where to look for the picture of a company's site, best first: the domain itself, its `www.`, then its parent. */
export function siteIconUrls(domain: string): string[] {
  const hosts = [domain, `www.${domain}`];
  const parent = parentDomain(domain);
  if (parent) hosts.push(parent, `www.${parent}`);
  return hosts.flatMap((h) => [`https://${h}/apple-touch-icon.png`, `https://${h}/favicon.ico`]);
}
export const gravatarUrl = (hash: string, size = 160): string => `https://www.gravatar.com/avatar/${hash}?d=404&s=${size}`;

/**
 * Fetch an image, following a few redirects by hand so each hop is checked, and refusing anything that is not a small image.
 * Returns the bytes and type, or null.
 */
export async function fetchImage(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
    let target = url;
    for (let hop = 0; hop < 3; hop++) {
      const u = new URL(target);
      if (u.protocol !== "https:" || isPrivateHost(u.hostname.toLowerCase())) return null;
      const res = await fetch(target, { headers: { "user-agent": USER_AGENT, accept: "image/*" }, redirect: "manual", signal: AbortSignal.timeout(3000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        void res.body?.cancel().catch(() => { });
        target = new URL(res.headers.get("location")!, target).toString();
        continue;
      }
      // Every answer that is not used is closed, so a burst of lookups leaves nothing dangling.
      if (!res.ok) {
        void res.body?.cancel().catch(() => { });
        return null;
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (!type.startsWith("image/") || type === "image/svg+xml" || declared > MAX_IMAGE_BYTES) {
        // svg can carry script, and icons do not need it
        void res.body?.cancel().catch(() => { });
        return null;
      }
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
      return { bytes, type };
    }
  } catch {
    // unreachable, slow, or not a URL: no picture
  }
  return null;
}

/** The first picture a domain's site offers, or null. */
export async function fetchSiteIcon(domain: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  if (!VALID_DOMAIN.test(domain)) return null;
  // Ask everywhere at once and take the best answer in order, so a slow or missing address costs one wait, not several.
  const found = await Promise.all(siteIconUrls(domain).map((u) => fetchImage(u)));
  return found.find((img) => img) ?? null;
}

export async function fetchGravatar(hash: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  return /^[a-f0-9]{64}$/.test(hash) ? fetchImage(gravatarUrl(hash)) : null;
}

/**
 * Give contacts that have no picture one, for these sender addresses: their Gravatar, else (for a company, not a webmail
 * domain) their site's icon. At most MAX_LOOKUPS lookups per call; the rest wait for the next pass.
 */
export async function resolveSenderPhotos(env: Env, accountId: string, emails: string[], opts: { max?: number; picturesOn?: boolean } = {}): Promise<{ resolved: number }> {
  const db = env.DB;
  if (!(opts.picturesOn ?? (await senderPicturesOn(db, accountId)))) return { resolved: 0 };
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  if (!wanted.length) return { resolved: 0 };
  const open: string[] = [];
  for (const part of chunk(wanted, 90)) {
    const rows = await db
      .prepare(`SELECT email FROM contacts WHERE account_id = ? AND avatar_url = '' AND email IN (${part.map(() => "?").join(",")})`)
      .bind(accountId, ...part)
      .all<{ email: string }>();
    open.push(...rows.results.map((r) => r.email));
  }
  if (!open.length) return { resolved: 0 };

  const hashes = new Map<string, string>();
  for (const e of open) hashes.set(e, await sha256Hex(e));
  const keys = [...new Set([...hashes.values()].map((h) => `g:${h}`).concat(open.map((e) => `d:${domainOf(e)}`)))];
  const cached = new Map<string, { url: string; checked_at: number }>();
  for (const part of chunk(keys, 90)) {
    const rows = await db.prepare(`SELECT key, url, checked_at FROM sender_photos WHERE key IN (${part.map(() => "?").join(",")})`).bind(...part).all<{ key: string; url: string; checked_at: number }>();
    for (const r of rows.results) cached.set(r.key, r);
  }

  const t = now();
  let lookups = 0;
  const max = opts.max ?? MAX_LOOKUPS;
  const writes: DbStatement[] = [];
  /** A cached answer if it is fresh, a fresh lookup if there is budget, or undefined when neither. */
  const answer = async (key: string, look: () => Promise<{ bytes: ArrayBuffer } | null>, publicUrl: string): Promise<string | undefined> => {
    const c = cached.get(key);
    if (c && t - c.checked_at < (c.url ? RECHECK_HIT_MS : RECHECK_MISS_MS)) return c.url;
    if (lookups >= max) return c?.url || undefined;
    lookups++;
    const url = (await look()) ? publicUrl : "";
    cached.set(key, { url, checked_at: t });
    writes.push(db.prepare(`INSERT INTO sender_photos (key, url, checked_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET url = excluded.url, checked_at = excluded.checked_at`).bind(key, url, t));
    return url;
  };

  let resolved = 0;
  for (const email of open) {
    const hash = hashes.get(email)!;
    const domain = domainOf(email);
    let url = await answer(`g:${hash}`, () => fetchGravatar(hash), `/api/avatar/g/${hash}`);
    if (!url && url !== undefined && !CONSUMER_DOMAINS.test(domain) && VALID_DOMAIN.test(domain)) url = await answer(`d:${domain}`, () => fetchSiteIcon(domain), `/api/avatar/d/${domain}`);
    if (url === undefined) continue; // out of budget: leave it for the next pass, and do not mark it tried
    writes.push(db.prepare(`UPDATE contacts SET photo_checked_at = ?, avatar_url = CASE WHEN avatar_url = '' THEN ? ELSE avatar_url END WHERE account_id = ? AND email = ?`).bind(t, url, accountId, email));
    if (url) resolved++;
  }
  await runBatch(db, writes, 40);
  return { resolved };
}

/** Cron: work through contacts nobody has tried yet, a few at a time, oldest attempt first. */
export async function backfillSenderPhotos(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const db = env.DB;
  const t = now();
  const rows = await db
    .prepare(
      `SELECT account_id, email FROM contacts
       WHERE avatar_url = '' AND (photo_checked_at IS NULL OR photo_checked_at < ?)
         AND account_id NOT IN (SELECT a.id FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.settings_json ILIKE ?)
       ORDER BY COALESCE(photo_checked_at, 0), last_seen_at DESC LIMIT 6`
    )
    .bind(t - RECHECK_MISS_MS, SENDER_PICTURES_OFF)
    .all<{ account_id: string; email: string }>();
  const byAccount = new Map<string, string[]>();
  for (const r of rows.results) byAccount.set(r.account_id, [...(byAccount.get(r.account_id) ?? []), r.email]);
  for (const [accountId, emails] of byAccount) {
    if (budget.spent) break;
    await resolveSenderPhotos(env, accountId, emails, { max: 6 });
  }
}
