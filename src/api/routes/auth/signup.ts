import type { Context } from "hono";
import type { AppEnv } from "../../env";
import type { UserRow } from "../../db";
import { uid, now, toUser } from "../../db";
import { hashPassword, createSession } from "../../auth";
import { str } from "../../input";
import { sanitizeBrand } from "../../../shared/brand";
import { googleConfigured } from "../../google";
import { microsoftConfigured } from "../../microsoft";
import { EMAIL_RE, MAX_EMAIL, MAX_PASSWORD_LENGTH, SIGNUP_LOCK, userCount } from "./shared";

// Single-owner instance: /auth/status tells the client whether first-run setup is still needed.
export async function handleStatus(c: Context<AppEnv>) {
  const n = await userCount(c.env.DB);
  return c.json({
    setup_required: n === 0,
    google_configured: await googleConfigured(c.env),
    microsoft_configured: await microsoftConfigured(c.env),
    app_name: sanitizeBrand(c.env.APP_NAME),
  });
}

// Sign-up: creates the sole owner. Closed for good once a user exists. `/setup` is the old name and still answers.
export async function handleSignup(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string; name?: string; password?: string }>().catch(() => ({}) as any);
  const email = str(body.email, MAX_EMAIL).toLowerCase();
  const name = str(body.name, 100);
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL_RE.test(email)) return c.json({ error: "invalid_email", message: "That doesn't look like an email address." }, 400);
  if (password.length < 8) return c.json({ error: "password_too_short", message: "Use at least 8 characters for the password." }, 400);
  if (password.length > MAX_PASSWORD_LENGTH) return c.json({ error: "password_too_long", message: "That password is too long." }, 400);
  const db = c.env.DB;
  const closed = () => c.json({ error: "setup_done", message: "This inbox already has an owner. Sign in instead." }, 403);
  if ((await userCount(db)) > 0) return closed();

  const user: UserRow = {
    id: uid(),
    email,
    name: name || email.split("@")[0],
    password_hash: await hashPassword(password),
    role: "owner",
    disabled: 0,
    settings_json: "{}",
    detected_timezone: "",
    created_at: now(),
    last_login_at: now(),
    totp_secret: null,
    totp_enabled: 0,
    recovery_codes_json: "[]",
    last_totp_step: null,
  };
  // A condition inside one INSERT is not enough: two of them at the same moment both see no users. The lock makes the second wait for the
  // first to commit, and the insert after it (a new statement, so a new view of the table) then finds the owner and adds nothing.
  const [, made] = await db.batch([
    db.prepare(`SELECT pg_advisory_xact_lock(?)`).bind(SIGNUP_LOCK),
    db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, disabled, settings_json, created_at, last_login_at)
         SELECT CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), CAST(? AS TEXT), 0, '{}', CAST(? AS BIGINT), CAST(? AS BIGINT)
         WHERE NOT EXISTS (SELECT 1 FROM users)`
      )
      .bind(user.id, user.email, user.name, user.password_hash, user.role, user.created_at, user.last_login_at),
  ]);
  if (!made.meta.changes) return closed();
  await createSession(c, user.id);
  return c.json({ user: toUser(user) });
}
