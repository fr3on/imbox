import type { Env } from "./env";
import { openToken, sealToken } from "./secrets";
import type { AccountRow } from "./db";
import { now } from "./db";
import { resolveCreds } from "./oauth";
import { fetchTimeout, TIMEOUT } from "./http";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me/";
/**
 * `/common` is what makes both personal Outlook.com accounts and Microsoft 365 work/school
 * accounts sign in through the same client. `/consumers` would drop work accounts, `/organizations`
 * would drop personal ones.
 */
const MS_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

/** The one scope that decides whether an account can sync mail at all. */
export const MS_MAIL_SCOPE = "Mail.ReadWrite";
/** Enough to identify who just signed in, plus a refresh token. */
const MS_IDENTITY_SCOPES = ["openid", "email", "profile", "offline_access"];
const MS_SCOPES = [MS_MAIL_SCOPE, "Mail.Send", "User.Read", ...MS_IDENTITY_SCOPES];

export class MicrosoftError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `Microsoft Graph error ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

export async function microsoftConfigured(env: Env): Promise<boolean> {
  return (await resolveCreds(env, "microsoft")).source !== "none";
}

/**
 * True when this account can sync mail. Microsoft echoes scopes back resource-qualified
 * (`https://graph.microsoft.com/Mail.ReadWrite`), so this is a substring test rather than the
 * exact-token split `hasMailScope` does for Google. An empty `scopes` counts as mail for the same
 * reason it does there: nothing but a mail connect ever wrote an `outlook` row.
 */
export function hasMsMailScope(scopes: string | null | undefined): boolean {
  const s = (scopes ?? "").trim();
  return s === "" || s.includes(MS_MAIL_SCOPE);
}

/** The same test as `hasMsMailScope`, as a SQL predicate over an `accounts` row. Keep the two in step. */
export const MS_MAIL_SCOPE_SQL = `(scopes IS NULL OR scopes = '' OR scopes ILIKE '%Mail.ReadWrite%')`;

export async function msAuthUrl(env: Env, state: string, redirectUri: string, loginHint?: string): Promise<string> {
  const { clientId } = await resolveCreds(env, "microsoft");
  const u = new URL(`${MS_AUTHORITY}/authorize`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", MS_SCOPES.join(" "));
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("state", state);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

export interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
  token_type?: string;
}

export async function exchangeMsCode(env: Env, code: string, redirectUri: string): Promise<MsTokenResponse> {
  const creds = await resolveCreds(env, "microsoft");
  const res = await fetchTimeout(
    `${MS_AUTHORITY}/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
    TIMEOUT.token
  );
  const body = await res.text();
  if (!res.ok) throw new MicrosoftError(res.status, body, `Token exchange failed: ${body.slice(0, 300)}`);
  return JSON.parse(body) as MsTokenResponse;
}

/**
 * Who just signed in. Personal accounts often leave `mail` null and carry the address in
 * `userPrincipalName`; work accounts populate both.
 */
export async function fetchMsUserInfo(accessToken: string): Promise<{ email: string; name: string }> {
  const res = await fetchTimeout(`${GRAPH_BASE}?$select=id,mail,userPrincipalName,displayName`, { headers: { authorization: `Bearer ${accessToken}` } }, TIMEOUT.api);
  if (!res.ok) throw new MicrosoftError(res.status, await res.text(), "Graph /me failed");
  const j = (await res.json()) as { mail?: string | null; userPrincipalName?: string; displayName?: string };
  const email = (j.mail || j.userPrincipalName || "").toLowerCase();
  if (!email) throw new MicrosoftError(500, JSON.stringify(j), "Graph /me returned no address");
  return { email, name: j.displayName ?? "" };
}

async function markDisconnected(env: Env, account: AccountRow, reason: string) {
  account.sync_status = "disconnected";
  account.sync_error = reason;
  await env.DB.prepare(`UPDATE accounts SET sync_status = 'disconnected', sync_error = ? WHERE id = ?`).bind(reason, account.id).run();
}

async function refreshMsAccessToken(env: Env, account: AccountRow): Promise<string> {
  if (account.provider !== "outlook") throw new MicrosoftError(400, "not_outlook", "Not an Outlook account");
  if (!account.refresh_token) {
    await markDisconnected(env, account, "No refresh token; please reconnect the account.");
    throw new MicrosoftError(401, "no_refresh_token", "Account disconnected: no refresh token");
  }
  const creds = await resolveCreds(env, "microsoft");
  const res = await fetchTimeout(
    `${MS_AUTHORITY}/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: await openToken(env, account.refresh_token),
        grant_type: "refresh_token",
        scope: MS_SCOPES.join(" "),
      }),
    },
    TIMEOUT.token
  );
  const body = await res.text();
  if (!res.ok) {
    if (/invalid_grant|AADSTS700082|AADSTS50173/i.test(body)) {
      await markDisconnected(env, account, "Microsoft revoked access. Please reconnect.");
    }
    throw new MicrosoftError(res.status, body, `Token refresh failed: ${body.slice(0, 200)}`);
  }
  const j = JSON.parse(body) as MsTokenResponse;
  account.access_token = j.access_token;
  account.token_expires_at = now() + (j.expires_in ?? 3600) * 1000;
  // Unlike Google, Microsoft *rotates* refresh tokens: the old one stops working once a refresh
  // returns a new one, so failing to persist it here would disconnect the account within the hour.
  if (j.refresh_token) account.refresh_token = j.refresh_token;
  await env.DB.prepare(`UPDATE accounts SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?`)
    .bind(await sealToken(env, account.access_token), await sealToken(env, account.refresh_token), account.token_expires_at, account.id)
    .run();
  return j.access_token;
}

