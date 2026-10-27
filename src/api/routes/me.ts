import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import type { UserRow } from "../db";
import { accountsWithAgentFlag, now, toAccount, toUser, safeJson } from "../db";
import { hashPassword, verifyPassword, revokeOtherSessions } from "../auth";
import { openSecret, sealSecret } from "../secrets";
import { checkLoginRateLimit, recordFailedLogin, clearLoginAttempts, MAX_PASSWORD_LENGTH } from "./auth";
import { configuredProviders } from "../oauth";
import { generateSecret, otpauthUrl, verifyTotp, generateRecoveryCodes, hashRecoveryCode, matchRecoveryCode } from "../totp";
import type { UserSettings } from "@shared/types";
import { sanitizeBrand } from "../../shared/brand";
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { getWebAuthnConfig, savePasskeyChallenge, consumePasskeyChallenge } from "../passkeys";
import { isObject, str } from "../input";
import { MAX_TOKENS, hashToken, newToken } from "../extensionTokens";

/** Settings are a small bag of preferences; a megabyte of them is not a preference. */
const MAX_SETTINGS_BYTES = 100_000;

const me = new Hono<AppEnv>();

me.get("/", async (c) => {
  const user = c.get("user");
  const accounts = await accountsWithAgentFlag(c.env.DB, user.id);
  const cfg = await configuredProviders(c.env);
  return c.json({
    user: toUser(user),
    accounts: accounts.map((a) => ({ ...toAccount(a), ...(a.is_agent ? { is_agent: true } : {}) })),
    setup_required: false,
    google_configured: cfg.google,
    microsoft_configured: cfg.microsoft,
    app_name: sanitizeBrand(c.env.APP_NAME),
  });
});

me.patch("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string; settings?: UserSettings }>().catch(() => ({}) as any);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : user.name;
  if (body.settings !== undefined && !isObject(body.settings)) return c.json({ error: "invalid_settings", message: "Settings must be an object." }, 400);
  const settings = body.settings ? { ...safeJson<UserSettings>(user.settings_json, {}), ...body.settings } : safeJson<UserSettings>(user.settings_json, {});
  if (JSON.stringify(settings).length > MAX_SETTINGS_BYTES) return c.json({ error: "settings_too_large" }, 400);
  await c.env.DB.prepare(`UPDATE users SET name = ?, settings_json = ? WHERE id = ?`).bind(name, JSON.stringify(settings), user.id).run();
  const fresh = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(user.id).first<UserRow>();
  return c.json({ user: toUser(fresh!) });
});

/**
 * Checks the current password for a sensitive change, with the same counting as the login page: whoever holds a session (a stolen cookie, say)
 * must not be able to guess the password here without limit. Returns a response to send when the check fails.
 */
async function confirmPassword(c: Context<AppEnv>, user: UserRow, password: string): Promise<Response | null> {
  const key = `pw:${user.id}`;
  const limit = await checkLoginRateLimit(c.env.DB, [key]);
  if (limit.locked) return c.json({ error: "too_many_attempts", message: "Too many wrong passwords. Try again later." }, 429, { "retry-after": String(limit.retryAfter ?? 60) });
  if (password.length > MAX_PASSWORD_LENGTH || !(await verifyPassword(password, user.password_hash))) {
    const fail = await recordFailedLogin(c.env.DB, [key]);
    if (fail.locked) return c.json({ error: "too_many_attempts", message: "Too many wrong passwords. Try again later." }, 429, { "retry-after": String(fail.retryAfter ?? 60) });
    return c.json({ error: "invalid_credentials" }, 401);
  }
  await clearLoginAttempts(c.env.DB, [key]);
  return null;
}

me.post("/password", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ current?: string; next?: string }>().catch(() => ({}) as any);
  const refused = await confirmPassword(c, user, typeof body.current === "string" ? body.current : "");
  if (refused) return refused;
  const next = typeof body.next === "string" ? body.next : "";
  if (next.length < 8) return c.json({ error: "password_too_short" }, 400);
  if (next.length > MAX_PASSWORD_LENGTH) return c.json({ error: "password_too_long" }, 400);
  await c.env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(await hashPassword(next), user.id).run();
  // Every other signed-in browser and device is signed out: the reason to change a password is often that someone else may have got in.
  await revokeOtherSessions(c, user.id);
  return c.json({ ok: true, at: now() });
});

// ---------- Two-factor authentication ----------

function recoveryList(u: UserRow): string[] {
  return safeJson<string[]>(u.recovery_codes_json ?? "[]", []);
}

/** The signed-in user, as this request read them a moment ago with the session: there is nothing newer to ask for. */
async function freshUser(c: Context<AppEnv>): Promise<UserRow> {
  return c.get("user");
}

