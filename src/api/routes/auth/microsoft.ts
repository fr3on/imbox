import type { Context } from "hono";
import { sealToken } from "../../secrets";
import type { AppEnv } from "../../env";
import type { UserRow, AccountRow } from "../../db";
import { uid, now } from "../../db";
import { getSessionUser } from "../../auth";
import { msAuthUrl, microsoftConfigured, exchangeMsCode, fetchMsUserInfo } from "../../microsoft";
import { HANDOFF_PREFIX, consumeOauthState, msRedirectUriFor, handoffPage } from "./shared";

export async function handleMicrosoftStart(c: Context<AppEnv>) {
  const user = await getSessionUser(c);
  if (!user) return c.redirect("/login?next=/settings/accounts");
  if (!(await microsoftConfigured(c.env))) {
    return c.json({ error: "microsoft_not_configured", message: "Set MS_CLIENT_ID and MS_CLIENT_SECRET secrets." }, 500);
  }
  const state = uid();
  await c.env.DB.prepare(`INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)`).bind(state, user.id, now()).run();
  c.executionCtx.waitUntil(c.env.DB.prepare(`DELETE FROM oauth_states WHERE created_at < ?`).bind(now() - 3600_000).run());
  const hint = c.req.query("login_hint") ?? undefined;
  return c.redirect(await msAuthUrl(c.env, state, msRedirectUriFor(c), hint));
}

/**
 * The system-browser half of a native connect, mirroring `/google/handoff`. The app cannot send its
 * session cookie to the browser, so it asks the server for this one-time link instead.
 */
export async function handleMicrosoftHandoff(c: Context<AppEnv>) {
  const state = c.req.query("state") ?? "";
  if (!(await microsoftConfigured(c.env))) {
    return c.json({ error: "microsoft_not_configured", message: "Set MS_CLIENT_ID and MS_CLIENT_SECRET secrets." }, 500);
  }
  if (!state.startsWith(HANDOFF_PREFIX)) return c.json({ error: "invalid_state" }, 400);
  const st = await c.env.DB.prepare(`SELECT state FROM oauth_states WHERE state = ? AND created_at > ?`).bind(state, now() - 3600_000).first<{ state: string }>();
  if (!st) return c.json({ error: "invalid_state" }, 400);
  const hint = c.req.query("login_hint") ?? undefined;
  return c.redirect(await msAuthUrl(c.env, state, msRedirectUriFor(c), hint));
}

export async function handleMicrosoftCallback(c: Context<AppEnv>) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const err = c.req.query("error");
  const handoff = (state ?? "").startsWith(HANDOFF_PREFIX);
  if (err) {
    const desc = c.req.query("error_description") ?? err;
    if (handoff) return c.html(handoffPage("Not connected", `Microsoft reported: ${desc.slice(0, 200)}. You can close this tab and try again from Imbox.`), 200);
    return c.redirect(`/?connect_error=${encodeURIComponent(desc.slice(0, 200))}`);
  }
  if (!code || !state) return c.json({ error: "missing_code_or_state" }, 400);
  const db = c.env.DB;
  const st = await consumeOauthState(db, state);
  if (!st) return c.json({ error: "invalid_state" }, 400);
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(st.user_id).first<UserRow>();
  if (!user) return c.json({ error: "unauthorized" }, 401);

  try {
    const tok = await exchangeMsCode(c.env, code, msRedirectUriFor(c));
    const info = await fetchMsUserInfo(tok.access_token);
    const expiresAt = now() + (tok.expires_in ?? 3600) * 1000;
    const existing = await db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND email = ?`).bind(user.id, info.email).first<AccountRow>();
    let accountId: string;
    if (existing) {
      accountId = existing.id;
      await db
        .prepare(
          `UPDATE accounts SET provider = 'outlook', access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, scopes = ?, sync_status = 'idle', sync_error = NULL, display_name = CASE WHEN display_name = '' THEN ? ELSE display_name END WHERE id = ?`
        )
        .bind(await sealToken(c.env, tok.access_token), await sealToken(c.env, tok.refresh_token), expiresAt, tok.scope ?? "", info.name, existing.id)
        .run();
    } else {
      accountId = uid();
      await db
        .prepare(
          `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, scopes, history_id, delta_link, initial_sync_done, initial_sync_page_token, initial_sync_count, sync_status, sync_error, last_synced_at, signature, cover_art, avatar_url, created_at)
           VALUES (?, ?, 'outlook', ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, 0, 'idle', NULL, NULL, '', '', '', ?)`
        )
        .bind(accountId, user.id, info.email, info.name, await sealToken(c.env, tok.access_token), await sealToken(c.env, tok.refresh_token), expiresAt, tok.scope ?? "", now())
        .run();
    }
    // The first pass only records where the inbox is now — nothing historical is imported, matching
    // what connecting Gmail does.
    const account = await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(accountId).first<AccountRow>();
    if (account) {
      const { syncAccount } = await import("../../sync");
      c.executionCtx.waitUntil(syncAccount(c.env, account));
    }
    if (handoff) {
      return c.html(handoffPage("Connected", `${info.email} is now syncing. You can close this tab and go back to Imbox.`), 200);
    }
    return c.redirect(`/?connected=1&account=${accountId}`);
  } catch (e) {
    const msg = ((e as Error).message ?? "oauth_failed").slice(0, 200);
    if (handoff) return c.html(handoffPage("Not connected", `${msg}. You can close this tab and try again from Imbox.`), 200);
    return c.redirect(`/?connect_error=${encodeURIComponent(msg)}`);
  }
}