export async function getMsAccessToken(env: Env, account: AccountRow, force = false): Promise<string> {
  if (!force && account.access_token && account.token_expires_at && account.token_expires_at - now() > 60_000) {
    return openToken(env, account.access_token);
  }
  return refreshMsAccessToken(env, account);
}

/** Fetch against Microsoft Graph. `path` is relative to /v1.0/me/ (or absolute). */
export async function graphFetch(env: Env, account: AccountRow, path: string, init: RequestInit = {}, timeoutMs: number = TIMEOUT.api): Promise<Response> {
  if (account.provider !== "outlook") throw new MicrosoftError(400, "not_outlook", "Not an Outlook account");
  const url = /^https?:/i.test(path) ? path : GRAPH_BASE + path;
  let token = await getMsAccessToken(env, account);
  const doFetch = (t: string) =>
    fetchTimeout(
      url,
      {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${t}` },
      },
      timeoutMs
    );
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await getMsAccessToken(env, account, true);
    res = await doFetch(token);
  }
  return res;
}

export async function graphJson<T = any>(env: Env, account: AccountRow, path: string, init: RequestInit = {}): Promise<T> {
  const res = await graphFetch(env, account, path, init);
  const text = await res.text();
  if (!res.ok) throw new MicrosoftError(res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

/** The largest message sync will take in. The same ceiling the IMAP path uses: a worker has about 128 MB, and a message is held more than once while it is parsed. */
export const MAX_RAW_MESSAGE_BYTES = 30 * 1024 * 1024;

/** A message over the size limit. Sync skips it (it stays in the mailbox) rather than failing, so it cannot hold the mailbox's cursor back for ever. */
export class MessageTooLarge extends Error {
  constructor(readonly bytes: number) {
    super(`message_too_large: ${(bytes / 1048576).toFixed(1)} MB`);
  }
}

/**
 * Raw body, for `messages/{id}/$value` which returns RFC822 rather than JSON. Read as a stream and abandoned as soon as it passes `maxBytes`,
 * so one huge message is never held whole in memory just to find out it is too big.
 */
export async function graphRaw(env: Env, account: AccountRow, path: string, maxBytes: number = MAX_RAW_MESSAGE_BYTES): Promise<string> {
  const res = await graphFetch(env, account, path, {}, TIMEOUT.raw);
  if (!res.ok) throw new MicrosoftError(res.status, await res.text());
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    void res.body?.cancel().catch(() => {});
    throw new MessageTooLarge(declared);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new MessageTooLarge(total);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(out);
}
