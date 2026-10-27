import { Hono, type Context } from "hono";
import { fetchTimeout, TIMEOUT } from "../http";
import type { AppEnv } from "../env";
import type { AccountRow } from "../db";
import { isUniqueViolation, toAccount } from "../db";
import { syncAccount } from "../sync";
import { syncContactPhotos } from "../people";
import { deleteAccountData } from "./domains";
import { appOrigin, HANDOFF_PREFIX, CAL_PREFIX } from "./auth";
import { googleConfigured, hasMailScope } from "../google";
import { openToken } from "../secrets";
import { hasMsMailScope, microsoftConfigured } from "../microsoft";
import { configFor, normalizePassword, explainConnectionError, verifyBoth, encryptPassword, passwordHint, loadImapRow, insertImapAccount, clampImport, queueResync, clampResync, RESYNC_ALL } from "../imapbox";
import type { ImapSecurity } from "../imap";
import type { SmtpSecurity } from "../smtp";
import { accountsWithAgentFlag, uid, now } from "../db";
import { str } from "../input";

const accounts = new Hono<AppEnv>();

async function ownAccount(c: Context<AppEnv>, id: string): Promise<AccountRow | null> {
  const user = c.get("user");
  return (await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).bind(id, user.id).first<AccountRow>()) ?? null;
}

accounts.get("/", async (c) => {
  const user = c.get("user");
  const rows = await accountsWithAgentFlag(c.env.DB, user.id);
  // How far along a long re-sync is, for the mailboxes that have one running.
  const imports = await c.env.DB.prepare(`SELECT i.account_id, i.backlog, i.import_total FROM imap_accounts i JOIN accounts a ON a.id = i.account_id WHERE a.user_id = ? AND i.backlog > 0`)
    .bind(user.id)
    .all<{ account_id: string; backlog: number; import_total: number }>();
  const importing = new Map(imports.results.map((r) => [r.account_id, r]));
  return c.json(
    rows.map((a) => {
      const imp = importing.get(a.id);
      return { ...toAccount(a), ...(a.is_agent ? { is_agent: true } : {}), ...(imp ? { import_remaining: imp.backlog, import_total: Math.max(imp.import_total, imp.backlog) } : {}) };
    })
  );
});

accounts.patch("/:id", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ signature?: string; cover_art?: string; display_name?: string }>().catch(() => ({}) as any);
  const signature = typeof body.signature === "string" ? body.signature.slice(0, 20_000) : acc.signature;
  const cover = typeof body.cover_art === "string" ? body.cover_art.slice(0, 2000) : acc.cover_art;
  const dn = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 100) : acc.display_name;
  await c.env.DB.prepare(`UPDATE accounts SET signature = ?, cover_art = ?, display_name = ? WHERE id = ?`).bind(signature, cover, dn, acc.id).run();
  const fresh = await ownAccount(c, acc.id);
  return c.json(toAccount(fresh!));
});

accounts.delete("/:id", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  // Explicit cleanup, not left to the foreign keys.
  await deleteAccountData(c.env.DB, acc.id);
  // Best-effort token revocation. Google-only: Microsoft has no equivalent revoke endpoint for a
  // delegated refresh token, and posting one to Google's would leak it to the wrong provider.
  if (acc.provider === "gmail" && acc.refresh_token) {
    const refreshToken = await openToken(c.env, acc.refresh_token);
    c.executionCtx.waitUntil(
      fetchTimeout(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }, TIMEOUT.token).catch(() => {})
    );
  }
  return c.json({ ok: true });
});

/** Sync one mailbox for someone waiting on the answer. A mailbox with no mail to fetch (a domain mailbox, or one connected for the calendar only) is a success. */
async function syncNow(c: Context<AppEnv>, acc: AccountRow) {
  if (acc.provider === "domain") return { ok: true, added: 0, status: "ok", account: toAccount(acc) };
  const scoped = acc.provider === "imap" ? true : acc.provider === "outlook" ? hasMsMailScope(acc.scopes) : hasMailScope(acc.scopes);
  if (!scoped) return { ok: true, added: 0, status: "ok", account: toAccount(acc) };
  // Someone is waiting for this answer, so it gets a short budget; anything left over is picked up by the once-a-minute job.
  const r = await syncAccount(c.env, acc, { budgetMs: 8000, force: true });
  const fresh = await ownAccount(c, acc.id);
  return { ok: r.status === "ok", added: r.added, status: r.status, account: toAccount(fresh!) };
}

