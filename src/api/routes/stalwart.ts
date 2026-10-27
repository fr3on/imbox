import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import type { AccountRow } from "../db";
import { isUniqueViolation, toAccount, uid, now } from "../db";
import { syncAccount } from "../sync";
import { deleteAccountData } from "./domains";
import { encryptSecret, decryptSecret } from "../ai/crypto";
import { getSessionSecret } from "../secrets";
import { agentAccountIds } from "../agent";
import { insertImapAccount, verifyBoth, encryptPassword, passwordHint, clampImport, queueResync, clampResync, RESYNC_ALL, type NewImapMailbox } from "../imapbox";
import {
  StalwartError,
  normalizeBaseUrl,
  verifyConnection,
  listDomains,
  createDomain,
  setDomainEnabled,
  deleteDomain,
  getDomainZone,
  listUsers,
  createUser,
  setUserPassword,
  deleteUser,
  type StalwartConn,
} from "../stalwart";
import { checkDomainDns } from "../dnscheck";
import { systemLookup } from "../../node/dns";
import { MIN_MAILBOX_PASSWORD, generatePassword, validLocalPart } from "../../shared/mailbox";

/**
 * Stalwart as a provider: Imbox drives the server's management API to create domains and mailboxes,
 * then connects each mailbox to itself over IMAP/SMTP like any other account.
 *
 * Error statuses are deliberately 400/502, never 401/403: the web app treats those as "signed out".
 */
const stalwart = new Hono<AppEnv>();

interface ServerRow {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  api_key_enc: string;
  api_key_hint: string;
  last_checked_at: number | null;
  last_error: string | null;
  created_at: number;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MIN_PASSWORD = MIN_MAILBOX_PASSWORD;

function fail(c: Context<AppEnv>, e: unknown) {
  if (e instanceof StalwartError) {
    const status = e.kind === "network" || e.kind === "protocol" ? 502 : 400;
    return c.json({ error: `stalwart_${e.kind}`, message: e.message }, status);
  }
  console.error("stalwart route failed", e);
  return c.json({ error: "internal", message: "Something went wrong on the server." }, 500);
}

async function ownServer(c: Context<AppEnv>, id: string): Promise<ServerRow | null> {
  const user = c.get("user");
  return (await c.env.DB.prepare(`SELECT * FROM stalwart_servers WHERE id = ? AND user_id = ?`).bind(id, user.id).first<ServerRow>()) ?? null;
}

export async function connFor(env: Env, row: ServerRow): Promise<StalwartConn> {
  return { baseUrl: row.base_url, apiKey: await decryptSecret(await getSessionSecret(env), row.api_key_enc) };
}

function publicServer(row: ServerRow, mailboxes: number) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    api_key_hint: row.api_key_hint,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    mailboxes,
  };
}

function secFor(port: number, starttlsPort: number): "tls" | "starttls" {
  return port === starttlsPort ? "starttls" : "tls";
}

function mailboxConfig(server: ServerRow, email: string, displayName: string): NewImapMailbox {
  return {
    email,
    username: email,
    display_name: displayName,
    imap_host: server.imap_host,
    imap_port: server.imap_port,
    imap_security: secFor(server.imap_port, 143),
    smtp_host: server.smtp_host,
    smtp_port: server.smtp_port,
    smtp_security: secFor(server.smtp_port, 587),
    folder: "INBOX",
  };
}

/** Log in to both of the server's mail ports with the account's new password — proof it works. */
async function verifyMailbox(cfg: NewImapMailbox, password: string) {
  await verifyBoth({
    imap: { host: cfg.imap_host, port: cfg.imap_port, security: cfg.imap_security, username: cfg.username, password },
    smtp: { host: cfg.smtp_host, port: cfg.smtp_port, security: cfg.smtp_security, username: cfg.username, password },
  });
}

const ADMIN_REFUSAL = {
  error: "admin_protected",
  message: "This is an administrator account. Manage it in Stalwart's own admin page — Imbox will not reset or delete it, so it can never lock you out.",
};

