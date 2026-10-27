import { Hono, type Context } from "hono";
import type { AppEnv, Env } from "../env";
import type { AccountRow } from "../db";
import { now, uid } from "../db";
import { encryptSecret } from "../ai/crypto";
import { getSessionSecret } from "../secrets";
import { generateKey, hashKey, newWebhookSecret, normalizeScopes, parseScopes, sendTestEvent, validWebhookUrl } from "../agent";

/**
 * Managing agent mailboxes from the app (behind your login): switch a mailbox into agent mode, make and
 * revoke its keys, and point its new-mail events at a webhook. The agent's own API is in routes/agent.ts.
 */
const agents = new Hono<AppEnv>();

const MAX_ACTIVE_KEYS = 20;

async function ownImap(c: Context<AppEnv>, id: string): Promise<AccountRow | null> {
  const a = await c.env.DB.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).bind(id, c.get("user").id).first<AccountRow>();
  return a && a.provider === "imap" ? a : null;
}

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

/** Everything the app shows about one agent mailbox. No secret or key ever appears here. */
async function describe(env: Env, a: AccountRow) {
  const box = await env.DB.prepare(`SELECT webhook_url, webhook_secret_enc, created_at FROM agent_mailboxes WHERE account_id = ?`).bind(a.id).first<{ webhook_url: string; webhook_secret_enc: string; created_at: number }>();
  if (!box) return null;
  const keys = await env.DB.prepare(`SELECT id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at FROM agent_keys WHERE account_id = ? ORDER BY created_at DESC`).bind(a.id).all<KeyRow>();
  const events = await env.DB.prepare(`SELECT id, message_id, created_at, attempts, delivered_at, last_error FROM agent_events WHERE account_id = ? ORDER BY created_at DESC LIMIT 10`)
    .bind(a.id)
    .all<{ id: string; message_id: string; created_at: number; attempts: number; delivered_at: number | null; last_error: string | null }>();
  return {
    account_id: a.id,
    email: a.email,
    display_name: a.display_name,
    webhook_url: box.webhook_url,
    webhook_secret_set: !!box.webhook_secret_enc,
    keys: keys.results.map((k) => ({ ...k, scopes: parseScopes(k.scopes) })),
    recent_events: events.results,
  };
}

