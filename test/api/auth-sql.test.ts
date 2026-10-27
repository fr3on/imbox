import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, testEnv } from "../api-harness";
import { consumePasskeyChallenge } from "../../src/api/passkeys";
import { LOGIN_LOCKOUT_MS, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS, MFA_MAX_ATTEMPTS, checkLoginRateLimit, clearLoginAttempts, consumeOauthState, recordFailedLogin } from "../../src/api/routes/auth/shared";
import { hashRecoveryCode } from "../../src/api/totp";

/**
 * What the sign-in tables guarantee when requests arrive together: a failed attempt is counted once each, a challenge, a sign-in state and a two-factor
 * ticket's guesses are each used the number of times they allow and no more. Each was a read followed by a write, so requests that overlapped all
 * read the same answer. Pinned with the one-at-a-time behaviour first.
 */

const db = () => testEnv.DB;
const PASSWORD = "correct horse battery";
const row = async (key: string) => db().prepare(`SELECT attempts, last_attempt_at, locked_until FROM login_attempts WHERE key = ?`).bind(key).first<{ attempts: number; last_attempt_at: number; locked_until: number | null }>();

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db().prepare(`DELETE FROM login_attempts`).run();
});

describe("failed sign-ins", () => {
  it("counts one at a time, says how many are left, and locks at the limit for the lockout time", async () => {
    const left: number[] = [];
    for (let i = 1; i < MAX_LOGIN_ATTEMPTS; i++) left.push((await recordFailedLogin(db(), ["k1"])).attemptsLeft);
    expect(left).toEqual([4, 3, 2, 1]);
    expect(await checkLoginRateLimit(db(), ["k1"])).toEqual({ locked: false });
    const last = await recordFailedLogin(db(), ["k1"]);
    expect(last).toMatchObject({ locked: true, attemptsLeft: 0, retryAfter: LOGIN_LOCKOUT_MS / 1000 });
    expect((await row("k1"))!.attempts).toBe(MAX_LOGIN_ATTEMPTS);
    expect((await checkLoginRateLimit(db(), ["k1"])).locked).toBe(true);
  });

  it("starts the count again when the last failure is older than the window, and forgets a lock that has run out", async () => {
    await recordFailedLogin(db(), ["k2"]);
    await recordFailedLogin(db(), ["k2"]);
    await db().prepare(`UPDATE login_attempts SET last_attempt_at = ? WHERE key = 'k2'`).bind(Date.now() - LOGIN_WINDOW_MS - 1000).run();
    expect((await recordFailedLogin(db(), ["k2"])).attemptsLeft).toBe(MAX_LOGIN_ATTEMPTS - 1);
    expect((await row("k2"))!.attempts).toBe(1);
    await db().prepare(`UPDATE login_attempts SET attempts = 5, locked_until = ? WHERE key = 'k2'`).bind(Date.now() - 1000).run();
    expect((await checkLoginRateLimit(db(), ["k2"])).locked).toBe(false);
  });

  it("answers for the most restricted of several keys, and clears them all", async () => {
    await recordFailedLogin(db(), ["ka"]);
    await recordFailedLogin(db(), ["ka"]);
    const r = await recordFailedLogin(db(), ["ka", "kb", ""]);
    expect(r.attemptsLeft).toBe(MAX_LOGIN_ATTEMPTS - 3);
    expect((await row("kb"))!.attempts).toBe(1);
    await clearLoginAttempts(db(), ["ka", "kb"]);
    expect(await row("ka")).toBeNull();
    expect(await row("kb")).toBeNull();
  });

  it("counts every failure of requests that arrive together", async () => {
    await Promise.all(Array.from({ length: 12 }, () => recordFailedLogin(db(), ["burst"])));
    expect((await row("burst"))!.attempts).toBe(12);
    expect((await checkLoginRateLimit(db(), ["burst"])).locked).toBe(true);
  });

  it("is one statement for each key", async () => {
    const { resetStatements, sent } = await import("../support/pgenv");
    resetStatements();
    await recordFailedLogin(db(), ["s1", "s2"]);
    expect(sent.statements).toBe(2);
  });
});