async function countMailboxes(env: Env, serverId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM imap_accounts WHERE stalwart_server_id = ?`).bind(serverId).first<{ n: number }>();
  return r?.n ?? 0;
}

// ---------- Servers ----------

stalwart.get("/", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(`SELECT * FROM stalwart_servers WHERE user_id = ? ORDER BY created_at ASC`).bind(user.id).all<ServerRow>();
  const out = [];
  for (const r of rows.results) out.push(publicServer(r, await countMailboxes(c.env, r.id)));
  return c.json(out);
});

stalwart.post("/", async (c) => {
  const user = c.get("user");
  const b = await c.req
    .json<{ name?: string; base_url?: string; api_key?: string; imap_host?: string; imap_port?: number; smtp_host?: string; smtp_port?: number }>()
    .catch(() => ({}) as never);
  const apiKey = String(b.api_key ?? "").trim();
  if (apiKey.length < 8 || apiKey.length > 2000) return c.json({ error: "invalid_api_key", message: "Paste the API key from Stalwart." }, 400);
  const imapHost = String(b.imap_host ?? "").trim();
  const smtpHost = String(b.smtp_host ?? "").trim();
  if (imapHost.length > 255 || smtpHost.length > 255) return c.json({ error: "invalid_host" }, 400);

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(String(b.base_url ?? ""));
  } catch (e) {
    return fail(c, e);
  }
  const host = new URL(baseUrl).hostname;
  const imapPort = Number(b.imap_port ?? 993);
  const smtpPort = Number(b.smtp_port ?? 465);
  const valid = (n: number) => Number.isInteger(n) && n > 0 && n < 65536;
  if (!valid(imapPort) || !valid(smtpPort)) return c.json({ error: "invalid_port" }, 400);
  if (smtpPort === 25) return c.json({ error: "smtp_port_25_blocked", message: "Port 25 is for mail between servers, not for sending from a mailbox. Use 465 or 587." }, 400);

  const dup = await c.env.DB.prepare(`SELECT id FROM stalwart_servers WHERE user_id = ? AND base_url = ?`).bind(user.id, baseUrl).first();
  if (dup) return c.json({ error: "server_exists" }, 409);

  // Prove the URL is Stalwart and the key works before storing anything.
  try {
    await verifyConnection({ baseUrl, apiKey });
  } catch (e) {
    return fail(c, e);
  }

  const id = uid();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO stalwart_servers (id, user_id, name, base_url, imap_host, imap_port, smtp_host, smtp_port, api_key_enc, api_key_hint, last_checked_at, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  )
    .bind(
      id, user.id, String(b.name ?? "").trim().slice(0, 80) || host, baseUrl,
      imapHost || host, imapPort, smtpHost || host, smtpPort,
      await encryptSecret(await getSessionSecret(c.env), apiKey), passwordHint(apiKey), t, t
    )
    .run();
  const row = (await ownServer(c, id))!;
  return c.json(publicServer(row, 0));
});

/** Forget the server. Mailboxes already connected stay, as ordinary IMAP accounts; nothing changes on Stalwart. */
stalwart.delete("/:id", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`UPDATE imap_accounts SET stalwart_server_id = NULL, stalwart_account_id = NULL WHERE stalwart_server_id = ?`).bind(row.id).run();
  await c.env.DB.prepare(`DELETE FROM stalwart_servers WHERE id = ?`).bind(row.id).run();
  return c.json({ ok: true });
});

/** Replace the API key, e.g. after rotating it in Stalwart. */
stalwart.put("/:id/key", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ api_key?: string }>().catch(() => ({}) as never);
  const apiKey = String(b.api_key ?? "").trim();
  if (apiKey.length < 8 || apiKey.length > 2000) return c.json({ error: "invalid_api_key" }, 400);
  try {
    await verifyConnection({ baseUrl: row.base_url, apiKey });
  } catch (e) {
    return fail(c, e);
  }
  await c.env.DB.prepare(`UPDATE stalwart_servers SET api_key_enc = ?, api_key_hint = ?, last_error = NULL, last_checked_at = ? WHERE id = ?`)
    .bind(await encryptSecret(await getSessionSecret(c.env), apiKey), passwordHint(apiKey), now(), row.id)
    .run();
  return c.json(publicServer((await ownServer(c, row.id))!, await countMailboxes(c.env, row.id)));
});

// ---------- Domains ----------

stalwart.get("/:id/domains", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    return c.json(await listDomains(await connFor(c.env, row)));
  } catch (e) {
    return fail(c, e);
  }
});

stalwart.post("/:id/domains", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ name?: string }>().catch(() => ({}) as never);
  const name = String(b.name ?? "").trim().toLowerCase();
  if (!DOMAIN_RE.test(name)) return c.json({ error: "invalid_domain", message: "Enter a domain like example.com." }, 400);
  try {
    const conn = await connFor(c.env, row);
    const id = await createDomain(conn, name);
    return c.json({ id, name, isEnabled: true, description: null });
  } catch (e) {
    return fail(c, e);
  }
});

/** The DNS records to publish for this domain, as Stalwart's own zone file. */
stalwart.get("/:id/domains/:did/zone", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    return c.json({ zone: await getDomainZone(await connFor(c.env, row), c.req.param("did")) });
  } catch (e) {
    return fail(c, e);
  }
});

/** Looks up each record in the domain's zone and says whether it is live, missing or different. Reads public DNS only. */
stalwart.get("/:id/domains/:did/dns-check", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    const conn = await connFor(c.env, row);
    const domain = (await listDomains(conn)).find((d) => d.id === c.req.param("did"));
    if (!domain) return c.json({ error: "not_found" }, 404);
    const zone = await getDomainZone(conn, domain.id);
    const records = await checkDomainDns(zone, domain.name, c.env.DNS ?? systemLookup());
    return c.json({ domain: domain.name, checked_at: now(), records });
  } catch (e) {
    return fail(c, e);
  }
});

stalwart.patch("/:id/domains/:did", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ is_enabled?: boolean }>().catch(() => ({}) as never);
  if (typeof b.is_enabled !== "boolean") return c.json({ error: "invalid_body" }, 400);
  try {
    await setDomainEnabled(await connFor(c.env, row), c.req.param("did"), b.is_enabled);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

/** Stalwart refuses this while the domain still has accounts, which is the behaviour we want. */
stalwart.delete("/:id/domains/:did", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    await deleteDomain(await connFor(c.env, row), c.req.param("did"));
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Mailboxes ----------

interface LinkRow {
  account_id: string;
  stalwart_account_id: string;
}

stalwart.get("/:id/mailboxes", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  try {
    const user = c.get("user");
    const conn = await connFor(c.env, row);
    const [domains, users] = await Promise.all([listDomains(conn), listUsers(conn)]);
    const links = await c.env.DB.prepare(`SELECT account_id, stalwart_account_id FROM imap_accounts WHERE stalwart_server_id = ?`).bind(row.id).all<LinkRow>();
    const linked = new Map(links.results.map((l) => [l.stalwart_account_id, l.account_id]));
    const domainName = new Map(domains.map((d) => [d.id, d.name]));
    const agentIds = await agentAccountIds(c.env, user.id);

    // A mailbox added by hand before this server was connected is the same mailbox. Adopt it — but only
    // when it points at this very server, so a coincidentally named account elsewhere is never claimed.
    const loose = await c.env.DB.prepare(
      `SELECT a.id AS account_id, lower(a.email) AS email FROM accounts a JOIN imap_accounts i ON i.account_id = a.id
       WHERE a.user_id = ? AND a.provider = 'imap' AND i.stalwart_server_id IS NULL AND lower(i.imap_host) = lower(?)`
    )
      .bind(user.id, row.imap_host)
      .all<{ account_id: string; email: string }>();
    const looseByEmail = new Map(loose.results.map((l) => [l.email, l.account_id]));

    const out = [];
    for (const u of users) {
      const domain = domainName.get(u.domainId) ?? "";
      const email = domain ? `${u.name}@${domain}` : u.name;
      let accountId = linked.get(u.id) ?? null;
      if (!accountId && !u.isAdmin) {
        const adopt = looseByEmail.get(email.toLowerCase());
        if (adopt) {
          await c.env.DB.prepare(`UPDATE imap_accounts SET stalwart_server_id = ?, stalwart_account_id = ? WHERE account_id = ?`).bind(row.id, u.id, adopt).run();
          accountId = adopt;
        }
      }
      out.push({ id: u.id, name: u.name, domain_id: u.domainId, domain, email, description: u.description, account_id: accountId, is_admin: u.isAdmin, is_agent: !!accountId && agentIds.has(accountId) });
    }
    return c.json(out);
  } catch (e) {
    return fail(c, e);
  }
});

/** Create the account on Stalwart, then connect it here. The password is returned once if we chose it. */
stalwart.post("/:id/mailboxes", async (c) => {
  const user = c.get("user");
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ name?: string; domain_id?: string; display_name?: string; password?: string; agent?: boolean }>().catch(() => ({}) as never);
  const name = String(b.name ?? "").trim().toLowerCase();
  const displayName = String(b.display_name ?? "").trim().slice(0, 100);
  const typed = String(b.password ?? "");
  if (typed.length > 256) return c.json({ error: "invalid_password", message: "That password is too long." }, 400);
  if (!validLocalPart(name)) return c.json({ error: "invalid_name", message: "Use letters, digits and . _ + - only." }, 400);
  if (typed && typed.length < MIN_PASSWORD) return c.json({ error: "weak_password", message: `Use at least ${MIN_PASSWORD} characters.` }, 400);
  const password = typed || generatePassword();

  let conn: StalwartConn;
  let domainName = "";
  try {
    conn = await connFor(c.env, row);
    const domain = (await listDomains(conn)).find((d) => d.id === String(b.domain_id ?? ""));
    if (!domain) return c.json({ error: "invalid_domain", message: "Pick a domain that exists on the server." }, 400);
    domainName = domain.name;
  } catch (e) {
    return fail(c, e);
  }
  const email = `${name}@${domainName}`;
  const dup = await c.env.DB.prepare(`SELECT id FROM accounts WHERE user_id = ? AND email = ?`).bind(user.id, email).first();
  if (dup) return c.json({ error: "account_exists" }, 409);

  let stalwartId: string;
  try {
    stalwartId = await createUser(conn, { name, domainId: String(b.domain_id), description: displayName || undefined, password });
  } catch (e) {
    return fail(c, e);
  }

  const cfg = mailboxConfig(row, email, displayName);
  try {
    await verifyMailbox(cfg, password);
  } catch (e) {
    // A mailbox we cannot log in to is worse than none: remove it rather than leave an orphan behind.
    await deleteUser(conn, stalwartId).catch(() => {});
    return c.json({ error: "connection_failed", message: `The account was created but could not be reached, so it was removed: ${(e as Error).message?.slice(0, 200)}` }, 502);
  }

  let id: string;
  try {
    id = await insertImapAccount(c.env, user.id, cfg, password, { serverId: row.id, stalwartAccountId: stalwartId });
  } catch (e) {
    // Added here meanwhile by another request: the user made on Stalwart for this one is removed again, not left behind.
    if (!isUniqueViolation(e)) throw e;
    await deleteUser(conn, stalwartId).catch(() => {});
    return c.json({ error: "account_exists" }, 409);
  }
  // A mailbox for an AI agent: flagged here, so its mail stays out of your own inbox from the first message.
  if (b.agent === true) await c.env.DB.prepare(`INSERT INTO agent_mailboxes (account_id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(id, now()).run();
  const fresh = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first<AccountRow>();
  if (fresh) c.executionCtx.waitUntil(syncAccount(c.env, fresh));
  return c.json({ ok: true, account: { ...toAccount(fresh!), ...(b.agent === true ? { is_agent: true } : {}) }, email, password: typed ? undefined : password });
});