agents.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT a.* FROM accounts a JOIN agent_mailboxes m ON m.account_id = a.id WHERE a.user_id = ? ORDER BY a.email`).bind(c.get("user").id).all<AccountRow>();
  const out = [];
  for (const a of rows.results) {
    const d = await describe(c.env, a);
    if (d) out.push(d);
  }
  return c.json(out);
});

agents.get("/:accountId", async (c) => {
  const a = await ownImap(c, c.req.param("accountId"));
  if (!a) return c.json({ error: "not_found" }, 404);
  return c.json((await describe(c.env, a)) ?? { account_id: a.id, email: a.email, display_name: a.display_name, enabled: false });
});

/** Switch a mailbox into or out of agent mode. Switching out removes its keys and queued events. */
agents.put("/:accountId", async (c) => {
  const a = await ownImap(c, c.req.param("accountId"));
  if (!a) return c.json({ error: "not_found", message: "Only mailboxes connected over IMAP can be agent mailboxes." }, 404);
  const b = await c.req.json<{ enabled?: boolean }>().catch(() => ({}) as never);
  if (typeof b.enabled !== "boolean") return c.json({ error: "invalid_body" }, 400);
  if (b.enabled) {
    await c.env.DB.prepare(`INSERT INTO agent_mailboxes (account_id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(a.id, now()).run();
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM agent_events WHERE account_id = ?`).bind(a.id),
      c.env.DB.prepare(`DELETE FROM agent_keys WHERE account_id = ?`).bind(a.id),
      c.env.DB.prepare(`DELETE FROM agent_mailboxes WHERE account_id = ?`).bind(a.id),
    ]);
  }
  return c.json((await describe(c.env, a)) ?? { account_id: a.id, email: a.email, enabled: false });
});

/** Make a key. The full key is in this response and nowhere else, ever. */
agents.post("/:accountId/keys", async (c) => {
  const a = await ownImap(c, c.req.param("accountId"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const box = await c.env.DB.prepare(`SELECT account_id FROM agent_mailboxes WHERE account_id = ?`).bind(a.id).first();
  if (!box) return c.json({ error: "not_agent_mailbox", message: "Turn on agent access for this mailbox first." }, 400);
  const b = await c.req.json<{ name?: string; scopes?: unknown; expires_in_days?: number | null }>().catch(() => ({}) as never);
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) return c.json({ error: "missing_name", message: "Give the key a name, such as the agent that will use it." }, 400);
  const scopes = normalizeScopes(b.scopes);
  if (!scopes) return c.json({ error: "invalid_scopes", message: "Choose at least one of: read, send." }, 400);
  let expiresAt: number | null = null;
  if (b.expires_in_days !== undefined && b.expires_in_days !== null) {
    const days = Math.floor(Number(b.expires_in_days));
    if (!Number.isFinite(days) || days < 1 || days > 3650) return c.json({ error: "invalid_expiry", message: "Expiry must be between 1 and 3650 days." }, 400);
    expiresAt = now() + days * 86_400_000;
  }
  const active = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM agent_keys WHERE account_id = ? AND revoked_at IS NULL`).bind(a.id).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) return c.json({ error: "too_many_keys", message: `A mailbox can have ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` }, 400);

  const { key, prefix } = generateKey();
  const id = uid();
  const t = now();
  await c.env.DB.prepare(`INSERT INTO agent_keys (id, account_id, name, prefix, key_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, a.id, name, prefix, await hashKey(key), scopes.join(","), t, expiresAt)
    .run();
  return c.json({ id, name, prefix, scopes, created_at: t, expires_at: expiresAt, key });
});

/** Revoke a key. It stops working at once, and stays in the list, marked, so you can see it was used. */
agents.delete("/:accountId/keys/:keyId", async (c) => {
  const a = await ownImap(c, c.req.param("accountId"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const r = await c.env.DB.prepare(`UPDATE agent_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND account_id = ?`).bind(now(), c.req.param("keyId"), a.id).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

/** Set or clear the webhook. The signing secret is returned once, when it is created or rotated. */
agents.put("/:accountId/webhook", async (c) => {
  const a = await ownImap(c, c.req.param("accountId"));
  if (!a) return c.json({ error: "not_found" }, 404);
  const box = await c.env.DB.prepare(`SELECT webhook_url, webhook_secret_enc FROM agent_mailboxes WHERE account_id = ?`).bind(a.id).first<{ webhook_url: string; webhook_secret_enc: string }>();
  if (!box) return c.json({ error: "not_agent_mailbox", message: "Turn on agent access for this mailbox first." }, 400);
  const b = await c.req.json<{ url?: string | null; rotate_secret?: boolean }>().catch(() => ({}) as never);
  const raw = typeof b.url === "string" ? b.url.trim() : "";
  if (!raw) {
    await c.env.DB.prepare(`UPDATE agent_mailboxes SET webhook_url = '', webhook_secret_enc = '' WHERE account_id = ?`).bind(a.id).run();
    return c.json({ ok: true, webhook_url: "" });
  }
  const url = validWebhookUrl(raw);
  if (!url) return c.json({ error: "invalid_webhook_url", message: "Use an https:// address on a real host name (not localhost or an IP address)." }, 400);
  const fresh = !box.webhook_secret_enc || b.rotate_secret === true;
  const secret = fresh ? newWebhookSecret() : null;
  await c.env.DB.prepare(`UPDATE agent_mailboxes SET webhook_url = ?, webhook_secret_enc = ? WHERE account_id = ?`)
    .bind(url, secret ? await encryptSecret(await getSessionSecret(c.env), secret) : box.webhook_secret_enc, a.id)
    .run();
  return c.json({ ok: true, webhook_url: url, ...(secret ? { secret } : {}) });
});

agents.post("/:accountId/webhook/test", async (c) => {
  const a = await ownImap(c, c.req.param("accountId"));
  if (!a) return c.json({ error: "not_found" }, 404);
  return c.json(await sendTestEvent(c.env, a.id));
});

export default agents;