describe("a passkey challenge", () => {
  const challenge = async (id: string, type = "auth", expiresIn = 60_000, user: string | null = null) =>
    db().prepare(`INSERT INTO passkey_challenges (challenge, user_id, type, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).bind(id, user, type, Date.now(), Date.now() + expiresIn).run();

  it("is good once, for its own kind, before it runs out, and says whose it was", async () => {
    await db().prepare(`DELETE FROM passkey_challenges`).run();
    await challenge("c1", "auth", 60_000, null);
    expect(await consumePasskeyChallenge(db(), "c1", "register")).toEqual({ valid: false, userId: null });
    expect(await consumePasskeyChallenge(db(), "c1", "auth")).toEqual({ valid: true, userId: null });
    expect(await consumePasskeyChallenge(db(), "c1", "auth")).toEqual({ valid: false, userId: null });
    await challenge("c2", "auth", -1000);
    expect(await consumePasskeyChallenge(db(), "c2", "auth")).toEqual({ valid: false, userId: null });
  });

  it("is good once for requests that arrive together", async () => {
    await challenge("c3");
    const results = await Promise.all(Array.from({ length: 10 }, () => consumePasskeyChallenge(db(), "c3", "auth")));
    expect(results.filter((r) => r.valid)).toHaveLength(1);
  });
});

describe("the state of a connect-your-account link", () => {
  const state = (id: string, user: string, ageMs = 0) => db().prepare(`INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)`).bind(id, user, Date.now() - ageMs).run();
  beforeEach(async () => {
    await db().prepare(`DELETE FROM oauth_states`).run();
    await db().prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('os-u', 'os@test.local', '', 'x', 1) ON CONFLICT DO NOTHING`).run();
  });

  it("names its person once, and not after an hour or when it was never made", async () => {
    await state("s1", "os-u");
    await state("s-old", "os-u", 3_700_000);
    expect(await consumeOauthState(db(), "s1")).toEqual({ user_id: "os-u" });
    expect(await consumeOauthState(db(), "s1")).toBeNull();
    expect(await consumeOauthState(db(), "s-old")).toBeNull();
    expect(await consumeOauthState(db(), "nope")).toBeNull();
  });

  it("names its person once for requests that arrive together", async () => {
    await state("s2", "os-u");
    const results = await Promise.all(Array.from({ length: 10 }, () => consumeOauthState(db(), "s2")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("two-factor guesses", () => {
  async function ticket() {
    await call("POST", "/auth/signup", { body: { email: "owner@example.com", password: PASSWORD } }).catch(() => {});
    await db().prepare(`UPDATE users SET totp_enabled = 1, totp_secret = 'plain_secret', recovery_codes_json = ? WHERE email = 'owner@example.com'`).bind(JSON.stringify([await hashRecoveryCode("abcd-efgh")])).run();
    const r = await call("POST", "/auth/login", { body: { email: "owner@example.com", password: PASSWORD }, headers: { "cf-connecting-ip": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
    return (await json(r)).ticket as string;
  }

  it("a ticket allows its guesses and no more, even when they arrive together", async () => {
    const t = await ticket();
    expect(t).toBeTruthy();
    const answers = await Promise.all(Array.from({ length: 16 }, () => call("POST", "/auth/login/2fa", { body: { ticket: t, code: "000000" } })));
    const wrong = answers.filter((r) => r.status === 401).length;
    expect(wrong).toBeLessThanOrEqual(MFA_MAX_ATTEMPTS);
    expect(answers.every((r) => [401, 429].includes(r.status))).toBe(true);
    const left = await db().prepare(`SELECT attempts FROM mfa_tickets WHERE id = ?`).bind(t).first<{ attempts: number }>();
    expect(left === null || left.attempts <= MFA_MAX_ATTEMPTS).toBe(true);
  });
});

describe("sessions and attempts that nobody needs", () => {
  it("a sign-in clears the sessions that ran out and the failed attempts that are old and not locked, and keeps the rest", async () => {
    await call("POST", "/auth/signup", { body: { email: "owner@example.com", password: PASSWORD } }).catch(() => {});
    const user = (await db().prepare(`SELECT id FROM users WHERE email = 'owner@example.com'`).first<{ id: string }>())!.id;
    const t = Date.now();
    await db().prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('old-s', ?, 1, ?), ('live-s', ?, 1, ?)`).bind(user, t - 1000, user, t + 100_000).run();
    await db().prepare(`INSERT INTO login_attempts (key, attempts, last_attempt_at, locked_until) VALUES ('stale', 2, ?, NULL), ('stale-lock', 5, ?, ?), ('fresh', 2, ?, NULL), ('locked', 5, ?, ?)`)
      .bind(t - 2 * LOGIN_WINDOW_MS, t - 2 * LOGIN_WINDOW_MS, t - 1000, t - 1000, t - 1000, t + 100_000).run();
    const r = await call("POST", "/auth/login", { body: { email: "owner@example.com", password: PASSWORD }, headers: { "cf-connecting-ip": "10.8.8.8" } });
    expect(r.status).toBe(200);
    const sessions = (await db().prepare(`SELECT id FROM sessions WHERE id IN ('old-s', 'live-s')`).all<{ id: string }>()).results.map((x) => x.id);
    expect(sessions).toEqual(["live-s"]);
    const keys = (await db().prepare(`SELECT key FROM login_attempts ORDER BY key`).all<{ key: string }>()).results.map((x) => x.key);
    expect(keys).toEqual(["fresh", "locked"]);
  });
});