accounts.post("/:id/sync", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  return c.json(await syncNow(c, acc));
});

/** How many mailboxes one request syncs at a time: enough to be quick, few enough not to open a connection for every mailbox at once. */
const SYNC_CONCURRENCY = 6;

// Sync many mailboxes in one request instead of one request each. `ids` names the mailboxes; without it, every one that is connected and polled.
accounts.post("/sync", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({}) as { ids?: unknown });
  const wanted = Array.isArray(body.ids) ? new Set(body.ids.filter((x): x is string => typeof x === "string").slice(0, 200)) : null;
  const rows = (await c.env.DB.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC`).bind(user.id).all<AccountRow>()).results;
  const targets = rows.filter((a) => (wanted ? wanted.has(a.id) : a.provider !== "domain" && a.sync_status !== "disconnected"));

  const results: { id: string; ok: boolean; added: number; status: string }[] = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const i = next++;
      const acc = targets[i];
      try {
        const r = await syncNow(c, acc);
        results[i] = { id: acc.id, ok: r.ok, added: r.added, status: r.status };
      } catch (e) {
        console.error("sync failed", acc.id, e);
        results[i] = { id: acc.id, ok: false, added: 0, status: "error" };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SYNC_CONCURRENCY, targets.length) }, worker));
  return c.json({ ok: results.every((r) => r.ok), added: results.reduce((n, r) => n + r.added, 0), results });
});

// "Start fresh": wipe everything synced for this account and watch for new mail from now on.
accounts.post("/:id/reset", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  await deleteAccountData(c.env.DB, acc.id, { keepAccount: true });
  await c.env.DB.prepare(
    `UPDATE accounts SET initial_sync_done = 0, initial_sync_count = 0, initial_sync_page_token = NULL, history_id = NULL,
       delta_link = NULL, sync_status = 'idle', sync_error = NULL, photos_synced_at = NULL WHERE id = ?`
  )
    .bind(acc.id)
    .run();
  let syncError: string | null = null;
  if (acc.provider === "imap") {
    await c.env.DB.prepare(`UPDATE imap_accounts SET uid_validity = 0, last_uid = 0 WHERE account_id = ?`).bind(acc.id).run();
  }
  const canResync =
    acc.provider === "gmail" ? hasMailScope(acc.scopes) : acc.provider === "outlook" ? hasMsMailScope(acc.scopes) : acc.provider === "imap";
  if (canResync) {
    const fresh = await ownAccount(c, acc.id);
    const r = await syncAccount(c.env, fresh!, { budgetMs: 8000, force: true });
    if (r.status !== "ok") syncError = (await ownAccount(c, acc.id))?.sync_error ?? r.status;
  }
  const after = await ownAccount(c, acc.id);
  return c.json({ ok: true, account: toAccount(after!), sync_error: syncError });
});

// Force a Google People photo sync now.
accounts.post("/:id/sync-photos", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  if (acc.provider !== "gmail") return c.json({ ok: true, updated: 0 });
  try {
    const r = await syncContactPhotos(c.env, acc);
    const fresh = await ownAccount(c, acc.id);
    return c.json({ ok: true, updated: r.updated, account: toAccount(fresh!) });
  } catch (e) {
    return c.json({ error: "photos_failed", message: (e as Error).message?.slice(0, 300) }, 502);
  }
});

// Recent sync activity for one of the owner's accounts.
accounts.get("/:id/logs", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DB.prepare(`SELECT id, account_id, level, message, created_at FROM sync_log WHERE account_id = ? ORDER BY created_at DESC LIMIT 200`).bind(acc.id).all();
  return c.json(rows.results);
});

/**
 * Mints a one-time link that starts a provider's consent flow in the *system browser*. The native
 * apps call this (they hold the session), then open the URL outside the webview — Google refuses to
 * sign people in inside embedded web views, and Microsoft blocks it under some Conditional Access
 * policies, so both go the same way rather than guessing which webview will be accepted.
 */
accounts.post("/connect-link", async (c) => {
  const user = c.get("user");
  const body = await c.req
    .json<{ login_hint?: string; calendar?: boolean; provider?: string }>()
    .catch(() => ({}) as { login_hint?: string; calendar?: boolean; provider?: string });
  const provider = body.provider === "microsoft" ? "microsoft" : "google";
  if (provider === "microsoft") {
    if (!(await microsoftConfigured(c.env))) return c.json({ error: "microsoft_not_configured", message: "Set MS_CLIENT_ID and MS_CLIENT_SECRET secrets." }, 500);
  } else if (!(await googleConfigured(c.env))) {
    return c.json({ error: "google_not_configured", message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets." }, 500);
  }
  const state = `${HANDOFF_PREFIX}${provider === "google" && body.calendar ? CAL_PREFIX : ""}${uid()}`;
  await c.env.DB.prepare(`INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)`).bind(state, user.id, now()).run();
  c.executionCtx.waitUntil(c.env.DB.prepare(`DELETE FROM oauth_states WHERE created_at < ?`).bind(now() - 3600_000).run());
  const hint = str(body.login_hint, 320);
  const url = `${appOrigin(c)}/auth/${provider}/handoff?state=${encodeURIComponent(state)}${hint ? `&login_hint=${encodeURIComponent(hint)}` : ""}`;
  return c.json({ url });
});

// ---------- Third-party IMAP/SMTP mailboxes ----------

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

interface ImapBody {
  email?: string;
  display_name?: string;
  imap_host?: string;
  imap_port?: number;
  imap_security?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: string;
  username?: string;
  password?: string | null;
  folder?: string;
  /** Newest messages to import on the first sync. */
  import_recent?: number;
}

function sec(v: unknown, fallback: "tls" | "starttls"): ImapSecurity & SmtpSecurity {
  return v === "starttls" || v === "tls" ? v : fallback;
}

function validPort(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n < 65536;
}

/** The longest a host name, address or folder name can be; past this a field is not one of them, and it is about to be dialled or stored. */
function oversize(c: { email?: string; username?: string; imap_host?: string; smtp_host?: string; folder?: string }): boolean {
  return (c.email?.length ?? 0) > 254 || (c.username?.length ?? 0) > 320 || (c.imap_host?.length ?? 0) > 255 || (c.smtp_host?.length ?? 0) > 255 || (c.folder?.length ?? 0) > 255;
}

/** Shape a request body into a config, without touching the database. */
function readBody(b: ImapBody) {
  const email = String(b.email ?? "").trim().toLowerCase();
  const username = String(b.username ?? "").trim() || email;
  return {
    email,
    username,
    display_name: String(b.display_name ?? "").trim().slice(0, 100),
    imap_host: String(b.imap_host ?? "").trim(),
    imap_port: Number(b.imap_port ?? 993),
    imap_security: sec(b.imap_security, "tls"),
    smtp_host: String(b.smtp_host ?? "").trim(),
    smtp_port: Number(b.smtp_port ?? 465),
    smtp_security: sec(b.smtp_security, "tls"),
    folder: String(b.folder ?? "INBOX").trim() || "INBOX",
  };
}

/**
 * Add a mailbox on someone else's IMAP/SMTP server. The credentials are verified against both
 * servers *before* anything is written, so a typo never leaves a broken account behind.
 */
accounts.post("/imap", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<ImapBody>().catch(() => ({}) as ImapBody);
  const cfg = readBody(b);
  const password = normalizePassword(cfg.imap_host, String(b.password ?? ""));
  if (!EMAIL_RE.test(cfg.email)) return c.json({ error: "invalid_email" }, 400);
  if (!cfg.imap_host || !cfg.smtp_host) return c.json({ error: "missing_host" }, 400);
  if (oversize(cfg) || password.length > 1024) return c.json({ error: "invalid_field", message: "One of those values is too long." }, 400);
  if (!password) return c.json({ error: "missing_password" }, 400);
  if (!validPort(cfg.imap_port) || !validPort(cfg.smtp_port)) return c.json({ error: "invalid_port" }, 400);
  if (cfg.smtp_port === 25) return c.json({ error: "smtp_port_25_blocked", message: "Port 25 is for mail between servers, not for sending from a mailbox. Use 465 or 587." }, 400);

  const dup = await c.env.DB.prepare(`SELECT id FROM accounts WHERE user_id = ? AND email = ?`).bind(user.id, cfg.email).first();
  if (dup) return c.json({ error: "account_exists" }, 409);

  const creds = {
    imap: { host: cfg.imap_host, port: cfg.imap_port, security: cfg.imap_security, username: cfg.username, password },
    smtp: { host: cfg.smtp_host, port: cfg.smtp_port, security: cfg.smtp_security, username: cfg.username, password },
  };
  try {
    await verifyBoth(creds);
  } catch (e) {
    return c.json({ error: "connection_failed", message: explainConnectionError(cfg.imap_host, (e as Error).message ?? "").slice(0, 400) }, 400);
  }

  let id: string;
  try {
    id = await insertImapAccount(c.env, user.id, { ...cfg, initial_import: clampImport(b.import_recent) }, password);
  } catch (e) {
    // The address is unique, and the look above was before the servers were dialled: another request may have added it meanwhile.
    if (isUniqueViolation(e)) return c.json({ error: "account_exists" }, 409);
    console.error("saving a mailbox failed", e);
    return c.json({ error: "save_failed", message: "The mailbox could not be saved." }, 500);
  }

  // The first sync only records where the folder stands; nothing historical is imported.
  const fresh = await ownAccount(c, id);
  if (fresh) {
    const { syncAccount } = await import("../sync");
    c.executionCtx.waitUntil(syncAccount(c.env, fresh));
  }
  return c.json({ ok: true, account: toAccount(fresh!) });
});

/**
 * Re-check the inbox and import anything missing. Non-destructive: mail already here is skipped.
 * Body: `{ count }` for the newest N messages, or `{ all: true }` for everything in the folder.
 */
accounts.post("/:id/imap/resync", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (acc?.provider !== "imap") return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ count?: number; all?: boolean }>().catch(() => ({}) as never);
  const count = b.all === true ? RESYNC_ALL : clampResync(b.count);
  if (!(await queueResync(c.env, acc.id, count))) return c.json({ error: "not_found" }, 404);
  // Queued, not run here: the once-a-minute job picks it up and works through it in small passes, after the other mailboxes. Running it inside this
  // request is how a big re-sync once held the whole server.
  return c.json({ ok: true, queued: count });
});

/** The stored settings for a mailbox, with the password reduced to a hint. */
accounts.get("/:id/imap", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (acc?.provider !== "imap") return c.json({ error: "not_found" }, 404);
  const row = await loadImapRow(c.env, acc.id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const { password_enc, ...safe } = row;
  return c.json(safe);
});

/**
 * Update a mailbox in place. Rotating a mail password must not mean deleting the account, because
 * `deleteAccountData` takes the synced mail with it. Omitting `password` keeps the stored one, so
 * changing a host or port does not require re-typing the secret.
 */
accounts.patch("/:id/imap", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (acc?.provider !== "imap") return c.json({ error: "not_found" }, 404);
  const row = await loadImapRow(c.env, acc.id);
  if (!row) return c.json({ error: "not_configured" }, 400);

  const b = await c.req.json<ImapBody>().catch(() => ({}) as ImapBody);
  const next = {
    imap_host: typeof b.imap_host === "string" && b.imap_host.trim() ? b.imap_host.trim() : row.imap_host,
    imap_port: typeof b.imap_port === "number" ? b.imap_port : row.imap_port,
    imap_security: b.imap_security ? sec(b.imap_security, row.imap_security) : row.imap_security,
    smtp_host: typeof b.smtp_host === "string" && b.smtp_host.trim() ? b.smtp_host.trim() : row.smtp_host,
    smtp_port: typeof b.smtp_port === "number" ? b.smtp_port : row.smtp_port,
    smtp_security: b.smtp_security ? sec(b.smtp_security, row.smtp_security) : row.smtp_security,
    username: typeof b.username === "string" && b.username.trim() ? b.username.trim() : row.username,
    folder: typeof b.folder === "string" && b.folder.trim() ? b.folder.trim() : row.folder,
  };
  if (!validPort(next.imap_port) || !validPort(next.smtp_port)) return c.json({ error: "invalid_port" }, 400);
  if (next.smtp_port === 25) return c.json({ error: "smtp_port_25_blocked", message: "Port 25 is for mail between servers, not for sending from a mailbox. Use 465 or 587." }, 400);
  if (oversize(next) || (typeof b.password === "string" && b.password.length > 1024)) return c.json({ error: "invalid_field", message: "One of those values is too long." }, 400);

  const typed = typeof b.password === "string" ? normalizePassword(next.imap_host, b.password) : "";
  // The stored password is sent to whatever server is named when the connection is checked. Pointing the mailbox at another server, or another
  // user name, without typing the password again would let anyone holding a session read the password out by naming a server they run.
  const sameServer = next.imap_host.toLowerCase() === row.imap_host.toLowerCase() && next.smtp_host.toLowerCase() === row.smtp_host.toLowerCase() && next.username === row.username;
  if (!typed && !sameServer) {
    return c.json({ error: "password_required", message: "To change the server or the user name, type the mailbox password again." }, 400);
  }
  const password = typed || (await configFor(c.env, acc.id))?.imap.password || "";
  if (!password) return c.json({ error: "missing_password" }, 400);

  // Verify before writing, so a wrong value cannot leave a working mailbox broken.
  try {
    await verifyBoth({
      imap: { host: next.imap_host, port: next.imap_port, security: next.imap_security, username: next.username, password },
      smtp: { host: next.smtp_host, port: next.smtp_port, security: next.smtp_security, username: next.username, password },
    });
  } catch (e) {
    return c.json({ error: "connection_failed", message: explainConnectionError(next.imap_host, (e as Error).message ?? "").slice(0, 400) }, 400);
  }

  // A different folder invalidates the stored UIDs, so re-baseline rather than replaying old ones.
  const folderChanged = next.folder !== row.folder;
  const enc = typed ? await encryptPassword(c.env, typed) : row.password_enc;
  await c.env.DB.prepare(
    `UPDATE imap_accounts SET imap_host = ?, imap_port = ?, imap_security = ?, smtp_host = ?, smtp_port = ?, smtp_security = ?,
       username = ?, password_enc = ?, password_hint = ?, folder = ?, uid_validity = ?, last_uid = ?, updated_at = ?
     WHERE account_id = ?`
  )
    .bind(next.imap_host, next.imap_port, next.imap_security, next.smtp_host, next.smtp_port, next.smtp_security,
          next.username, enc, passwordHint(password), next.folder,
          folderChanged ? 0 : row.uid_validity, folderChanged ? 0 : row.last_uid, now(), acc.id)
    .run();

  // Working credentials retire the disconnected state the sync loop may have set.
  await c.env.DB.prepare(`UPDATE accounts SET sync_status = 'idle', sync_error = NULL WHERE id = ?`).bind(acc.id).run();
  const fresh = await ownAccount(c, acc.id);
  return c.json({ ok: true, account: toAccount(fresh!) });
});

/** Re-check the stored credentials against both servers. */
accounts.post("/:id/imap/test", async (c) => {
  const acc = await ownAccount(c, c.req.param("id"));
  if (acc?.provider !== "imap") return c.json({ error: "not_found" }, 404);
  const cfg = await configFor(c.env, acc.id);
  if (!cfg) return c.json({ error: "not_configured" }, 400);
  try {
    await verifyBoth(cfg);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message?.slice(0, 300) }, 400);
  }
});

export default accounts;
