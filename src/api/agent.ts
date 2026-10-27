/**
 * Agent mail: the pieces that let an AI agent or automation use a mailbox over HTTP.
 *
 * A key belongs to one agent mailbox and can only ever see that mailbox. Keys are shown once and stored
 * only as a SHA-256 hash, so a leaked database does not leak working keys. New mail can be pushed to a
 * webhook (signed, retried with backoff) or fetched by polling.
 */
import type { Env } from "./env";
import { Budget, UNLIMITED } from "./jobs";
import type { AccountRow, MessageRow } from "./db";
import { now, safeJson, uid } from "./db";
import type { Address } from "@shared/types";
import { decryptSecret } from "./ai/crypto";
import { getSessionSecret } from "./secrets";
import { isPrivateHost } from "./netguard";

export const KEY_PREFIX = "hfa_";
export type Scope = "read" | "send";
export const ALL_SCOPES: Scope[] = ["read", "send"];

/** Limits that keep a runaway agent from turning a mailbox into a spam cannon. */
export const MAX_SENDS_PER_HOUR = 60;
export const MAX_RECIPIENTS = 20;
export const MAX_BODY_BYTES = 1_000_000;

/** Webhook retry schedule: after each failed attempt, wait this long. Six attempts in all. */
export const WEBHOOK_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const MAX_ATTEMPTS = WEBHOOK_BACKOFF_MS.length + 1;

/* ---------- keys ---------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A new key: 256 random bits behind a recognisable prefix. `prefix` is what the list shows afterwards. */
export function generateKey(): { key: string; prefix: string } {
  const key = KEY_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export async function hashKey(key: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
}

export function parseScopes(v: string | null | undefined): Scope[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s));
}

/** Scopes from a request body: an array of known names, at least one. Anything else is null (reject). */
export function normalizeScopes(v: unknown): Scope[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: Scope[] = [];
  for (const s of v) {
    if (!(ALL_SCOPES as string[]).includes(String(s))) return null;
    if (!out.includes(s as Scope)) out.push(s as Scope);
  }
  return out;
}

export interface AgentAuth {
  keyId: string;
  keyName: string;
  scopes: Scope[];
  expiresAt: number | null;
  account: AccountRow;
}
export type AgentAuthError = "missing" | "invalid" | "expired" | "revoked";

interface KeyRow {
  id: string;
  account_id: string;
  name: string;
  scopes: string;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

/** Who is calling? A key resolves to its mailbox, or to the reason it does not. */
export async function authenticateAgent(env: Env, header: string | null | undefined): Promise<AgentAuth | { error: AgentAuthError }> {
  const m = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
  if (!m) return { error: "missing" };
  // A key that is not even shaped like ours never costs a database lookup.
  if (!m[1].startsWith(KEY_PREFIX)) return { error: "invalid" };
  const row = await env.DB.prepare(`SELECT id, account_id, name, scopes, last_used_at, expires_at, revoked_at FROM agent_keys WHERE key_hash = ?`)
    .bind(await hashKey(m[1]))
    .first<KeyRow>();
  if (!row) return { error: "invalid" };
  if (row.revoked_at) return { error: "revoked" };
  const t = now();
  if (row.expires_at && row.expires_at <= t) return { error: "expired" };
  // Switching a mailbox out of agent mode switches every key off with it.
  const account = await env.DB.prepare(`SELECT a.* FROM accounts a JOIN agent_mailboxes m ON m.account_id = a.id WHERE a.id = ?`).bind(row.account_id).first<AccountRow>();
  if (!account) return { error: "invalid" };
  // Recording use is a write, so do it at most once a minute per key.
  if (!row.last_used_at || t - row.last_used_at > 60_000) {
    await env.DB.prepare(`UPDATE agent_keys SET last_used_at = ? WHERE id = ?`).bind(t, row.id).run();
  }
  return { keyId: row.id, keyName: row.name, scopes: parseScopes(row.scopes), expiresAt: row.expires_at, account };
}

/* ---------- messages ---------- */

/** A message as the agent API lists it: everything but the bodies. */
export function serializeSummary(m: MessageRow) {
  return {
    id: m.id,
    thread_id: m.thread_id,
    message_id: m.message_id_header,
    in_reply_to: m.in_reply_to,
    direction: m.is_from_me ? ("outbound" as const) : ("inbound" as const),
    from: { email: m.from_email, name: m.from_name } as Address,
    to: safeJson<Address[]>(m.to_json, []),
    cc: safeJson<Address[]>(m.cc_json, []),
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
    unread: !!m.unread,
    has_attachments: !!m.has_attachments,
  };
}

/** A message with its text and HTML bodies, as the agent API returns it when one is opened. */
export function serializeFull(m: MessageRow) {
  return { ...serializeSummary(m), text: m.text_body, html: m.html_body };
}

/** Plain text as a small HTML fragment: escaped, with line breaks kept. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space:pre-wrap">${esc}</div>`;
}

/* ---------- webhooks ---------- */

/** An https URL on a real host name: no credentials, no IP literals, nothing that names this machine. */
export function validWebhookUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.includes(":") || /^\d+(\.\d+){3}$/.test(h)) return null;
  if (isPrivateHost(h)) return null;
  u.hash = "";
  return u.toString();
}

