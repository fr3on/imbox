import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { Env } from "../env";
import type { MessageRow } from "../db";
import { now, safeJson } from "../db";
import type { Address } from "@shared/types";
import { sendMail } from "../send";
import { attachmentHeaders } from "../download";
import {
  MAX_BODY_BYTES,
  MAX_RECIPIENTS,
  MAX_SENDS_PER_HOUR,
  authenticateAgent,
  serializeFull,
  serializeSummary,
  textToHtml,
  type AgentAuth,
  type Scope,
} from "../agent";

/**
 * The agent API. Everything here belongs to the one mailbox the key was made for; there is no way to
 * name another mailbox, so a key cannot see or send from anything else.
 */
type AgentEnv = { Bindings: Env; Variables: { agent: AgentAuth } };
const agent = new Hono<AgentEnv>();

const AUTH_MESSAGES = {
  missing: "Send your key as “Authorization: Bearer hfa_…”.",
  invalid: "That key is not valid.",
  expired: "That key has expired. Create a new one.",
  revoked: "That key was revoked.",
} as const;

agent.use("*", async (c, next) => {
  const r = await authenticateAgent(c.env, c.req.header("authorization"));
  if ("error" in r) {
    return c.json({ error: r.error === "missing" ? "unauthorized" : `key_${r.error}`, message: AUTH_MESSAGES[r.error] }, 401, { "www-authenticate": 'Bearer realm="agent-mail"' });
  }
  c.set("agent", r);
  await next();
});

const need =
  (scope: Scope): MiddlewareHandler<AgentEnv> =>
  async (c, next) => {
    if (!c.get("agent").scopes.includes(scope)) {
      return c.json({ error: "insufficient_scope", message: `This key does not have the “${scope}” scope.` }, 403);
    }
    await next();
  };

const EMAIL_RE = /^[^@\s<>,;]+@[^@\s<>,;.]+\.[^@\s<>,;]+$/;

/** "a@b.com", "Name <a@b.com>", {email, name}, or an array of those → addresses, deduplicated. Null if any is invalid. */
function parseAddresses(v: unknown): Address[] | null {
  if (v === undefined || v === null || v === "") return [];
  const items = Array.isArray(v) ? v : [v];
  const out: Address[] = [];
  for (const it of items) {
    let email = "";
    let name = "";
    if (typeof it === "string") {
      const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(it);
      if (m) {
        name = (m[1] ?? "").trim();
        email = m[2].trim();
      } else email = it.trim();
    } else if (it && typeof it === "object" && typeof (it as Address).email === "string") {
      email = (it as Address).email.trim();
      name = typeof (it as Address).name === "string" ? (it as Address).name.trim() : "";
    } else return null;
    if (!EMAIL_RE.test(email)) return null;
    email = email.toLowerCase();
    if (!out.some((a) => a.email === email)) out.push({ email, name: name.replace(/[\r\n]+/g, " ").slice(0, 200) });
  }
  return out;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};

async function ownMessage(c: Context<AgentEnv>, id: string): Promise<MessageRow | null> {
  return (await c.env.DB.prepare(`SELECT * FROM messages WHERE id = ? AND account_id = ?`).bind(id, c.get("agent").account.id).first<MessageRow>()) ?? null;
}

async function setRead(env: Env, accountId: string, m: MessageRow, read: boolean) {
  await env.DB.prepare(`UPDATE messages SET unread = ? WHERE id = ? AND account_id = ?`).bind(read ? 0 : 1, m.id, accountId).run();
  await env.DB.prepare(
    `UPDATE threads SET unread = (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM messages WHERE thread_id = ? AND unread = 1), updated_at = ? WHERE id = ? AND account_id = ?`
  )
    .bind(m.thread_id, now(), m.thread_id, accountId)
    .run();
}

/** Who this key is: the mailbox and what the key may do. */
agent.get("/me", (c) => {
  const a = c.get("agent");
  return c.json({
    mailbox: { email: a.account.email, name: a.account.display_name },
    key: { name: a.keyName, scopes: a.scopes, expires_at: a.expiresAt },
    limits: { sends_per_hour: MAX_SENDS_PER_HOUR, recipients_per_message: MAX_RECIPIENTS },
  });
});

