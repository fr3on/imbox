import type { Context } from "hono";
import type { AppEnv } from "../../env";
import type { UserRow } from "../../db";
import { uid, now, toUser } from "../../db";
import { verifyPassword, decoyPasswordHash, createSession, destroySession } from "../../auth";
import { str } from "../../input";
import { MAX_EMAIL, MAX_PASSWORD_LENGTH, clientIp, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } from "./shared";

export async function handleLogin(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as any);
  const email = str(body.email, MAX_EMAIL).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const ip = clientIp(c);
  const rateKeys = [email ? `email:${email}` : "", `ip:${ip}`].filter(Boolean);

  const limit = await checkLoginRateLimit(c.env.DB, rateKeys);
  if (limit.locked) {
    const mins = Math.max(1, Math.ceil((limit.retryAfter ?? 60) / 60));
    return c.json(
      { error: "too_many_attempts", message: `Too many failed login attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
      429,
      { "retry-after": String(limit.retryAfter ?? 60) }
    );
  }

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email).first<UserRow>();
  // An address with no account is checked against a decoy hash, so the answer takes as long either way and does not say which addresses exist.
  const valid = password.length <= MAX_PASSWORD_LENGTH && (await verifyPassword(password, user ? user.password_hash : await decoyPasswordHash())) && !!user;

  if (!user || !valid) {
    const fail = await recordFailedLogin(c.env.DB, rateKeys);
    if (fail.locked) {
      const mins = Math.max(1, Math.ceil((fail.retryAfter ?? 60) / 60));
      return c.json(
        { error: "too_many_attempts", message: `Too many failed login attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` },
        429,
        { "retry-after": String(fail.retryAfter ?? 60) }
      );
    }
    return c.json({ error: "invalid_credentials", message: "Invalid email or password.", attempts_left: fail.attemptsLeft }, 401);
  }

  if (user.disabled) {
    return c.json({ error: "account_disabled", message: "This account has been disabled." }, 403);
  }

  await clearLoginAttempts(c.env.DB, rateKeys);

  if (user.totp_enabled) {
    // Second factor required: hand out a short-lived ticket instead of a session.
    const t = now();
    const ticket = uid() + uid().replace(/-/g, "");
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM mfa_tickets WHERE expires_at < ?`).bind(t),
      c.env.DB.prepare(`INSERT INTO mfa_tickets (id, user_id, attempts, created_at, expires_at) VALUES (?, ?, 0, ?, ?)`).bind(ticket, user.id, t, t + 5 * 60_000),
    ]);
    return c.json({ mfa_required: true, ticket });
  }
  await c.env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(now(), user.id).run();
  await createSession(c, user.id);
  return c.json({ user: toUser(user) });
}

export async function handleLogout(c: Context<AppEnv>) {
  await destroySession(c);
  return c.json({ ok: true });
}