export function newWebhookSecret(): string {
  return "whsec_" + b64url(crypto.getRandomValues(new Uint8Array(24)));
}

/** HMAC-SHA256 of `${timestamp}.${body}`, hex. The receiver recomputes it to know the call is ours. */
export async function signPayload(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

interface MailboxHook {
  webhook_url: string;
  webhook_secret_enc: string;
}

async function loadHook(env: Env, accountId: string): Promise<MailboxHook | null> {
  return (await env.DB.prepare(`SELECT webhook_url, webhook_secret_enc FROM agent_mailboxes WHERE account_id = ?`).bind(accountId).first<MailboxHook>()) ?? null;
}

/** Called after mail is stored: if this is an agent mailbox with a webhook, queue an event for the message. */
export async function queueInboundEvent(env: Env, accountId: string, messageIdHeader: string, threadId?: string): Promise<boolean> {
  const hook = await loadHook(env, accountId);
  if (!hook?.webhook_url) return false;
  const msg = messageIdHeader
    ? await env.DB.prepare(`SELECT id FROM messages WHERE account_id = ? AND message_id_header = ? AND is_from_me = 0 LIMIT 1`).bind(accountId, messageIdHeader).first<{ id: string }>()
    : threadId
      ? await env.DB.prepare(`SELECT id FROM messages WHERE account_id = ? AND thread_id = ? AND is_from_me = 0 ORDER BY date DESC LIMIT 1`).bind(accountId, threadId).first<{ id: string }>()
      : null;
  if (!msg) return false;
  const t = now();
  await env.DB.prepare(`INSERT INTO agent_events (id, account_id, message_id, created_at, attempts, next_attempt_at) VALUES (?, ?, ?, ?, 0, ?)`)
    .bind(uid(), accountId, msg.id, t, t)
    .run();
  return true;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function post(url: string, secret: string, eventId: string, body: string, f: FetchLike): Promise<{ ok: boolean; status: number; error?: string }> {
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "agent-mail-webhook/1",
        "x-agent-event-id": eventId,
        "x-agent-signature": `t=${ts},v1=${await signPayload(secret, ts, body)}`,
      },
      body,
      // A webhook that answers with a redirect is treated as a failure, so it can never bounce us elsewhere.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return res.status >= 200 && res.status < 300 ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message?.slice(0, 160) || "request failed" };
  }
}

