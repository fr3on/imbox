import type { Context } from "hono";
import { sealToken } from "../../secrets";
import type { AppEnv } from "../../env";
import type { UserRow, AccountRow } from "../../db";
import { uid, now } from "../../db";
import { getSessionUser } from "../../auth";
import { googleAuthUrl, googleConfigured, exchangeCode, fetchUserInfo, type GoogleScopeMode } from "../../google";
import { ensureDefaultCalendars } from "../../calendar/sources";
import { HANDOFF_PREFIX, consumeOauthState, redirectUriFor, scopeModeForState, statePrefixFor, handoffPage } from "./shared";

export async function handleGoogleStart(c: Context<AppEnv>) {
  const user = await getSessionUser(c);
  if (!user) return c.redirect("/login?next=/settings/accounts");
  if (!(await googleConfigured(c.env))) {
    return c.json({ error: "google_not_configured", message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets." }, 500);
  }
  const mode: GoogleScopeMode = c.req.query("calendar_only") === "1" ? "calendar" : c.req.query("calendar") === "1" ? "mail+calendar" : "mail";
  const state = statePrefixFor(mode) + uid();
  await c.env.DB.prepare(`INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)`).bind(state, user.id, now()).run();
  // Prune old states opportunistically.
  c.executionCtx.waitUntil(c.env.DB.prepare(`DELETE FROM oauth_states WHERE created_at < ?`).bind(now() - 3600_000).run());
  const hint = c.req.query("login_hint") ?? undefined;
  return c.redirect(await googleAuthUrl(c.env, state, redirectUriFor(c), hint, mode));
}

/**
 * Unauthenticated entry point for the Mac app: the app (which *is* signed in) mints a state through
 * `POST /api/accounts/connect-link`, then opens this URL in the system browser, which has no session.
 * The state row identifies the user, so no cookie is needed here.
 */
export async function handleGoogleHandoff(c: Context<AppEnv>) {
  const state = c.req.query("state") ?? "";
  if (!(await googleConfigured(c.env))) {
    return c.json({ error: "google_not_configured", message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets." }, 500);
  }
  if (!state.startsWith(HANDOFF_PREFIX)) return c.json({ error: "invalid_state" }, 400);
  const st = await c.env.DB.prepare(`SELECT state FROM oauth_states WHERE state = ? AND created_at > ?`).bind(state, now() - 3600_000).first<{ state: string }>();
  if (!st) return c.json({ error: "invalid_state" }, 400);
  const hint = c.req.query("login_hint") ?? undefined;
  return c.redirect(await googleAuthUrl(c.env, state, redirectUriFor(c), hint, scopeModeForState(state)));
}

export async function handleGoogleCallback(c: Context<AppEnv>) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const err = c.req.query("error");
  if (err) {
    if ((c.req.query("state") ?? "").startsWith(HANDOFF_PREFIX)) {
      return c.html(handoffPage("Not connected", "Google reported: " + err + ". You can close this tab and try again from Imbox."), 200);
    }
    return c.redirect(`/?connect_error=${encodeURIComponent(err)}`);
  }
  if (!code || !state) return c.json({ error: "missing_code_or_state" }, 400);
  const db = c.env.DB;
  const handoff = state.startsWith(HANDOFF_PREFIX);
  const st = await consumeOauthState(db, state);
  if (!st) return c.json({ error: "invalid_state" }, 400);
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(st.user_id).first<UserRow>();
  if (!user) return c.json({ error: "unauthorized" }, 401);

  try {
    const tok = await exchangeCode(c.env, code, redirectUriFor(c));
    const info = await fetchUserInfo(tok.access_token);
    if (!info.email) return c.json({ error: "no_email_from_google" }, 400);
    const expiresAt = now() + (tok.expires_in ?? 3600) * 1000;
    const existing = await db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND email = ?`).bind(user.id, info.email).first<AccountRow>();
    let accountId: string;
    if (existing) {
      accountId = existing.id;
      await db
        .prepare(
          `UPDATE accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, scopes = ?, sync_status = 'idle', sync_error = NULL, display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END, avatar_url = CASE WHEN ? <> '' THEN ? ELSE avatar_url END, photos_synced_at = NULL WHERE id = ?`
        )
        .bind(await sealToken(c.env, tok.access_token), await sealToken(c.env, tok.refresh_token), expiresAt, tok.scope ?? '', info.name, info.picture, info.picture, existing.id)
        .run();
    } else {
      accountId = uid();
      await db
        .prepare(
          `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, scopes, history_id, initial_sync_done, initial_sync_page_token, initial_sync_count, sync_status, sync_error, last_synced_at, signature, cover_art, avatar_url, created_at)
           VALUES (?, ?, 'gmail', ?, ?, ?, ?, ?, ?, NULL, 0, NULL, 0, 'idle', NULL, NULL, '', '', ?, ?)`
        )
        .bind(accountId, user.id, info.email, info.name, await sealToken(c.env, tok.access_token), await sealToken(c.env, tok.refresh_token), expiresAt, tok.scope ?? '', info.picture, now())
        .run();
    }
    // Kick off the first sync chunk in the background. `syncAccount` skips an account whose token
    // carries no mail scope, so a calendar-only connect never starts a Gmail sync it cannot finish.
    const account = await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(accountId).first<AccountRow>();
    if (account) {
      const { syncAccount } = await import("../../sync");
      c.executionCtx.waitUntil(syncAccount(c.env, account));
      c.executionCtx.waitUntil(ensureDefaultCalendars(c.env, user.id, account).catch(() => {}));
    }
    if (handoff) {
      const what = scopeModeForState(state) === "calendar" ? "calendar is now syncing" : "is now syncing";
      return c.html(handoffPage("Connected", `${info.email} ${what}. You can close this tab and go back to Imbox.`), 200);
    }
    return c.redirect(`/?connected=1&account=${accountId}`);
  } catch (e) {
    const msg = ((e as Error).message ?? "oauth_failed").slice(0, 200);
    if (handoff) return c.html(handoffPage("Not connected", `${msg}. You can close this tab and try again from Imbox.`), 200);
    return c.redirect(`/?connect_error=${encodeURIComponent(msg)}`);
  }
}