/**
 * List messages, newest first. `after=<ms>` switches to oldest first from that moment, which is the easy
 * way to poll: remember the last `date` you saw and pass it back. Filters: `unread=1`, `direction=inbound|outbound|all`.
 */
agent.get("/messages", need("read"), async (c) => {
  const a = c.get("agent");
  const limit = clamp(c.req.query("limit"), 1, 100, 25);
  const direction = c.req.query("direction") ?? "inbound";
  if (!["inbound", "outbound", "all"].includes(direction)) return c.json({ error: "invalid_direction", message: "direction must be inbound, outbound or all." }, 400);
  const before = c.req.query("before") ? Number(c.req.query("before")) : null;
  const after = c.req.query("after") ? Number(c.req.query("after")) : null;
  if ((before !== null && !Number.isFinite(before)) || (after !== null && !Number.isFinite(after))) return c.json({ error: "invalid_cursor", message: "before and after are millisecond timestamps." }, 400);

  const where = ["account_id = ?"];
  const binds: unknown[] = [a.account.id];
  if (direction !== "all") where.push(`is_from_me = ${direction === "outbound" ? 1 : 0}`);
  if (c.req.query("unread") === "1") where.push("unread = 1");
  if (before !== null) (where.push("date < ?"), binds.push(before));
  if (after !== null) (where.push("date > ?"), binds.push(after));
  const rows = await c.env.DB.prepare(`SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY date ${after !== null ? "ASC" : "DESC"}, id LIMIT ?`)
    .bind(...binds, limit)
    .all<MessageRow>();
  const messages = rows.results.map(serializeSummary);
  const last = messages[messages.length - 1];
  const more = messages.length === limit;
  return c.json({ messages, ...(more && last ? (after !== null ? { next_after: last.date } : { next_before: last.date }) : {}) });
});

agent.get("/messages/:id", need("read"), async (c) => {
  const m = await ownMessage(c, c.req.param("id"));
  if (!m) return c.json({ error: "not_found" }, 404);
  const atts = await c.env.DB.prepare(`SELECT id, filename, mime_type, size FROM attachments WHERE message_id = ? AND account_id = ? AND is_inline = 0`)
    .bind(m.id, m.account_id)
    .all<{ id: string; filename: string; mime_type: string; size: number }>();
  if (c.req.query("mark_read") === "1" && m.unread) await setRead(c.env, m.account_id, m, true);
  return c.json({ ...serializeFull(m), unread: c.req.query("mark_read") === "1" ? false : !!m.unread, attachments: atts.results.map((x) => ({ id: x.id, filename: x.filename, content_type: x.mime_type, size: x.size })) });
});

agent.get("/messages/:id/attachments/:aid", need("read"), async (c) => {
  const m = await ownMessage(c, c.req.param("id"));
  if (!m) return c.json({ error: "not_found" }, 404);
  const att = await c.env.DB.prepare(`SELECT id, filename, mime_type FROM attachments WHERE id = ? AND message_id = ? AND account_id = ?`).bind(c.req.param("aid"), m.id, m.account_id).first<{ id: string; filename: string; mime_type: string }>();
  if (!att) return c.json({ error: "not_found" }, 404);
  const blob = await c.env.DB.prepare(`SELECT data FROM attachment_blobs WHERE attachment_id = ?`).bind(att.id).first<{ data: unknown }>();
  const raw = blob?.data;
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Array.isArray(raw) ? Uint8Array.from(raw as number[]) : ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
  if (!bytes) return c.json({ error: "attachment_not_stored" }, 404);
  return new Response(bytes as BodyInit, { headers: attachmentHeaders(att.filename, att.mime_type, true, bytes.byteLength) });
});

agent.post("/messages/:id/read", need("read"), async (c) => {
  const m = await ownMessage(c, c.req.param("id"));
  if (!m) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<{ read?: boolean }>().catch(() => ({}) as never);
  const read = b.read !== false;
  await setRead(c.env, m.account_id, m, read);
  return c.json({ ok: true, id: m.id, unread: !read });
});

