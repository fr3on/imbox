import { testEnv } from "./helpers";
import { generateKey, hashKey } from "../src/api/agent";

export async function seedAccount(id: string, email: string, opts: { user?: string; provider?: string } = {}) {
  await testEnv.DB.prepare(
    `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, scopes, history_id, delta_link, initial_sync_done, initial_sync_page_token, initial_sync_count, sync_status, sync_error, last_synced_at, signature, cover_art, avatar_url, created_at)
     VALUES (?, ?, ?, ?, '', NULL, NULL, NULL, '', NULL, NULL, 1, NULL, 0, 'idle', NULL, NULL, '', '', '', ?)`
  )
    .bind(id, opts.user ?? "u1", opts.provider ?? "imap", email, Date.now())
    .run();
}

export async function seedAgent(accountId: string, opts: { webhook?: string; secretEnc?: string } = {}) {
  await testEnv.DB.prepare(`INSERT INTO agent_mailboxes (account_id, webhook_url, webhook_secret_enc, created_at) VALUES (?, ?, ?, ?)`)
    .bind(accountId, opts.webhook ?? "", opts.secretEnc ?? "", Date.now())
    .run();
}

/** Insert a key straight into the table and hand back the plaintext, as the one-time reveal would. */
export async function seedKey(
  accountId: string,
  o: { id?: string; name?: string; scopes?: string; expiresAt?: number | null; revokedAt?: number | null; lastUsedAt?: number | null } = {}
): Promise<string> {
  const { key, prefix } = generateKey();
  await testEnv.DB.prepare(`INSERT INTO agent_keys (id, account_id, name, prefix, key_hash, scopes, created_at, last_used_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(o.id ?? crypto.randomUUID(), accountId, o.name ?? "test", prefix, await hashKey(key), o.scopes ?? "read", Date.now(), o.lastUsedAt ?? null, o.expiresAt ?? null, o.revokedAt ?? null)
    .run();
  return key;
}

export async function seedMessage(
  accountId: string,
  o: { id: string; threadId?: string; subject?: string; date: number; fromMe?: boolean; unread?: boolean; from?: string; fromName?: string; messageId?: string; to?: { email: string; name: string }[]; cc?: { email: string; name: string }[]; replyTo?: string; text?: string; html?: string }
) {
  const threadId = o.threadId ?? `t-${o.id}`;
  const t = Date.now();
  await testEnv.DB.prepare(
    `INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, seen, unread, first_message_at, last_message_at, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'imbox', 0, 1, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  )
    .bind(threadId, accountId, threadId, o.subject ?? "Hello", o.date, o.date, t, t)
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, cc_json, reply_to, subject, date, snippet, text_body, html_body, is_from_me, unread, message_id_header, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      o.id, accountId, threadId, `g-${o.id}`, o.from ?? "sender@example.com", o.fromName ?? "Sender",
      JSON.stringify(o.to ?? [{ email: "agent@example.com", name: "" }]), JSON.stringify(o.cc ?? []), o.replyTo ?? "", o.subject ?? "Hello", o.date,
      (o.text ?? "body").slice(0, 100), o.text ?? "body", o.html ?? "<p>body</p>", o.fromMe ? 1 : 0, o.unread === false ? 0 : 1, o.messageId ?? `<${o.id}@example.com>`, t
    )
    .run();
}