/**
 * Take over a mailbox that already exists on the server: Imbox cannot read mail with an API key, so
 * it sets a new password (which signs out that mailbox's other clients) and connects with that.
 */
stalwart.post("/:id/mailboxes/:sid/connect", async (c) => {
  const user = c.get("user");
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ confirm_reset?: boolean; display_name?: string; import_recent?: number }>().catch(() => ({}) as never);
  if (b.confirm_reset !== true) {
    return c.json({ error: "confirm_required", message: "Connecting sets a new password, which signs out this mailbox's other apps." }, 400);
  }
  const sid = c.req.param("sid");
  try {
    const conn = await connFor(c.env, row);
    const [domains, users] = await Promise.all([listDomains(conn), listUsers(conn)]);
    const u = users.find((x) => x.id === sid);
    if (!u) return c.json({ error: "not_found", message: "That account is not on the server." }, 404);
    if (u.isAdmin) return c.json(ADMIN_REFUSAL, 400);
    const domain = domains.find((d) => d.id === u.domainId);
    if (!domain) return c.json({ error: "invalid_domain" }, 400);
    const email = `${u.name}@${domain.name}`;
    const dup = await c.env.DB.prepare(`SELECT id FROM accounts WHERE user_id = ? AND email = ?`).bind(user.id, email).first();
    if (dup) return c.json({ error: "account_exists" }, 409);

    const password = generatePassword();
    await setUserPassword(conn, sid, password);
    const cfg = { ...mailboxConfig(row, email, String(b.display_name ?? u.description ?? "").trim().slice(0, 100)), initial_import: clampImport(b.import_recent) };
    await verifyMailbox(cfg, password);
    let id: string;
    try {
      id = await insertImapAccount(c.env, user.id, cfg, password, { serverId: row.id, stalwartAccountId: sid });
    } catch (e) {
      if (isUniqueViolation(e)) return c.json({ error: "account_exists" }, 409);
      throw e;
    }
    const fresh = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first<AccountRow>();
    if (fresh) c.executionCtx.waitUntil(syncAccount(c.env, fresh));
    return c.json({ ok: true, account: toAccount(fresh!), email, password });
  } catch (e) {
    return fail(c, e);
  }
});