/** The key under which wrong second-factor codes are counted: shared with the login page's, so the two cannot be used to take turns guessing. */
const mfaKey = (u: UserRow) => `mfa:${u.id}`;

/** A valid TOTP code, or an unused recovery code (which gets consumed). */
async function checkSecondFactor(env: Env, u: UserRow, code: string): Promise<boolean> {
  const db = env.DB;
  if (!u.totp_enabled || !u.totp_secret) return false;
  if ((await checkLoginRateLimit(db, [mfaKey(u)])).locked) return false;
  if (await verifyTotp(await openSecret(env, u.totp_secret), code)) return true;
  const list = recoveryList(u);
  const idx = await matchRecoveryCode(code, list);
  if (idx < 0) {
    await recordFailedLogin(db, [mfaKey(u)]);
    return false;
  }
  list.splice(idx, 1);
  await db.prepare(`UPDATE users SET recovery_codes_json = ? WHERE id = ?`).bind(JSON.stringify(list), u.id).run();
  return true;
}

me.get("/2fa", async (c) => {
  const u = await freshUser(c);
  return c.json({ enabled: !!u.totp_enabled, recovery_left: u.totp_enabled ? recoveryList(u).length : 0 });
});

me.post("/2fa/setup", async (c) => {
  const u = await freshUser(c);
  if (u.totp_enabled) return c.json({ error: "already_enabled" }, 400);
  const secret = generateSecret();
  await c.env.DB.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?`).bind(await sealSecret(c.env, secret), u.id).run();
  return c.json({ secret, otpauth_url: otpauthUrl(u.email, secret, "imbox") });
});

me.post("/2fa/enable", async (c) => {
  const u = await freshUser(c);
  const body = await c.req.json<{ code?: string }>().catch(() => ({}) as any);
  if (u.totp_enabled) return c.json({ error: "already_enabled" }, 400);
  if (!u.totp_secret) return c.json({ error: "setup_first" }, 400);
  if (!(await verifyTotp(await openSecret(c.env, u.totp_secret), str(body.code, 64)))) return c.json({ error: "invalid_code" }, 400);
  const codes = generateRecoveryCodes();
  const hashed = await Promise.all(codes.map((x) => hashRecoveryCode(x)));
  await c.env.DB.prepare(`UPDATE users SET totp_enabled = 1, recovery_codes_json = ? WHERE id = ?`).bind(JSON.stringify(hashed), u.id).run();
  return c.json({ ok: true, recovery_codes: codes });
});

me.post("/2fa/recovery-codes", async (c) => {
  const u = await freshUser(c);
  const body = await c.req.json<{ code?: string }>().catch(() => ({}) as any);
  if (!u.totp_enabled || !u.totp_secret) return c.json({ error: "not_enabled" }, 400);
  if ((await checkLoginRateLimit(c.env.DB, [mfaKey(u)])).locked) return c.json({ error: "too_many_attempts" }, 429);
  if (!(await verifyTotp(await openSecret(c.env, u.totp_secret), str(body.code, 64)))) {
    await recordFailedLogin(c.env.DB, [mfaKey(u)]);
    return c.json({ error: "invalid_code" }, 400);
  }
  const codes = generateRecoveryCodes();
  const hashed = await Promise.all(codes.map((x) => hashRecoveryCode(x)));
  await c.env.DB.prepare(`UPDATE users SET recovery_codes_json = ? WHERE id = ?`).bind(JSON.stringify(hashed), u.id).run();
  return c.json({ ok: true, recovery_codes: codes });
});

me.post("/2fa/disable", async (c) => {
  const u = await freshUser(c);
  const body = await c.req.json<{ password?: string; code?: string }>().catch(() => ({}) as any);
  const refused = await confirmPassword(c, u, typeof body.password === "string" ? body.password : "");
  if (refused) return refused;
  if (u.totp_enabled && !(await checkSecondFactor(c.env, u, str(body.code, 64)))) return c.json({ error: "invalid_code" }, 400);
  await c.env.DB.prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0, recovery_codes_json = '[]' WHERE id = ?`).bind(u.id).run();
  return c.json({ ok: true });
});

/* ---------- Passkeys ---------- */

me.get("/passkeys", async (c) => {
  const u = await freshUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(u.id).all();
  return c.json({ passkeys: rows.results });
});

