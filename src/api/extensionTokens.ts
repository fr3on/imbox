import type { Context } from "hono";
import type { AppEnv } from "./env";
import type { UserRow } from "./db";
import { now } from "./db";

/**
 * Tokens for the browser extension. A token is `imx_` and 40 random hex characters, shown once. The database keeps its SHA-256, so a copy of
 * the database is not a list of working tokens. A token is not a login: it works only for the few calls the extension makes, and an answer to
 * anything else is 403, whoever holds it.
 */
export const TOKEN_PREFIX = "imx_";
export const MAX_TOKENS = 10;

/** What a token may call: the counts on the icon, the senders waiting in the Screener, a decision about one of them, the latest few Imbox threads (who, subject, a line of text), and the next days of the calendar (title, time, colour, join link). */
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/counts$/ },
  { method: "GET", path: /^\/api\/screener\/waiting$/ },
  { method: "POST", path: /^\/api\/screener\/decide$/ },
  { method: "GET", path: /^\/api\/imbox\/recent$/ },
  { method: "GET", path: /^\/api\/calendar\/agenda$/ },
  { method: "GET", path: /^\/api\/notifications$/ },
  { method: "POST", path: /^\/api\/notifications\/seen$/ },
];

export const extensionMayCall = (method: string, path: string) => ALLOWED.some((a) => a.method === method.toUpperCase() && a.path.test(path));

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return TOKEN_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bearer token on the request, when it is an extension token. */
export function presentedExtensionToken(c: Context<AppEnv>): string | null {
  const auth = c.req.header("authorization") ?? "";
  if (!/^bearer /i.test(auth)) return null;
  const token = auth.slice(7).trim();
  return token.startsWith(TOKEN_PREFIX) ? token : null;
}

/** The owner of a token, or null. Notes that it was used, at most every ten minutes, so the list in Settings can say when. */
export async function userForExtensionToken(c: Context<AppEnv>, token: string): Promise<UserRow | null> {
  const id = await hashToken(token);
  const row = await c.env.DB.prepare(`SELECT u.*, k.last_used_at AS token_last_used FROM extension_tokens k JOIN users u ON u.id = k.user_id WHERE k.id = ?`)
    .bind(id)
    .first<UserRow & { token_last_used: number | null }>();
  if (!row) return null;
  const { token_last_used, ...user } = row;
  const t = now();
  if (!token_last_used || t - token_last_used > 10 * 60_000) await c.env.DB.prepare(`UPDATE extension_tokens SET last_used_at = ? WHERE id = ?`).bind(t, id).run().catch(() => {});
  return user as UserRow;
}
