import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, testEnv } from "../api-harness";
import { ROUTES, PUBLIC } from "../api-routes";
import {
  MAX_PASSWORD_LENGTH,
  MAX_LOGIN_ATTEMPTS,
  scopeModeForState,
  statePrefixFor,
  CAL_PREFIX,
  CAL_ONLY_PREFIX,
  HANDOFF_PREFIX,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
} from "../../src/api/routes/auth";
import { hashRecoveryCode } from "../../src/api/totp";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const PASSWORD = "correct horse battery";
const db = () => testEnv.DB;

const setup = async (email = "owner@example.com") => {
  const res = await call("POST", "/auth/signup", { body: { email, password: PASSWORD } });
  return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
};
const login = (password: string, ip = "10.0.0.1") => call("POST", "/auth/login", { body: { email: "owner@example.com", password }, headers: { "cf-connecting-ip": ip } });

describe("the first run", () => {
  it("makes the first user the owner, once", async () => {
    expect((await json(await call("GET", "/auth/status"))).setup_required).toBe(true);
    const { res } = await setup();
    expect(res.status).toBe(200);
    expect((await json(await call("GET", "/auth/status"))).setup_required).toBe(false);
    expect((await call("POST", "/auth/signup", { body: { email: "x@example.com", password: PASSWORD } })).status).toBe(403);
  });

  it("still answers at the old /auth/setup path", async () => {
    expect((await call("POST", "/auth/setup", { body: { email: "old@example.com", password: PASSWORD } })).status).toBe(200);
    expect((await call("POST", "/auth/signup", { body: { email: "x@example.com", password: PASSWORD } })).status).toBe(403);
  });

  it("makes one owner when several people sign up at the same moment", async () => {
    const tries = await Promise.all([1, 2, 3, 4, 5].map((n) => call("POST", "/auth/signup", { body: { email: `r${n}@example.com`, password: PASSWORD } })));
    expect(tries.filter((r) => r.status === 200)).toHaveLength(1);
    expect(tries.filter((r) => r.status === 403)).toHaveLength(4);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n).toBe(1);
  });

  it("refuses a bad email and a short password", async () => {
    expect((await json(await call("POST", "/auth/signup", { body: { email: "nope", password: PASSWORD } }))).error).toBe("invalid_email");
    expect((await json(await call("POST", "/auth/signup", { body: { email: "a@b.co", password: "short" } }))).error).toBe("password_too_short");
  });
});

