import { cleanZone } from "./timezone";
import { deviceOf, logActivity } from "./activity";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { extensionMayCall, presentedExtensionToken, userForExtensionToken } from "./extensionTokens";
import type { UserRow, AccountRow } from "./db";
import { accountsWithAgentFlag, now } from "./db";
import { LOGIN_WINDOW_MS } from "./routes/auth/shared";

const PBKDF2_ITER = 100_000;
const SESSION_COOKIE = "imbox_session";
const SESSION_KEY_PREFIX = "s1:";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What the sessions table holds for a session token. The browser keeps the token; the database keeps only its hash, so a copy of the
 * database (a backup, a dump) is not a list of working logins. Rows made before this was added hold the bare token and still work until they
 * expire (or until their owner next uses them, when they are rewritten).
 */
export async function sessionKey(token: string): Promise<string> {
  return `${SESSION_KEY_PREFIX}${await sha256Hex(token)}`;
}

/**
 * The ids a presented token may match: its hash, and (for a session from before hashing) the bare token. A token that itself starts with the
 * prefix is never taken as a bare id, or a stored hash read out of the database would work as a login.
 */
async function sessionIds(token: string): Promise<[string, string]> {
  return [await sessionKey(token), token.startsWith(SESSION_KEY_PREFIX) ? "" : token];
}

let dummyHash: Promise<string> | null = null;
/** A hash to check a password against when the account does not exist, so an unknown address takes as long to refuse as a wrong password. */
export function decoyPasswordHash(): Promise<string> {
  return (dummyHash ??= hashPassword(crypto.randomUUID()));
}

function randomId(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<string> {
  const id = randomId(32);
  const t = now();
  await c.env.DB.prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)`)
    .bind(await sessionKey(id), userId, t, t + SESSION_TTL_MS, (c.req.header("user-agent") ?? "").slice(0, 300) || null)
    .run();
  // Nothing else ever removes a session that ran out, or a failed-attempt row for an address nobody tried again, so each login clears the ones that have.
  // A row still locked is kept, and so is one inside its window.
  await c.env.DB
    .batch([
      c.env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(t),
      c.env.DB.prepare(`DELETE FROM login_attempts WHERE last_attempt_at < ? AND (locked_until IS NULL OR locked_until < ?)`).bind(t - LOGIN_WINDOW_MS, t),
    ])
    .catch(() => {});
  setSessionCookie(c, id);
  await logActivity(c.env.DB, userId, { actor: "security", kind: "sign_in", summary: "Signed in", why: deviceOf(c.req.header("user-agent")) });
  return id;
}

function setSessionCookie(c: Context<AppEnv>, id: string) {
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(c: Context<AppEnv>) {
  const id = getSessionId(c);
  if (id) await c.env.DB.prepare(`DELETE FROM sessions WHERE id IN (?, ?)`).bind(...(await sessionIds(id))).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

function getSessionId(c: Context<AppEnv>): string | null {
  const auth = c.req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return getCookie(c, SESSION_COOKIE) ?? null;
}

const sessionOf = new WeakMap<Request, Promise<UserRow | null>>();

/** The signed-in user, read once for a request: a page load asks through the check that lets an anonymous caller see the sign-in page, and again through the one that requires a user. */
export function getSessionUser(c: Context<AppEnv>): Promise<UserRow | null> {
  let found = sessionOf.get(c.req.raw);
  if (!found) {
    found = readSessionUser(c);
    sessionOf.set(c.req.raw, found);
  }
  return found;
}

async function readSessionUser(c: Context<AppEnv>): Promise<UserRow | null> {
  const id = getSessionId(c);
  if (!id) return null;
  const [key, legacy] = await sessionIds(id);
  const row = await c.env.DB.prepare(
    `SELECT u.*, s.id AS session_row_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id IN (?, ?) AND s.expires_at > ?`
  )
    .bind(key, legacy, now())
    .first<UserRow & { session_row_id: string }>();
  if (!row) return null;
  const { session_row_id, ...user } = row;
  // A session from before tokens were hashed: rewrite it so the bare token is no longer stored.
  if (session_row_id === legacy) await c.env.DB.prepare(`UPDATE sessions SET id = ? WHERE id = ?`).bind(key, id).run().catch(() => {});
  return user as UserRow;
}

/** Sign out everywhere except here: after a password change, a session someone else may hold must stop working. */
export async function revokeOtherSessions(c: Context<AppEnv>, userId: string): Promise<void> {
  const id = getSessionId(c);
  const keep = id ? await sessionIds(id) : ["", ""];
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id NOT IN (?, ?)`).bind(userId, keep[0], keep[1]).run();
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  // The browser extension's token: good for a few calls, and for nothing else.
  const extToken = presentedExtensionToken(c);
  if (extToken) {
    const owner = await userForExtensionToken(c, extToken);
    if (!owner) return c.json({ error: "unauthorized" }, 401);
    if (owner.disabled) return c.json({ error: "account_disabled" }, 403);
    if (!extensionMayCall(c.req.method, new URL(c.req.url).pathname)) return c.json({ error: "forbidden", message: "This token cannot do that." }, 403);
    c.set("user", owner);
    return next();
  }
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.disabled) return c.json({ error: "account_disabled" }, 403);
  // The browser says where it is on every call; keep the last answer so background work knows too.
  const zone = cleanZone(c.req.header("x-timezone"));
  if (zone && zone !== user.detected_timezone) {
    await c.env.DB.prepare(`UPDATE users SET detected_timezone = ? WHERE id = ?`).bind(zone, user.id).run().catch(() => {});
    user.detected_timezone = zone;
  }
  c.set("user", user);
  await next();
};


/**
 * Account scope. `X-Account-Id: <id>` (or `?account=<id>`) narrows to one account; `all` or absent is the
 * unified scope across every account the user owns. An id that doesn't belong to the user falls back to unified.
 */
export const requireAccount: MiddlewareHandler<AppEnv> = async (c, next) => {
  // It is mounted on a list's path and on the paths under it (`/threads` and `/threads/*`), and a request to the list matches both. Once is enough.
  if (c.get("accountIds")) return next();
  const user = c.get("user");
  const wanted = (c.req.header("x-account-id") || c.req.query("account") || "").trim();
  // An agent's mailbox is automated traffic: it stays out of your unified inbox, Screener and counts, and is
  // one click away when you pick it by name. If it is all you have connected, it is the whole inbox.
  // One query says both which accounts the user has and which of them are agents'.
  const all = await accountsWithAgentFlag(c.env.DB, user.id);
  const agentIds = new Set(all.filter((r) => r.is_agent).map((r) => r.id));
  const accounts = all.map(({ is_agent: _agent, ...a }) => a as AccountRow);
  if (!accounts.length) return c.json({ error: "no_account" }, 400);
  const specific = wanted && wanted !== "all" ? accounts.find((a) => a.id === wanted) ?? null : null;
  const personal = accounts.filter((a) => !agentIds.has(a.id));
  const unified = personal.length ? personal : accounts;
  c.set("account", specific ?? unified[0]);
  c.set("accountIds", specific ? [specific.id] : unified.map((a) => a.id));
  c.set("allAccountIds", accounts.map((a) => a.id));
  await next();
};