/** New password on Stalwart and, if the mailbox is connected here, the stored copy too. */
stalwart.post("/:id/mailboxes/:sid/reset-password", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ password?: string }>().catch(() => ({}) as never);
  const typed = String(b.password ?? "");
  if (typed.length > 256) return c.json({ error: "invalid_password", message: "That password is too long." }, 400);
  if (typed && typed.length < MIN_PASSWORD) return c.json({ error: "weak_password", message: `Use at least ${MIN_PASSWORD} characters.` }, 400);
  const password = typed || generatePassword();
  const sid = c.req.param("sid");
  try {
    const conn = await connFor(c.env, row);
    const target = (await listUsers(conn)).find((x) => x.id === sid);
    if (!target) return c.json({ error: "not_found", message: "That account is not on the server." }, 404);
    if (target.isAdmin) return c.json(ADMIN_REFUSAL, 400);
    await setUserPassword(conn, sid, password);
  } catch (e) {
    return fail(c, e);
  }
  const link = await c.env.DB.prepare(`SELECT account_id FROM imap_accounts WHERE stalwart_server_id = ? AND stalwart_account_id = ?`)
    .bind(row.id, sid)
    .first<{ account_id: string }>();
  if (link) {
    await c.env.DB.prepare(`UPDATE imap_accounts SET password_enc = ?, password_hint = ?, updated_at = ? WHERE account_id = ?`)
      .bind(await encryptPassword(c.env, password), passwordHint(password), now(), link.account_id)
      .run();
    await c.env.DB.prepare(`UPDATE accounts SET sync_status = 'idle', sync_error = NULL WHERE id = ? AND sync_status IN ('error', 'disconnected')`).bind(link.account_id).run();
  }
  return c.json({ ok: true, password: typed ? undefined : password });
});

