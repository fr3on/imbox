import { Hono } from "hono";
import type { AppEnv } from "../../env";
import type { AccountRow, AttachmentRow, MessageRow } from "../../db";
import { gmailFetch } from "../../google";
import { TIMEOUT } from "../../http";
import { b64urlDecodeBytes } from "../../mime";
import { emlFilename, messageSource } from "../../messagesource";
import { attachmentHeaders } from "../../download";

const messages = new Hono<AppEnv>();

// ---------- Attachment proxy ----------
messages.get("/messages/:id/attachments/:attId", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const att = await db
    .prepare(
      `SELECT a.*, m.gmail_message_id FROM attachments a JOIN messages m ON m.id = a.message_id JOIN accounts ac ON ac.id = a.account_id WHERE a.id = ? AND a.message_id = ? AND ac.user_id = ?`
    )
    .bind(c.req.param("attId"), c.req.param("id"), user.id)
    .first<AttachmentRow & { gmail_message_id: string }>();
  if (!att) return c.json({ error: "not_found" }, 404);
  const acc = await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(att.account_id).first<AccountRow>();
  if (!acc) return c.json({ error: "not_found" }, 404);
  const download = c.req.query("download") === "1";
  const headersFor = (len: number) => attachmentHeaders(att.filename, att.mime_type, download, len);
  if (acc.provider !== "gmail") {
    const blob = await db.prepare(`SELECT data FROM attachment_blobs WHERE attachment_id = ?`).bind(att.id).first<{ data: unknown }>();
    const raw = blob?.data;
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
    if (!bytes) return c.json({ error: "attachment_not_stored" }, 404);
    return new Response(bytes as BodyInit, { headers: headersFor(bytes.byteLength) });
  }
  let res: Response;
  try {
    res = await gmailFetch(c.env, acc, `messages/${att.gmail_message_id}/attachments/${att.gmail_attachment_id}`, {}, TIMEOUT.transfer);
  } catch (e) {
    return c.json({ error: "gmail_error", message: ((e as Error).message ?? "").slice(0, 300) }, 502);
  }
  if (!res.ok) return c.json({ error: "gmail_error", status: res.status }, 502);
  const j = (await res.json()) as { data?: string; size?: number };
  const bytes = b64urlDecodeBytes(j.data ?? "");
  return new Response(bytes as BodyInit, { headers: headersFor(bytes.byteLength) });
});

// ---------- Message source ("Show original", "Download .eml") ----------
const SOURCE_VIEW_MAX = 2_000_000;
messages.get("/messages/:id/source", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const row = await db
    .prepare(`SELECT m.* FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ? AND a.user_id = ?`)
    .bind(c.req.param("id"), user.id)
    .first<MessageRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const acc = await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(row.account_id).first<AccountRow>();
  if (!acc) return c.json({ error: "not_found" }, 404);
  const src = await messageSource(c.env, acc, row);
  const common = { "x-source-kind": src.kind, "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (c.req.query("download") === "1") {
    const name = emlFilename(row.subject);
    return new Response(src.bytes as BodyInit, {
      headers: { ...common, "content-type": "message/rfc822", "content-disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}` },
    });
  }
  // Viewing: text, and no more than a couple of megabytes of it; the download has the whole thing.
  const truncated = src.bytes.byteLength > SOURCE_VIEW_MAX;
  return new Response((truncated ? src.bytes.slice(0, SOURCE_VIEW_MAX) : src.bytes) as BodyInit, {
    headers: { ...common, "content-type": "text/plain; charset=utf-8", ...(truncated ? { "x-truncated": "1" } : {}) },
  });
});

export default messages;
