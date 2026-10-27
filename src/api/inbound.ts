// Inbound mail for custom-domain mailboxes: a mail server or forwarder POSTs the raw message to /inbound/mail → parse → ingest.
import PostalMime from "postal-mime";
import { parseAuthResults } from "./authresults";
import type { Env } from "./env";
import { pushForAccount } from "./push";
import type { AccountRow, DomainRow } from "./db";
import { uid, now, logSync } from "./db";
import { ingestParsed } from "./ingest";
import { parseAddressList, stripSubjectPrefixes, type ParsedMessage, type ParsedAttachment } from "./mime";
import { htmlToText } from "./sanitize";
import type { Address } from "@shared/types";

const MAX_RAW = 25 * 1024 * 1024;
const MAX_BLOB = 900 * 1024;

function addr(a: { name?: string; address?: string } | undefined | null): Address {
  return { email: (a?.address ?? "").toLowerCase().trim(), name: (a?.name ?? "").trim() };
}
function addrs(list: { name?: string; address?: string }[] | undefined): Address[] {
  return (list ?? []).map(addr).filter((a) => a.email);
}

function toArrayBuffer(content: unknown): ArrayBuffer | null {
  if (!content) return null;
  if (content instanceof ArrayBuffer) return content;
  if (ArrayBuffer.isView(content)) {
    const v = content as ArrayBufferView;
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  }
  if (typeof content === "string") return new TextEncoder().encode(content).buffer as ArrayBuffer;
  return null;
}

/** Resolve which mailbox should receive mail addressed to `rcpt`. */
export async function resolveMailbox(db: Db, rcpt: string): Promise<AccountRow | null> {
  const email = rcpt.toLowerCase().trim();
  const direct = await db.prepare(`SELECT * FROM accounts WHERE provider = 'domain' AND email = ? LIMIT 1`).bind(email).first<AccountRow>();
  if (direct) return direct;
  const domain = email.split("@")[1] ?? "";
  if (!domain) return null;
  const d = await db.prepare(`SELECT * FROM domains WHERE name = ?`).bind(domain).first<DomainRow>();
  if (!d?.catch_all_account_id) return null;
  return (await db.prepare(`SELECT * FROM accounts WHERE id = ? AND provider = 'domain'`).bind(d.catch_all_account_id).first<AccountRow>()) ?? null;
}

/** A reply is searched for by subject only within this long before it. */
const SUBJECT_MATCH_WINDOW_MS = 30 * 24 * 3600_000;

/**
 * Find the local thread key (threads.gmail_thread_id) for a reply: first by In-Reply-To / References, which is exact; then, for a reply whose IDs name nothing
 * we kept, by subject and people. The second step is for mail we sent ourselves: the sender in between may have replaced our Message-ID, so the reply
 * names an ID we never stored. It only applies to something that is plainly a reply (it names a parent, and its subject says Re:), only to a thread with the
 * same subject, and only when the replier already took part in that thread.
 */