/**
 * Re-check every mailbox of this server that is connected here and import anything missing. Only local
 * state changes — nothing is sent to Stalwart — and it is non-destructive: mail already here is skipped.
 */
stalwart.post("/:id/resync", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ count?: number; all?: boolean }>().catch(() => ({}) as never);
  const count = b.all === true ? RESYNC_ALL : clampResync(b.count);
  const links = await c.env.DB.prepare(
    `SELECT i.account_id FROM imap_accounts i JOIN accounts a ON a.id = i.account_id WHERE i.stalwart_server_id = ? AND a.user_id = ? AND a.sync_status <> 'disconnected'`
  )
    .bind(row.id, c.get("user").id)
    .all<{ account_id: string }>();
  let queued = 0;
  for (const l of links.results) {
    if (await queueResync(c.env, l.account_id, count)) {
      queued++;
      const fresh = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(l.account_id).first<AccountRow>();
      if (fresh) c.executionCtx.waitUntil(syncAccount(c.env, fresh));
    }
  }
  return c.json({ ok: true, mailboxes: queued, queued: count });
});

/**
 * Delete the account on Stalwart — its mail goes with it — and the connected copy here. The caller must
 * echo the address back as `?confirm=`, so a stray request cannot destroy a mailbox.
 */
stalwart.delete("/:id/mailboxes/:sid", async (c) => {
  const row = await ownServer(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const sid = c.req.param("sid");
  try {
    const conn = await connFor(c.env, row);
    const [domains, users] = await Promise.all([listDomains(conn), listUsers(conn)]);
    const u = users.find((x) => x.id === sid);
    if (!u) return c.json({ error: "not_found" }, 404);
    if (u.isAdmin) return c.json(ADMIN_REFUSAL, 400);
    const domain = domains.find((d) => d.id === u.domainId)?.name ?? "";
    const email = domain ? `${u.name}@${domain}` : u.name;
    if ((c.req.query("confirm") ?? "").toLowerCase() !== email.toLowerCase()) {
      return c.json({ error: "confirm_required", message: `Type ${email} to confirm deleting this mailbox and all its mail.` }, 400);
    }
    await deleteUser(conn, sid);
    const link = await c.env.DB.prepare(`SELECT account_id FROM imap_accounts WHERE stalwart_server_id = ? AND stalwart_account_id = ?`)
      .bind(row.id, sid)
      .first<{ account_id: string }>();
    if (link) await deleteAccountData(c.env.DB, link.account_id);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

export default stalwart;
