import type { Context } from "hono";
import type { AppEnv } from "../../env";
import type { UserRow } from "../../db";
import { now, toUser } from "../../db";
import { createSession } from "../../auth";
import { str } from "../../input";
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { getWebAuthnConfig, savePasskeyChallenge, consumePasskeyChallenge, decoyCredentialId, type PasskeyRow } from "../../passkeys";
import { MAX_EMAIL, clientIp, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from "./shared";

export async function handlePasskeyLoginOptions(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as any);
  const email = str(body.email, MAX_EMAIL).toLowerCase();
  const db = c.env.DB;
  const config = getWebAuthnConfig(c);

  let allowCredentials: { id: string; transports?: any[] }[] | undefined;
  let targetUser: UserRow | null = null;

  if (email) {
    targetUser = await db.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<UserRow>();
    if (targetUser) {
      const passkeys = await db
        .prepare(`SELECT * FROM passkeys WHERE user_id = ?`)
        .bind(targetUser.id)
        .all<PasskeyRow>();
      if (passkeys.results.length > 0) {
        allowCredentials = passkeys.results.map((p) => ({
          id: p.id,
          transports: JSON.parse(p.transports_json || "[]"),
        }));
      }
    }
    // An address with no passkey gets a credential list too, so the answer does not say which addresses have one. The id is a fixed function of the address.
    if (!allowCredentials) allowCredentials = [{ id: await decoyCredentialId(c.env, email), transports: [] }];
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: "preferred",
    allowCredentials,
  });

  await savePasskeyChallenge(db, options.challenge, "auth", targetUser?.id ?? null);
  return c.json(options);
}

export async function handlePasskeyLoginVerify(c: Context<AppEnv>) {
  const body = await c.req.json<{ response?: AuthenticationResponseJSON }>().catch(() => ({}) as any);
  const resp = body.response;
  if (!resp || typeof resp !== "object" || Array.isArray(resp) || typeof resp.id !== "string" || !resp.id || resp.id.length > 1024) {
    return c.json({ error: "invalid_response", message: "Missing passkey credential response." }, 400);
  }

  const db = c.env.DB;
  const config = getWebAuthnConfig(c);
  const ip = clientIp(c);
  const rateKeys = [`passkey:${resp.id}`, `ip:${ip}`];

  const limit = await checkLoginRateLimit(db, rateKeys);
  if (limit.locked) {
    const mins = Math.max(1, Math.ceil((limit.retryAfter ?? 60) / 60));
    return c.json(
      { error: "too_many_attempts", message: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      429,
      { "retry-after": String(limit.retryAfter ?? 60) }
    );
  }

  const passkey = await db.prepare(`SELECT * FROM passkeys WHERE id = ?`).bind(resp.id).first<PasskeyRow>();
  if (!passkey) {
    await recordFailedLogin(db, rateKeys);
    return c.json({ error: "passkey_not_found", message: "Passkey not recognized on this account." }, 401);
  }

  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(passkey.user_id).first<UserRow>();
  if (!user) {
    return c.json({ error: "user_not_found", message: "User account not found." }, 401);
  }

  if (user.disabled) {
    return c.json({ error: "account_disabled", message: "This account has been disabled." }, 403);
  }

  // Find and consume challenge from clientDataJSON
  let clientData: { challenge?: string } = {};
  try {
    const jsonStr = new TextDecoder().decode(isoBase64URL.toBuffer(resp.response.clientDataJSON));
    clientData = JSON.parse(jsonStr);
  } catch {
    return c.json({ error: "invalid_client_data", message: "Could not parse client data." }, 400);
  }

  const challenge = clientData.challenge;
  if (!challenge) return c.json({ error: "missing_challenge", message: "Challenge missing from client data." }, 400);

  const challengeCheck = await consumePasskeyChallenge(db, challenge, "auth");
  if (!challengeCheck.valid) {
    return c.json({ error: "challenge_expired", message: "Passkey session expired. Please try again." }, 400);
  }
  // A challenge that was issued for one person's address cannot be answered with someone else's passkey.
  if (challengeCheck.userId && challengeCheck.userId !== passkey.user_id) {
    await recordFailedLogin(db, rateKeys);
    return c.json({ error: "verification_failed", message: "Passkey could not be verified." }, 401);
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: resp,
      expectedChallenge: challenge,
      expectedOrigin: config.allowedOrigins,
      expectedRPID: config.rpID,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.public_key),
        counter: passkey.counter,
        transports: JSON.parse(passkey.transports_json || "[]"),
      },
      requireUserVerification: false,
    });
  } catch (err: any) {
    await recordFailedLogin(db, rateKeys);
    return c.json({ error: "verification_failed", message: err.message || "Passkey verification failed." }, 401);
  }

  if (!verification.verified) {
    await recordFailedLogin(db, rateKeys);
    return c.json({ error: "verification_failed", message: "Passkey could not be verified." }, 401);
  }

  await clearLoginAttempts(db, rateKeys);

  const t = now();
  const newCounter = verification.authenticationInfo.newCounter;
  await db.batch([
    db.prepare(`UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?`).bind(newCounter, t, passkey.id),
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(t, user.id),
  ]);

  await createSession(c, user.id);
  return c.json({ user: toUser(user) });
}