async function threadKeyFor(db: Db, accountId: string, p: Pick<ParsedMessage, "inReplyTo" | "references" | "subject" | "from" | "date">): Promise<string | null> {
  const ids = [...new Set([p.inReplyTo, ...p.references.split(/\s+/)].map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  if (!ids.length) return null;
  const row = await db
    .prepare(`SELECT t.gmail_thread_id FROM messages m JOIN threads t ON t.id = m.thread_id WHERE m.account_id = ? AND m.message_id_header IN (${ids.map(() => "?").join(",")}) ORDER BY m.date DESC LIMIT 1`)
    .bind(accountId, ...ids)
    .first<{ gmail_thread_id: string }>();
  if (row) return row.gmail_thread_id;

  const subject = stripSubjectPrefixes(p.subject);
  const email = (p.from?.email ?? "").trim().toLowerCase();
  if (!subject || !email || subject === (p.subject ?? "").trim()) return null; // not a reply by its subject
  const when = Number.isFinite(p.date) && p.date > 0 ? p.date : Date.now();
  const byPeople = await db
    .prepare(
      `SELECT t.gmail_thread_id FROM threads t
       WHERE t.account_id = ? AND t.merged_into IS NULL AND lower(t.subject) = lower(?) AND t.last_message_at >= ?
         AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.account_id = t.account_id
                     AND (lower(m.from_email) = ? OR strpos(lower(m.to_json), ?) > 0 OR strpos(lower(m.cc_json), ?) > 0))
       ORDER BY t.last_message_at DESC LIMIT 1`
    )
    .bind(accountId, subject, when - SUBJECT_MATCH_WINDOW_MS, email, email, email)
    .first<{ gmail_thread_id: string }>();
  return byPeople?.gmail_thread_id ?? null;
}

export async function parseInbound(raw: ReadableStream<Uint8Array> | ArrayBuffer | string, envelopeFrom: string, envelopeTo: string): Promise<Omit<ParsedMessage, "threadId">> {
  const email: any = await PostalMime.parse(raw as any);
  const headers: Record<string, string> = {};
  for (const h of email.headers ?? []) {
    const k = String(h.key).toLowerCase();
    // The topmost Authentication-Results is the one our own server added; any below it came with the message and could say anything.
    if (k === "authentication-results" && k in headers) continue;
    headers[k] = String(h.value ?? "");
  }
  const from = email.from?.address ? addr(email.from) : { email: envelopeFrom.toLowerCase(), name: "" };
  let to = addrs(email.to);
  if (!to.length) to = parseAddressList(envelopeTo);
  const date = email.date ? Date.parse(email.date) : NaN;
  const html: string = email.html ?? "";
  const text: string = email.text ?? (html ? htmlToText(html) : "");
  const attachments: ParsedAttachment[] = [];
  for (const a of email.attachments ?? []) {
    const buf = toArrayBuffer(a.content);
    const size = buf?.byteLength ?? 0;
    const contentId = String(a.contentId ?? "").replace(/^<|>$/g, "");
    attachments.push({
      attachmentId: uid(),
      filename: a.filename || (contentId ? `inline-${contentId}` : `attachment-${attachments.length + 1}`),
      mimeType: a.mimeType || "application/octet-stream",
      size,
      contentId,
      isInline: a.disposition === "inline" || (!!contentId && a.disposition !== "attachment"),
      blob: buf && size <= MAX_BLOB ? buf : undefined,
    });
  }
  const messageId = String(email.messageId ?? headers["message-id"] ?? "").trim();
  const snippetSrc = (text || htmlToText(html)).replace(/\s+/g, " ").trim();
  return {
    gmailId: messageId || `inbound-${uid()}`,
    labelIds: ["UNREAD"],
    snippet: snippetSrc.slice(0, 200),
    internalDate: Number.isNaN(date) ? now() : date,
    sizeEstimate: 0,
    headers,
    from,
    to,
    cc: addrs(email.cc),
    bcc: addrs(email.bcc),
    replyTo: addrs(email.replyTo)[0]?.email ?? "",
    subject: String(email.subject ?? ""),
    date: Number.isNaN(date) ? now() : date,
    messageId,
    inReplyTo: String(email.inReplyTo ?? headers["in-reply-to"] ?? "").trim(),
    references: String(email.references ?? headers["references"] ?? "").trim(),
    listUnsubscribe: headers["list-unsubscribe"] ?? "",
    listId: headers["list-id"] ?? "",
    precedence: headers["precedence"] ?? "",
    autoSubmitted: headers["auto-submitted"] ?? "",
    authResults: parseAuthResults(headers["authentication-results"]),
    text,
    html,
    attachments,
  };
}

/** Store an already-parsed inbound message into a mailbox (dedupes on Message-ID). */
export async function deliverInbound(env: Env, account: AccountRow, parsed: Omit<ParsedMessage, "threadId">): Promise<{ added: number; threadIds: string[] }> {
  const db = env.DB;
  if (parsed.messageId) {
    const dup = await db.prepare(`SELECT id FROM messages WHERE account_id = ? AND (message_id_header = ? OR gmail_message_id = ?) LIMIT 1`).bind(account.id, parsed.messageId, parsed.gmailId).first();
    if (dup) return { added: 0, threadIds: [] };
  }
  const threadId = (await threadKeyFor(db, account.id, parsed)) ?? uid();
  const full: ParsedMessage = { ...parsed, threadId };
  const r = await ingestParsed(env, account, [full]);
  await db.prepare(`UPDATE accounts SET last_synced_at = ? WHERE id = ?`).bind(now(), account.id).run();
  // Tell a subscribed device straight away rather than at the next minute's pass. A failure here never fails the delivery.
  if (r.added > 0) await pushForAccount(env, account.id, account.user_id).catch(() => {});
  return r;
}

export type InboundResult = { status: 202; stored: boolean } | { status: 404 | 413 | 503; error: string };

/**
 * Receive one raw message for one recipient. The status is what the sending server acts on: 202 means it is done with the message (stored, or already
 * had it), 404 and 413 are permanent so it should bounce, and 503 is temporary so it should try again later.
 */
export async function receiveInbound(env: Env, input: { from: string; to: string; raw: ArrayBuffer }): Promise<InboundResult> {
  const db = env.DB;
  if (input.raw.byteLength > MAX_RAW) return { status: 413, error: "Message too large" };
  const mailbox = await resolveMailbox(db, input.to);
  if (!mailbox) return { status: 404, error: "No such mailbox" };
  try {
    const parsed = await parseInbound(input.raw, input.from, input.to);
    const r = await deliverInbound(env, mailbox, parsed);
    await logSync(db, mailbox.id, "info", `Inbound from ${parsed.from.email}: ${r.added ? "stored" : "duplicate"} (${parsed.subject.slice(0, 80)})`);
    return { status: 202, stored: r.added > 0 };
  } catch (e) {
    await logSync(db, mailbox.id, "error", `Inbound failed from ${input.from}: ${(e as Error).message}`);
    return { status: 503, error: "Temporary failure, try again later" };
  }
}
