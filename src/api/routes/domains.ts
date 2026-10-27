import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import type { AccountRow, DomainRow } from "../db";
import { uid, now, toAccount } from "../db";
import type { Domain } from "@shared/types";
import { isId } from "../input";

const domains = new Hono<AppEnv>();

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_RE = /^[a-z0-9._+-]{1,64}$/;

/** Outbound mail for a domain mailbox goes through Resend (or a Stalwart server, which has its own domains). */
function sendingMode(env: Env): Domain["sending"] {
  return env.RESEND_API_KEY ? "resend" : "none";
}

/** Where a mail server delivers messages for this app's domains, and whether that is switched on. */
function inboundUrl(env: Env): string {
  return `${(env.APP_URL || "https://<your Imbox address>").replace(/\/+$/, "")}/inbound/mail`;
}

/**
 * Mail arrives from a mail server the owner runs, which POSTs each message to /inbound/mail (see imbox-website/docs/content/docs/mailboxes.mdx). The domain is "active" once a message
 * has arrived on one of its mailboxes; before that there is nothing to check but whether the endpoint is switched on.
 */
function instructionsFor(env: Env, d: DomainRow, received: number | null): string[] {
  const out: string[] = [];
  if (!env.INBOUND_SECRET) out.push("Set INBOUND_SECRET on the server (openssl rand -hex 32) and restart it. Until then Imbox does not accept mail over HTTP.");
  if (!received) {
    out.push(`Point the MX records of ${d.name} at the mail server that will forward its mail to Imbox.`);
    out.push(`Have that server POST each message to ${inboundUrl(env)}?to=<recipient>&from=<sender> with the raw message as the body and the header Authorization: Bearer <your INBOUND_SECRET>.`);
    out.push("Create a mailbox below, or turn on a catch-all, then send a test message. This page turns Active when the first one arrives.");
  }
  if (sendingMode(env) === "none") {
    out.push(`Outbound mail is not configured: set a RESEND_API_KEY secret with ${d.name} verified in Resend.`);
  }
  return out;
}

async function mailboxesFor(db: Db, domainId: string): Promise<AccountRow[]> {
  const rows = await db.prepare(`SELECT * FROM accounts WHERE domain_id = ? AND provider = 'domain' ORDER BY created_at ASC`).bind(domainId).all<AccountRow>();
  return rows.results;
}

async function toDomain(env: Env, d: DomainRow): Promise<Domain> {
  const mailboxes = await mailboxesFor(env.DB, d.id);
  const last = await env.DB.prepare(`SELECT MAX(m.created_at) AS at FROM messages m JOIN accounts a ON a.id = m.account_id WHERE a.domain_id = ?`).bind(d.id).first<{ at: number | null }>();
  const received = last?.at ?? null;
  const enabled = !!env.INBOUND_SECRET;
  return {
    id: d.id,
    name: d.name,
    status: received ? "active" : "pending",
    sending: sendingMode(env),
    catch_all_account_id: d.catch_all_account_id,
    error: enabled ? null : "Inbound mail is switched off: INBOUND_SECRET is not set.",
    inbound: { enabled, url: inboundUrl(env), last_received_at: received },
    instructions: instructionsFor(env, d, received),
    mailboxes: mailboxes.map(toAccount),
    created_at: d.created_at,
  };
}

async function ownDomain(c: Context<AppEnv>, id: string): Promise<DomainRow | null> {
  return (await c.env.DB.prepare(`SELECT * FROM domains WHERE id = ? AND user_id = ?`).bind(id, c.get("user").id).first<DomainRow>()) ?? null;
}

