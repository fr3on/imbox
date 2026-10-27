import type { Context } from "hono";
import type { AppEnv } from "../../env";
import { now } from "../../db";
import type { GoogleScopeMode } from "../../google";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Hashing a password costs the same however long it is, up to a point; past it, a request is only a way to make the server work. */
export const MAX_PASSWORD_LENGTH = 1024;
/** The longest address that can exist (RFC 5321). Login attempts are counted per address, so an unbounded one is an unbounded row. */
export const MAX_EMAIL = 254;

/** Any fixed number: the key of the lock that makes first-run sign-up one at a time. */
export const SIGNUP_LOCK = 7_262_001;

export async function userCount(db: Db): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  return r?.n ?? 0;
}

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60_000;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MFA_MAX_ATTEMPTS = 6;

export function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    "127.0.0.1"
  );
}

export async function checkLoginRateLimit(db: Db, keys: string[]): Promise<{ locked: boolean; retryAfter?: number }> {
  const t = now();
  for (const key of keys) {
    if (!key) continue;
    const row = await db
      .prepare(`SELECT attempts, last_attempt_at, locked_until FROM login_attempts WHERE key = ?`)
      .bind(key)
      .first<{ attempts: number; last_attempt_at: number; locked_until: number | null }>();
    if (row?.locked_until && row.locked_until > t) {
      return {
        locked: true,
        retryAfter: Math.max(1, Math.ceil((row.locked_until - t) / 1000)),
      };
    }
  }
  return { locked: false };
}

export async function recordFailedLogin(db: Db, keys: string[]): Promise<{ locked: boolean; retryAfter?: number; attemptsLeft: number }> {
  const t = now();
  let mostRestricted = { locked: false, retryAfter: undefined as number | undefined, attemptsLeft: MAX_LOGIN_ATTEMPTS };

  for (const key of keys) {
    if (!key) continue;
    // One statement, counted by the database: requests that fail together are each counted, where a read followed by a write gave them all the same count.
    const row = await db
      .prepare(
        `INSERT INTO login_attempts (key, attempts, last_attempt_at, locked_until) VALUES (?, 1, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET
           attempts = CASE WHEN excluded.last_attempt_at - login_attempts.last_attempt_at < CAST(? AS BIGINT) THEN login_attempts.attempts + 1 ELSE 1 END,
           last_attempt_at = excluded.last_attempt_at,
           locked_until = CASE
             WHEN (CASE WHEN excluded.last_attempt_at - login_attempts.last_attempt_at < CAST(? AS BIGINT) THEN login_attempts.attempts + 1 ELSE 1 END) >= CAST(? AS BIGINT)
             THEN excluded.last_attempt_at + CAST(? AS BIGINT) ELSE NULL END
         RETURNING attempts, locked_until`
      )
      .bind(key, t, LOGIN_WINDOW_MS, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS, LOGIN_LOCKOUT_MS)
      .first<{ attempts: number; locked_until: number | null }>();
    const attempts = row?.attempts ?? 1;
    const lockedUntil = row?.locked_until ?? null;

    const left = Math.max(0, MAX_LOGIN_ATTEMPTS - attempts);
    if (lockedUntil) {
      mostRestricted = {
        locked: true,
        retryAfter: Math.ceil(LOGIN_LOCKOUT_MS / 1000),
        attemptsLeft: 0,
      };
    } else if (left < mostRestricted.attemptsLeft) {
      mostRestricted = { locked: false, retryAfter: undefined, attemptsLeft: left };
    }
  }

  return mostRestricted;
}

/** A connect-your-account link's state, good for an hour and for one use: the person it was made for, or null. */
export async function consumeOauthState(db: Db, state: string): Promise<{ user_id: string } | null> {
  // Taken in one statement, so of two requests that arrive together only one gets it.
  const st = await db.prepare(`DELETE FROM oauth_states WHERE state = ? AND created_at > ? RETURNING user_id`).bind(state, now() - 3600_000).first<{ user_id: string }>();
  return st ? { user_id: st.user_id } : null;
}

export async function clearLoginAttempts(db: Db, keys: string[]) {
  for (const key of keys) {
    if (!key) continue;
    await db.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(key).run();
  }
}

/** Where this deployment lives, as the browser sees it (localhost wins over APP_URL in dev). */
export function appOrigin(c: any): string {
  const url = new URL(c.req.url);
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : c.env.APP_URL || url.origin;
}

export function redirectUriFor(c: any): string {
  return `${appOrigin(c)}/auth/google/callback`;
}

export function msRedirectUriFor(c: any): string {
  return `${appOrigin(c)}/auth/microsoft/callback`;
}

/**
 * States minted for the "open Google in the real browser" handoff carry this prefix, so the callback
 * knows to finish with a plain confirmation page instead of redirecting into the app's webview.
 */
export const HANDOFF_PREFIX = "hx_";
/** States that additionally ask for the Google Calendar scope. Combines with HANDOFF_PREFIX. */
export const CAL_PREFIX = "cal_";
/** States that ask for Calendar and *nothing else* — no mail scope at all. Combines with HANDOFF_PREFIX. */
export const CAL_ONLY_PREFIX = "calonly_";

/** Which scope set a minted state stands for. "calonly_" is checked first: it is not a "cal_" state. */
export function scopeModeForState(state: string): GoogleScopeMode {
  if (state.includes(CAL_ONLY_PREFIX)) return "calendar";
  if (state.includes(CAL_PREFIX)) return "mail+calendar";
  return "mail";
}

/** The state prefix (after any handoff prefix) for a scope mode. */
export function statePrefixFor(mode: GoogleScopeMode): string {
  return mode === "calendar" ? CAL_ONLY_PREFIX : mode === "mail+calendar" ? CAL_PREFIX : "";
}

/** Standalone page shown in the browser tab that finished a handoff (the app is a separate window). */
export function handoffPage(title: string, detail: string): string {
  const esc = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Imbox</title><style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff;color:#37352f;
font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:22rem;padding:2rem;text-align:center}
.mark{width:40px;height:40px;border-radius:10px;background:#37352f;color:#fff;display:flex;align-items:center;
justify-content:center;font-weight:700;margin:0 auto 1.25rem}
h1{font-size:17px;margin:0 0 .4rem;font-weight:600}
p{margin:0;color:rgba(55,53,47,.65)}
@media (prefers-color-scheme:dark){body{background:#191919;color:#d4d4d4}.mark{background:#d4d4d4;color:#191919}p{color:rgba(255,255,255,.55)}}
</style></head><body><main><div class="mark">h</div><h1>${esc(title)}</h1><p>${esc(detail)}</p></main></body></html>`;
}
