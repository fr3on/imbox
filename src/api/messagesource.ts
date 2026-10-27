// A message's source, for "Show original" and "Download .eml". Gmail can hand back the exact original. For the other kinds of mailbox Imbox
// keeps the parsed message and its attachments but not the raw bytes, so the source is rebuilt from those parts: the same content and
// the main headers, though not every header the sending servers added along the way. The caller is told which of the two it got.

import type { AccountRow, MessageRow } from "./db";
import type { Env } from "./env";
import type { Address } from "@shared/types";
import { safeJson } from "./db";
import { gmailFetch } from "./google";
import { b64urlDecodeBytes, buildRfc822, type OutgoingAttachment } from "./mime";

export type SourceKind = "original" | "reconstructed";

export interface MessageSource {
  bytes: Uint8Array;
  kind: SourceKind;
}

function asBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
}

/** The message rebuilt as RFC822 from what is stored: headers, both bodies, and every attachment that was kept. */
export function rebuildMessage(row: MessageRow, attachments: OutgoingAttachment[]): string {
  const extra: [string, string][] = [["X-Rebuilt-By", "Inbox, from the parts it stored; not the mail server's own copy"]];
  if (row.reply_to) extra.push(["Reply-To", row.reply_to]);
  if (row.list_unsubscribe) extra.push(["List-Unsubscribe", row.list_unsubscribe.replace(/[\r\n]+/g, " ")]);
  return buildRfc822({
    from: { name: row.from_name, email: row.from_email },
    to: safeJson<Address[]>(row.to_json, []),
    cc: safeJson<Address[]>(row.cc_json, []),
    subject: row.subject,
    html: row.html_body,
    text: row.text_body,
    inReplyTo: row.in_reply_to || undefined,
    references: row.references_header || undefined,
    messageId: row.message_id_header || undefined,
    date: row.date,
    attachments,
    extraHeaders: extra,
  });
}

/** The stored attachments of one message, as MIME parts. Inline images are left out; they are part of the HTML. */
async function storedAttachments(env: Env, row: MessageRow): Promise<OutgoingAttachment[]> {
  const rows = await env.DB.prepare(`SELECT id, filename, mime_type FROM attachments WHERE message_id = ? AND is_inline = 0 ORDER BY created_at ASC LIMIT 25`)
    .bind(row.id)
    .all<{ id: string; filename: string; mime_type: string }>();
  const out: OutgoingAttachment[] = [];
  for (const a of rows.results) {
    const blob = await env.DB.prepare(`SELECT data FROM attachment_blobs WHERE attachment_id = ?`).bind(a.id).first<{ data: unknown }>();
    const bytes = asBytes(blob?.data);
    if (bytes) out.push({ filename: a.filename, mime_type: a.mime_type, data_base64: Buffer.from(bytes).toString("base64") });
  }
  return out;
}

export async function messageSource(env: Env, account: AccountRow, row: MessageRow): Promise<MessageSource> {
  if (account.provider === "gmail") {
    try {
      const res = await gmailFetch(env, account, `messages/${encodeURIComponent(row.gmail_message_id)}?format=raw`);
      if (res.ok) {
        const j = (await res.json()) as { raw?: string };
        if (j.raw) return { bytes: b64urlDecodeBytes(j.raw), kind: "original" };
      }
    } catch {
      // Gmail unreachable or the token has lapsed: fall through to the rebuilt copy rather than show nothing.
    }
  }
  const rebuilt = rebuildMessage(row, account.provider === "gmail" ? [] : await storedAttachments(env, row));
  return { bytes: new TextEncoder().encode(rebuilt), kind: "reconstructed" };
}

/** A filename for the download: the subject, made safe, with .eml. */
export function emlFilename(subject: string): string {
  const base = (subject || "message").replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "message"}.eml`;
}