domains.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM domains WHERE user_id = ? ORDER BY created_at ASC`).bind(c.get("user").id).all<DomainRow>();
  const out: Domain[] = [];
  for (const d of rows.results) out.push(await toDomain(c.env, d));
  return c.json(out);
});

domains.post("/", async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<{ name?: string }>().catch(() => ({}) as any);
  const name = String(b.name ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(name)) return c.json({ error: "invalid_domain" }, 400);
  const t = now();
  const d: DomainRow = { id: uid(), user_id: c.get("user").id, name, catch_all_account_id: null, created_at: t, updated_at: t };
  // A name belongs to one person on the whole server. The insert is the check: of two requests that arrive together, one adds it and the other is told it exists.
  const added = await db
    .prepare(`INSERT INTO domains (id, user_id, name, catch_all_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING`)
    .bind(d.id, d.user_id, d.name, d.catch_all_account_id, d.created_at, d.updated_at)
    .run();
  if (!added.meta.changes) return c.json({ error: "domain_exists" }, 409);
  return c.json(await toDomain(c.env, d));
});

// Re-reads the state: whether the endpoint is switched on and whether mail has arrived. Nothing is changed.
domains.post("/:id/verify", async (c) => {
  const d = await ownDomain(c, c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  return c.json(await toDomain(c.env, d));
});

domains.patch("/:id", async (c) => {
  const d = await ownDomain(c, c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ catch_all_account_id?: string | null }>().catch(() => ({}) as any);
  if (b.catch_all_account_id !== undefined) {
    if (b.catch_all_account_id !== null && b.catch_all_account_id !== "" && !isId(b.catch_all_account_id)) return c.json({ error: "invalid_mailbox" }, 400);
    if (b.catch_all_account_id) {
      const mb = await c.env.DB.prepare(`SELECT id FROM accounts WHERE id = ? AND domain_id = ? AND provider = 'domain'`).bind(b.catch_all_account_id, d.id).first();
      if (!mb) return c.json({ error: "invalid_mailbox" }, 400);
    }
    d.catch_all_account_id = b.catch_all_account_id || null;
    await c.env.DB.prepare(`UPDATE domains SET catch_all_account_id = ?, updated_at = ? WHERE id = ?`).bind(d.catch_all_account_id, now(), d.id).run();
  }
  return c.json(await toDomain(c.env, d));
});

domains.delete("/:id", async (c) => {
  const d = await ownDomain(c, c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB;
  const boxes = await mailboxesFor(db, d.id);
  for (const acc of boxes) await deleteAccountData(db, acc.id);
  await db.prepare(`DELETE FROM domains WHERE id = ?`).bind(d.id).run();
  return c.json({ ok: true });
});

domains.post("/:id/mailboxes", async (c) => {
  const d = await ownDomain(c, c.req.param("id"));
  if (!d) return c.json({ error: "not_found" }, 404);
  const db = c.env.DB;
  const b = await c.req.json<{ local_part?: string; display_name?: string; catch_all?: boolean }>().catch(() => ({}) as any);
  const local = String(b.local_part ?? "").trim().toLowerCase();
  if (!LOCAL_RE.test(local) || local.startsWith(".") || local.endsWith(".")) return c.json({ error: "invalid_local_part" }, 400);
  const email = `${local}@${d.name}`;
  const id = uid();
  const t = now();
  // The address is unique: the insert is the check, so two requests for it that arrive together do not end as a server error.
  const row = await db
    .prepare(
      `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, history_id, initial_sync_done, initial_sync_page_token, initial_sync_count, sync_status, sync_error, last_synced_at, signature, cover_art, created_at, domain_id)
       VALUES (?, ?, 'domain', ?, ?, NULL, NULL, NULL, NULL, 1, NULL, 0, 'idle', NULL, ?, '', '', ?, ?)
       ON CONFLICT DO NOTHING RETURNING *`
    )
    .bind(id, d.user_id, email, String(b.display_name ?? "").trim().slice(0, 100), t, t, d.id)
    .first<AccountRow>();
  if (!row) return c.json({ error: "mailbox_exists" }, 409);
  if (b.catch_all) await db.prepare(`UPDATE domains SET catch_all_account_id = ?, updated_at = ? WHERE id = ?`).bind(id, t, d.id).run();
  return c.json(toAccount(row));
});

/** Remove an account and everything under it (shared with DELETE /api/accounts/:id). */
export async function deleteAccountData(db: Db, accountId: string, opts: { keepAccount?: boolean } = {}) {
  await db.batch([
    db.prepare(`DELETE FROM thread_labels WHERE thread_id IN (SELECT id FROM threads WHERE account_id = ?)`).bind(accountId),
    db.prepare(`DELETE FROM collection_threads WHERE thread_id IN (SELECT id FROM threads WHERE account_id = ?)`).bind(accountId),
    db.prepare(`DELETE FROM clips WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM collections WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM labels WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM drafts WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM attachment_blobs WHERE attachment_id IN (SELECT id FROM attachments WHERE account_id = ?)`).bind(accountId),
    db.prepare(`DELETE FROM attachments WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM messages WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM threads WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM contacts WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM sync_log WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM thread_summaries WHERE account_id = ?`).bind(accountId),
    db.prepare(`DELETE FROM auto_agent_runs WHERE account_id = ?`).bind(accountId),
    // Queued webhook events point at messages that are gone now.
    db.prepare(`DELETE FROM agent_events WHERE account_id = ?`).bind(accountId),
    ...(opts.keepAccount
      ? []
      : [
          // A mailbox's own calendar goes with it. Explicit, not relying on the FK cascade.
          db.prepare(`DELETE FROM event_completions WHERE event_id IN (SELECT id FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE account_id = ?))`).bind(accountId),
          db.prepare(`DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE account_id = ?)`).bind(accountId),
          db.prepare(`DELETE FROM calendars WHERE account_id = ?`).bind(accountId),
          db.prepare(`UPDATE domains SET catch_all_account_id = NULL WHERE catch_all_account_id = ?`).bind(accountId),
          // Explicit, not relying on the FK cascade: leaving this row behind would strand an encrypted password.
          db.prepare(`DELETE FROM agent_keys WHERE account_id = ?`).bind(accountId),
          db.prepare(`DELETE FROM agent_mailboxes WHERE account_id = ?`).bind(accountId),
          db.prepare(`DELETE FROM imap_accounts WHERE account_id = ?`).bind(accountId),
          db.prepare(`DELETE FROM accounts WHERE id = ?`).bind(accountId),
        ]),
  ]);
}

export default domains;