/** Deliver due events. Failures are retried on WEBHOOK_BACKOFF_MS, then dropped after MAX_ATTEMPTS. */
export async function dispatchAgentWebhooks(env: Env, f: FetchLike = fetch, at: number = now(), budget: Budget = UNLIMITED): Promise<{ delivered: number; failed: number }> {
  const due = await env.DB.prepare(
    `SELECT e.id, e.account_id, e.message_id, e.attempts, e.created_at, m.webhook_url, m.webhook_secret_enc
     FROM agent_events e JOIN agent_mailboxes m ON m.account_id = e.account_id
     WHERE e.delivered_at IS NULL AND e.attempts < ? AND e.next_attempt_at <= ? ORDER BY e.next_attempt_at LIMIT 10`
  )
    .bind(MAX_ATTEMPTS, at)
    .all<{ id: string; account_id: string; message_id: string; attempts: number; created_at: number; webhook_url: string; webhook_secret_enc: string }>();

  let delivered = 0;
  let failed = 0;
  for (const e of due.results) {
    if (budget.spent) break; // still due, delivered next minute
    const settle = (patch: string, ...binds: unknown[]) => env.DB.prepare(`UPDATE agent_events SET ${patch} WHERE id = ?`).bind(...binds, e.id).run();
    if (!e.webhook_url) {
      await settle("delivered_at = ?, last_error = ?", at, "webhook turned off");
      continue;
    }
    const msg = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(e.message_id).first<MessageRow>();
    if (!msg) {
      await settle("delivered_at = ?, last_error = ?", at, "message no longer exists");
      continue;
    }
    const account = await env.DB.prepare(`SELECT email FROM accounts WHERE id = ?`).bind(e.account_id).first<{ email: string }>();
    const full = serializeFull(msg);
    const truncated = full.text.length > 20_000;
    const body = JSON.stringify({
      id: e.id,
      type: "message.received",
      created_at: e.created_at,
      mailbox: account?.email ?? "",
      message: { ...full, text: truncated ? full.text.slice(0, 20_000) : full.text, html: undefined, text_truncated: truncated },
    });
    const secret = e.webhook_secret_enc ? await decryptSecret(await getSessionSecret(env), e.webhook_secret_enc) : "";
    const r = await post(e.webhook_url, secret, e.id, body, f);
    if (r.ok) {
      delivered++;
      await settle("attempts = ?, delivered_at = ?, last_error = NULL", e.attempts + 1, at);
    } else {
      failed++;
      const wait = WEBHOOK_BACKOFF_MS[Math.min(e.attempts, WEBHOOK_BACKOFF_MS.length - 1)];
      await settle("attempts = ?, next_attempt_at = ?, last_error = ?", e.attempts + 1, at + wait, r.error ?? "failed");
    }
  }
  return { delivered, failed };
}

/** Send a signed test event now, so the person can check their receiver before real mail arrives. */
export async function sendTestEvent(env: Env, accountId: string, f: FetchLike = fetch): Promise<{ ok: boolean; status: number; error?: string }> {
  const hook = await loadHook(env, accountId);
  if (!hook?.webhook_url) return { ok: false, status: 0, error: "Set a webhook URL first." };
  const account = await env.DB.prepare(`SELECT email FROM accounts WHERE id = ?`).bind(accountId).first<{ email: string }>();
  const id = `evt_test_${uid()}`;
  const body = JSON.stringify({ id, type: "webhook.test", created_at: now(), mailbox: account?.email ?? "" });
  const secret = hook.webhook_secret_enc ? await decryptSecret(await getSessionSecret(env), hook.webhook_secret_enc) : "";
  return post(hook.webhook_url, secret, id, body, f);
}

/** Ids of the user's agent mailboxes, for keeping them out of the personal unified inbox. */
export async function agentAccountIds(env: Env, userId: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`SELECT m.account_id FROM agent_mailboxes m JOIN accounts a ON a.id = m.account_id WHERE a.user_id = ?`).bind(userId).all<{ account_id: string }>();
  return new Set(rows.results.map((r) => r.account_id));
}
