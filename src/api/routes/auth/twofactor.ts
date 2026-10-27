import type { Context } from "hono";
import type { AppEnv } from "../../env";
import type { UserRow } from "../../db";
import { now, toUser } from "../../db";
import { createSession } from "../../auth";
import { str } from "../../input";
import { openSecret } from "../../secrets";
import { verifyTotpStep, matchRecoveryCode } from "../../totp";
import { MFA_MAX_ATTEMPTS, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from "./shared";

export async function handleTwoFactorLogin(c: Context<AppEnv>) {
  const db = c.env.DB;
  const body = await c.req.json<{ ticket?: string; code?: string }>().catch(() => ({}) as any);
  const t = now();
  const ticket = await db
    .prepare(`SELECT * FROM mfa_tickets WHERE id = ? AND expires_at > ?`)
    .bind(typeof body.ticket === "string" ? body.ticket : "", t)
    .first<{ id: string; user_id: string; attempts: number }>();
  if (!ticket) return c.json({ error: "mfa_ticket_expired" }, 401);
  if (ticket.attempts >= MFA_MAX_ATTEMPTS) {
    await db.prepare(`DELETE FROM mfa_tickets WHERE id = ?`).bind(ticket.id).run();
    return c.json({ error: "mfa_too_many_attempts" }, 429);
  }
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(ticket.user_id).first<UserRow>();
  if (!user?.totp_enabled || !user.totp_secret) return c.json({ error: "mfa_ticket_expired" }, 401);
  // A ticket allows a few guesses, but anyone who knows the password can ask for a new ticket, so the guesses are also counted per account.
  const mfaKey = `mfa:${user.id}`;
  const mfaLimit = await checkLoginRateLimit(db, [mfaKey]);
  if (mfaLimit.locked) {
    return c.json({ error: "too_many_attempts", message: "Too many wrong codes. Try again later." }, 429, { "retry-after": String(mfaLimit.retryAfter ?? 60) });
  }
  // The guess is counted before it is checked, in one statement: guesses that arrive together cannot each see the same count and all be tried.
  const slot = await db.prepare(`UPDATE mfa_tickets SET attempts = attempts + 1 WHERE id = ? AND attempts < ? RETURNING attempts`).bind(ticket.id, MFA_MAX_ATTEMPTS).first<{ attempts: number }>();
  if (!slot) {
    await db.prepare(`DELETE FROM mfa_tickets WHERE id = ?`).bind(ticket.id).run();
    return c.json({ error: "mfa_too_many_attempts" }, 429);
  }
  const code = str(body.code, 64);
  const totpSecret = await openSecret(c.env, user.totp_secret);
  const matchedStep = await verifyTotpStep(totpSecret, code, t, user.last_totp_step);
  let ok = matchedStep !== null;
  if (!ok) {
    const list = JSON.parse(user.recovery_codes_json || "[]") as string[];
    const idx = await matchRecoveryCode(code, list);
    if (idx >= 0) {
      list.splice(idx, 1);
      await db.prepare(`UPDATE users SET recovery_codes_json = ? WHERE id = ?`).bind(JSON.stringify(list), user.id).run();
      ok = true;
    }
  }
  if (!ok) {
    await recordFailedLogin(db, [mfaKey]);
    return c.json({ error: "invalid_code", attempts_left: MFA_MAX_ATTEMPTS - slot.attempts }, 401);
  }
  await clearLoginAttempts(db, [mfaKey]);
  await db.batch([
    db.prepare(`DELETE FROM mfa_tickets WHERE id = ?`).bind(ticket.id),
    db.prepare(`UPDATE users SET last_login_at = ?, last_totp_step = COALESCE(?, last_totp_step) WHERE id = ?`).bind(t, matchedStep, user.id),
  ]);
  await createSession(c, user.id);
  return c.json({ user: toUser(user) });
}