me.post("/passkeys/register-options", async (c) => {
  const u = await freshUser(c);
  const config = getWebAuthnConfig(c);
  const existing = await c.env.DB.prepare(
    `SELECT id, transports_json FROM passkeys WHERE user_id = ?`
  ).bind(u.id).all<{ id: string; transports_json: string }>();

  const options = await generateRegistrationOptions({
    rpName: sanitizeBrand(c.env.APP_NAME) || "Imbox",
    rpID: config.rpID,
    userID: isoUint8Array.fromUTF8String(u.id),
    userName: u.email,
    userDisplayName: u.name || u.email,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.results.map((p) => ({
      id: p.id,
      transports: JSON.parse(p.transports_json || "[]"),
    })),
  });

  await savePasskeyChallenge(c.env.DB, options.challenge, "register", u.id);
  return c.json(options);
});

me.post("/passkeys/register-verify", async (c) => {
  const u = await freshUser(c);
  const body = await c.req.json<{ response?: RegistrationResponseJSON; name?: string }>().catch(() => ({}) as any);
  const resp = body.response;
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) return c.json({ error: "missing_response", message: "Missing registration response." }, 400);

  let clientData: { challenge?: string } = {};
  try {
    const jsonStr = new TextDecoder().decode(isoBase64URL.toBuffer(resp.response.clientDataJSON));
    clientData = JSON.parse(jsonStr);
  } catch {
    return c.json({ error: "invalid_client_data", message: "Could not parse client data." }, 400);
  }

  const challenge = clientData.challenge;
  if (!challenge) return c.json({ error: "missing_challenge", message: "Challenge missing from client data." }, 400);

  const challengeCheck = await consumePasskeyChallenge(c.env.DB, challenge, "register");
  if (!challengeCheck.valid || challengeCheck.userId !== u.id) {
    return c.json({ error: "challenge_expired", message: "Registration session expired. Please try again." }, 400);
  }

  const config = getWebAuthnConfig(c);
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: resp,
      expectedChallenge: challenge,
      expectedOrigin: config.allowedOrigins,
      expectedRPID: config.rpID,
      requireUserVerification: false,
    });
  } catch (err: any) {
    return c.json({ error: "verification_failed", message: err.message || "Passkey registration verification failed." }, 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    return c.json({ error: "verification_failed", message: "Passkey registration could not be verified." }, 400);
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const publicKeyBase64 = isoBase64URL.fromBuffer(credential.publicKey);
  const transportsJson = JSON.stringify(credential.transports || []);
  const name = str(body.name, 100) || "Passkey";
  const t = now();

  await c.env.DB.prepare(
    `INSERT INTO passkeys (id, user_id, name, public_key, counter, device_type, backed_up, transports_json, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      credential.id,
      u.id,
      name,
      publicKeyBase64,
      credential.counter,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      transportsJson,
      t,
      t
    )
    .run();

  return c.json({
    ok: true,
    passkey: {
      id: credential.id,
      name,
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      created_at: t,
      last_used_at: t,
    },
  });
});

me.delete("/passkeys/:id", async (c) => {
  const u = await freshUser(c);
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM passkeys WHERE id = ? AND user_id = ?`).bind(id, u.id).run();
  return c.json({ ok: true });
});

me.patch("/passkeys/:id", async (c) => {
  const u = await freshUser(c);
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as any);
  const name = str(body.name, 100);
  if (!name) return c.json({ error: "invalid_name", message: "Passkey name cannot be empty." }, 400);
  await c.env.DB.prepare(`UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?`).bind(name, id, u.id).run();
  return c.json({ ok: true });
});

// Tokens for the browser extension. Made and listed here, from a signed-in session; a token cannot reach these routes.
me.get("/extension-tokens", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT id, name, created_at, last_used_at FROM extension_tokens WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(c.get("user").id)
    .all<{ id: string; name: string; created_at: number; last_used_at: number | null }>();
  return c.json(rows.results);
});

me.post("/extension-tokens", async (c) => {
  const b = await c.req.json<{ name?: string }>().catch(() => ({}) as any);
  const name = str(b.name, 60) || "Browser extension";
  const userId = c.get("user").id;
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM extension_tokens WHERE user_id = ?`).bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_TOKENS) return c.json({ error: "too_many", message: `You can have ${MAX_TOKENS} tokens. Remove one you no longer use.` }, 400);
  const token = newToken();
  const id = await hashToken(token);
  const t = now();
  await c.env.DB.prepare(`INSERT INTO extension_tokens (id, user_id, name, created_at, last_used_at) VALUES (?, ?, ?, ?, NULL)`).bind(id, userId, name, t).run();
  // The token is in this answer and nowhere else: only its hash is kept.
  return c.json({ id, name, created_at: t, last_used_at: null, token });
});

me.delete("/extension-tokens/:id", async (c) => {
  const r = await c.env.DB.prepare(`DELETE FROM extension_tokens WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), c.get("user").id).run();
  if (!(r.meta?.changes ?? 0)) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

export default me;