describe("a session", () => {
  it("is an HttpOnly cookie that opens the API; logging out ends it", async () => {
    const { res, cookie } = await setup();
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect((await json(await call("GET", "/api/me", { headers: { cookie } }))).user.email).toBe("owner@example.com");
    await call("POST", "/auth/logout", { headers: { cookie } });
    expect((await json(await call("GET", "/api/me", { headers: { cookie } }))).user).toBeNull();
  });

  it("is refused from another site: a cookie request that changes data without the app's own header", async () => {
    const { cookie } = await setup();
    const res = await call("POST", "/api/labels", { headers: { cookie, origin: "https://evil.example" }, body: { name: "x" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("logging in", () => {
  beforeEach(async () => {
    await db().prepare(`DELETE FROM login_attempts`).run();
  });

  it("accepts the right password and refuses a wrong one, counting attempts", async () => {
    await setup();
    const bad = await login("wrong");
    expect(bad.status).toBe(401);
    expect((await json(bad)).attempts_left).toBe(4);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it("locks out after repeated failures, even for the right password", async () => {
    await setup();
    for (let i = 0; i < 5; i++) await login("wrong", "10.0.0.9");
    const locked = await login(PASSWORD, "10.0.0.9");
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBeTruthy();
  });

  it("refuses a disabled account", async () => {
    await setup();
    await db().prepare(`UPDATE users SET disabled = 1`).run();
    expect((await login(PASSWORD)).status).toBeGreaterThanOrEqual(401);
  });
});

describe("every API route needs a signed-in user", () => {
  it("answers 401, not data and not an error, to a caller with no session", async () => {
    await setup();
    const open = new Set(PUBLIC);
    const wrong: string[] = [];
    for (const [method, path] of ROUTES.filter(([, p]) => p.startsWith("/api"))) {
      if (open.has(`${method} ${path}`)) continue;
      const res = await call(method, path.replace(/:[A-Za-z]+(\{[^}]*\})?/g, "x"), { body: method === "GET" ? undefined : {} });
      if (res.status !== 401 && res.status !== 404) wrong.push(`${method} ${path}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("two-factor login", () => {
  it("requires MFA ticket and verifies recovery code", async () => {
    await setup();
    const rawCode = "abcd-efgh";
    const hashed = await hashRecoveryCode(rawCode);
    await db()
      .prepare(`UPDATE users SET totp_enabled = 1, totp_secret = 'plain_secret', recovery_codes_json = ?`)
      .bind(JSON.stringify([hashed]))
      .run();

    const loginRes = await login(PASSWORD);
    expect(loginRes.status).toBe(200);
    const loginData = await json(loginRes);
    expect(loginData.mfa_required).toBe(true);
    expect(loginData.ticket).toBeTruthy();

    const badCode = await call("POST", "/auth/login/2fa", { body: { ticket: loginData.ticket, code: "000000" } });
    expect(badCode.status).toBe(401);
    expect((await json(badCode)).attempts_left).toBe(5);

    // 3 more failed attempts (total 4)
    for (let i = 0; i < 3; i++) {
      const res = await call("POST", "/auth/login/2fa", { body: { ticket: loginData.ticket, code: "000000" } });
      expect(res.status).toBe(401);
    }
    // 5th failed attempt reaches MAX_LOGIN_ATTEMPTS
    const fifthFail = await call("POST", "/auth/login/2fa", { body: { ticket: loginData.ticket, code: "000000" } });
    expect(fifthFail.status).toBe(401);

    // 6th attempt is blocked by MFA account rate limit (429 too_many_attempts)
    const rateLocked = await call("POST", "/auth/login/2fa", { body: { ticket: loginData.ticket, code: "000000" } });
    expect(rateLocked.status).toBe(429);
    expect((await json(rateLocked)).error).toBe("too_many_attempts");

    // Also test ticket attempt limit directly
    await db().prepare(`DELETE FROM login_attempts`).run();
    await db().prepare(`UPDATE mfa_tickets SET attempts = 6 WHERE id = ?`).bind(loginData.ticket).run();
    const ticketExceeded = await call("POST", "/auth/login/2fa", { body: { ticket: loginData.ticket, code: "000000" } });
    expect(ticketExceeded.status).toBe(429);
    expect((await json(ticketExceeded)).error).toBe("mfa_too_many_attempts");

    // Clear rate limits and try fresh ticket with recovery code
    await db().prepare(`DELETE FROM login_attempts`).run();
    const loginRes2 = await login(PASSWORD);
    const ticket2 = (await json(loginRes2)).ticket;

    const good = await call("POST", "/auth/login/2fa", { body: { ticket: ticket2, code: rawCode } });
    expect(good.status).toBe(200);
    expect((await json(good)).user.email).toBe("owner@example.com");

    // Recovery code was consumed
    const userRow = await db().prepare("SELECT recovery_codes_json FROM users").first<{ recovery_codes_json: string }>();
    expect(JSON.parse(userRow?.recovery_codes_json || "[]")).toEqual([]);
  });

  it("rejects expired or missing tickets", async () => {
    const res = await call("POST", "/auth/login/2fa", { body: { ticket: "nonexistent", code: "123456" } });
    expect(res.status).toBe(401);
    expect((await json(res)).error).toBe("mfa_ticket_expired");
  });
});

describe("auth helpers and constants", () => {
  it("enforces MAX_PASSWORD_LENGTH on signup", async () => {
    expect(MAX_PASSWORD_LENGTH).toBe(1024);
    const longPass = "a".repeat(1025);
    const res = await call("POST", "/auth/signup", { body: { email: "owner@example.com", password: longPass } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("password_too_long");
  });

  it("maps OAuth state prefixes and scope modes", () => {
    expect(scopeModeForState(`prefix_${CAL_ONLY_PREFIX}xyz`)).toBe("calendar");
    expect(scopeModeForState(`prefix_${CAL_PREFIX}xyz`)).toBe("mail+calendar");
    expect(scopeModeForState(`prefix_${HANDOFF_PREFIX}xyz`)).toBe("mail");

    expect(statePrefixFor("calendar")).toBe(CAL_ONLY_PREFIX);
    expect(statePrefixFor("mail+calendar")).toBe(CAL_PREFIX);
    expect(statePrefixFor("mail")).toBe("");
  });

  it("checks, records, and clears login rate limits", async () => {
    const key = "test-rate-key";
    await clearLoginAttempts(db(), [key]);

    const initial = await checkLoginRateLimit(db(), [key]);
    expect(initial.locked).toBe(false);

    let result: Awaited<ReturnType<typeof recordFailedLogin>> | undefined;
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      result = await recordFailedLogin(db(), [key]);
    }
    expect(result?.locked).toBe(true);
    expect(result?.attemptsLeft).toBe(0);

    const locked = await checkLoginRateLimit(db(), [key]);
    expect(locked.locked).toBe(true);
    expect(locked.retryAfter).toBeGreaterThan(0);

    await clearLoginAttempts(db(), [key]);
    const afterClear = await checkLoginRateLimit(db(), [key]);
    expect(afterClear.locked).toBe(false);
  });
});