/** The hourly send cap, checked before anything leaves the building. */
async function sendBudget(env: Env, accountId: string): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const since = now() - 3_600_000;
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n, MIN(date) AS oldest FROM messages WHERE account_id = ? AND is_from_me = 1 AND date > ?`).bind(accountId, since).first<{ n: number; oldest: number | null }>();
  if ((r?.n ?? 0) < MAX_SENDS_PER_HOUR) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil(((r?.oldest ?? since) + 3_600_000 - now()) / 1000)) };
}

interface Body {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  reply_all?: unknown;
}

/** Validate a send/reply body into what sendMail needs, or say what is wrong. */
function readBody(b: Body, needTo: boolean): { error: string; message: string } | { to: Address[]; cc: Address[]; bcc: Address[]; subject: string; html: string } {
  const to = parseAddresses(b.to);
  const cc = parseAddresses(b.cc);
  const bcc = parseAddresses(b.bcc);
  if (!to || !cc || !bcc) return { error: "invalid_recipient", message: "Every recipient must be an email address, or an object with an email." };
  if (needTo && to.length === 0) return { error: "missing_recipient", message: "Add at least one recipient in “to”." };
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) return { error: "too_many_recipients", message: `At most ${MAX_RECIPIENTS} recipients per message.` };
  const text = typeof b.text === "string" ? b.text : "";
  const html = typeof b.html === "string" ? b.html : "";
  if (!text.trim() && !html.trim()) return { error: "missing_body", message: "Provide “text” or “html”." };
  if (new TextEncoder().encode(text + html).length > MAX_BODY_BYTES) return { error: "body_too_large", message: "The message is too large." };
  const subject = typeof b.subject === "string" ? b.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 500) : "";
  return { to, cc, bcc, subject, html: html.trim() ? html : textToHtml(text) };
}

async function deliver(c: Context<AgentEnv>, p: { thread_id?: string; reply_to_message_id?: string; to: Address[]; cc: Address[]; bcc: Address[]; subject: string; html: string }) {
  const a = c.get("agent");
  const budget = await sendBudget(c.env, a.account.id);
  if (!budget.ok) {
    return c.json({ error: "rate_limited", message: `This mailbox has sent ${MAX_SENDS_PER_HOUR} messages in the last hour. Try again later.` }, 429, { "retry-after": String(budget.retryAfter) });
  }
  try {
    const r = await sendMail(c.env, a.account, { thread_id: p.thread_id, reply_to_message_id: p.reply_to_message_id, to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, body_html: p.html });
    const row = await c.env.DB.prepare(`SELECT * FROM messages WHERE id = ? AND account_id = ?`).bind(r.message_id, a.account.id).first<MessageRow>();
    return c.json({ ok: true, id: r.message_id, thread_id: r.thread_id, ...(row ? { message: serializeSummary(row) } : {}) }, 201);
  } catch (e) {
    return c.json({ error: "send_failed", message: ((e as Error).message ?? "Sending failed").slice(0, 300) }, 502);
  }
}

agent.post("/messages", need("send"), async (c) => {
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const r = readBody(b, true);
  if ("error" in r) return c.json(r, 400);
  return deliver(c, r);
});

agent.post("/messages/:id/reply", need("send"), async (c) => {
  const m = await ownMessage(c, c.req.param("id"));
  if (!m) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<Body>().catch(() => ({}) as Body);
  const self = c.get("agent").account.email.toLowerCase();
  // Who to answer: the sender (or, replying to our own message, whoever we wrote to); everyone with reply_all.
  const sender: Address[] = m.is_from_me ? safeJson<Address[]>(m.to_json, []) : [{ email: m.reply_to || m.from_email, name: m.reply_to ? "" : m.from_name }];
  const everyone = b.reply_all === true ? [...sender, { email: m.from_email, name: m.from_name }, ...safeJson<Address[]>(m.to_json, []), ...safeJson<Address[]>(m.cc_json, [])] : sender;
  const seen = new Set<string>();
  const to = everyone.filter((x) => x.email && x.email.toLowerCase() !== self && !seen.has(x.email.toLowerCase()) && !!seen.add(x.email.toLowerCase()));
  const r = readBody({ ...b, to: to.length ? to : b.to }, true);
  if ("error" in r) return c.json(r, 400);
  return deliver(c, { ...r, thread_id: m.thread_id, reply_to_message_id: m.id });
});

agent.notFound((c) => c.json({ error: "not_found" }, 404));
agent.onError((e, c) => {
  console.error("agent API error", e);
  return c.json({ error: "internal", message: "Something went wrong." }, 500);
});

export default agent;
