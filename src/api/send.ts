import type { Env } from "./env";
import { logActivity } from "./activity";
import type { AccountRow, MessageRow, ThreadRow } from "./db";
import { now, safeJson } from "./db";
import { gmailJson, gmailPost } from "./google";
import { buildRawMime, buildMimeBase64, buildRfc822, oneLine, type GmailMessage, type OutgoingAttachment } from "./mime";
import { graphFetch, MicrosoftError } from "./microsoft";
import { htmlToText } from "./sanitize";
import { ingestMessages, ingestParsed } from "./ingest";
import { uid } from "./db";
import { Budget, UNLIMITED } from "./jobs";
import { fetchTimeout, TIMEOUT } from "./http";
import type { Address } from "@shared/types";
import type { ParsedMessage } from "./mime";

export interface SendParams {
  thread_id?: string | null;
  reply_to_message_id?: string | null;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  body_html: string;
  attachments?: OutgoingAttachment[];
  /** Sent by an agent rather than typed by a person; marked so nothing else auto-replies to it. */
  autoSubmitted?: boolean;
}

export async function sendMail(env: Env, account: AccountRow, p: SendParams): Promise<{ thread_id: string; message_id: string }> {
  const db = env.DB;
  let thread: ThreadRow | null = null;
  let replyTo: MessageRow | null = null;
  if (p.thread_id) {
    thread = await db.prepare(`SELECT * FROM threads WHERE id = ? AND account_id = ?`).bind(p.thread_id, account.id).first<ThreadRow>();
    if (!thread) throw new Error("thread_not_found");
    if (p.reply_to_message_id) {
      replyTo = await db.prepare(`SELECT * FROM messages WHERE id = ? AND account_id = ?`).bind(p.reply_to_message_id, account.id).first<MessageRow>();
    }
    if (!replyTo) {
      replyTo = await db
        .prepare(`SELECT * FROM messages WHERE thread_id = ? AND account_id = ? ORDER BY date DESC LIMIT 1`)
        .bind(thread.id, account.id)
        .first<MessageRow>();
    }
  }
  let subject = (p.subject ?? "").trim();
  if (!subject && thread) subject = `Re: ${thread.subject}`;
  subject = oneLine(subject);
  let inReplyTo = "";
  let references = "";
  if (replyTo) {
    inReplyTo = replyTo.message_id_header;
    references = [replyTo.references_header, replyTo.message_id_header].filter(Boolean).join(" ");
  }
  const from: Address = { email: account.email, name: account.display_name };
  const ctx: DomainSendCtx = { thread, replyTo, subject, inReplyTo, references, from };
  if (account.provider === "domain") return sendFromDomainMailbox(env, account, p, ctx);
  if (account.provider === "outlook") return sendFromOutlook(env, account, p, ctx);
  if (account.provider === "imap") return sendFromImapMailbox(env, account, p, ctx);
  const raw = buildRawMime({
    from,
    to: p.to,
    cc: p.cc ?? [],
    bcc: p.bcc ?? [],
    subject,
    html: p.body_html,
    text: htmlToText(p.body_html),
    inReplyTo,
    references,
    attachments: p.attachments ?? [],
    autoSubmitted: p.autoSubmitted,
  });
  const body: Record<string, string> = { raw };
  if (thread) body.threadId = thread.gmail_thread_id;
  const sent = await gmailPost<{ id: string; threadId: string }>(env, account, `messages/send`, body, TIMEOUT.transfer);

  // Pull the sent message back so it appears locally right away.
  let localThreadId = thread?.id ?? "";
  let localMessageId = "";
  try {
    const full = await gmailJson<GmailMessage>(env, account, `messages/${sent.id}?format=full`);
    await ingestMessages(env, account, [full]);
    const row = await db
      .prepare(`SELECT id, thread_id FROM messages WHERE account_id = ? AND gmail_message_id = ?`)
      .bind(account.id, sent.id)
      .first<{ id: string; thread_id: string }>();
    if (row) {
      localMessageId = row.id;
      localThreadId = row.thread_id;
    }
  } catch {
    // The cron sync will pick it up.
  }
  if (localThreadId) {
    await db
      .prepare(`UPDATE threads SET reply_later = 0, reply_later_at = NULL, seen = 1, unread = 0, updated_at = ? WHERE id = ? AND account_id = ?`)
      .bind(now(), localThreadId, account.id)
      .run();
  }
  return { thread_id: localThreadId, message_id: localMessageId };
}

/**
 * The References header for a message that goes out under an ID we made up. Some senders replace that ID on the way (Resend, which runs on Amazon SES, does),
 * so the reply names an ID we never stored and would start a thread of its own. They leave References alone, so our ID goes there as well, and a reply
 * carries it back to the message we kept.
 */
export const referencesWithOwnId = (references: string, messageId: string): string => [references, messageId].filter(Boolean).join(" ");

// ---------- Custom-domain mailboxes: Resend ----------
interface DomainSendCtx {
  thread: ThreadRow | null;
  replyTo: MessageRow | null;
  subject: string;
  inReplyTo: string;
  references: string;
  from: Address;
}

const fmt = (a: Address) => {
  const email = oneLine(a.email).replace(/[\s<>,;"]/g, "");
  const name = oneLine(a.name).replace(/[<>"]/g, "");
  return name ? `${name} <${email}>` : email;
};

async function sendFromDomainMailbox(env: Env, account: AccountRow, p: SendParams, ctx: DomainSendCtx): Promise<{ thread_id: string; message_id: string }> {
  const domain = account.email.split("@")[1] || "localhost";
  const messageId = `<${uid()}@${domain}>`;
  const text = htmlToText(p.body_html);
  const headers: Record<string, string> = { "Message-ID": messageId };
  if (ctx.inReplyTo) headers["In-Reply-To"] = ctx.inReplyTo;
  headers["References"] = referencesWithOwnId(ctx.references, messageId);
  const to = p.to.map(fmt);
  const cc = (p.cc ?? []).map(fmt);
  const bcc = (p.bcc ?? []).map(fmt);

  if (env.RESEND_API_KEY) {
    const res = await fetchTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: fmt(ctx.from),
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: ctx.subject,
        html: p.body_html,
        text,
        headers,
        attachments: (p.attachments ?? []).map((a) => ({ filename: a.filename, content: a.data_base64 })),
      }),
    }, TIMEOUT.transfer);
    if (!res.ok) throw new Error(`resend_failed: ${(await res.text()).slice(0, 300)}`);
  } else {
    throw new Error("sending_not_configured");
  }

  return recordSentMessage(env, account, p, ctx, messageId, text);
}

/**
 * Store a message we just handed to a transport that gives us nothing to read back (Resend, Graph `sendMail`), so it appears in the thread immediately. The Gmail path instead
 * re-fetches the real message by id.
 */
async function recordSentMessage(
  env: Env,
  account: AccountRow,
  p: SendParams,
  ctx: DomainSendCtx,
  messageId: string,
  text: string
): Promise<{ thread_id: string; message_id: string }> {
  const db = env.DB;
  const t = now();
  const parsed: ParsedMessage = {
    gmailId: messageId,
    threadId: ctx.thread?.gmail_thread_id ?? uid(),
    labelIds: ["SENT"],
    snippet: text.replace(/\s+/g, " ").trim().slice(0, 200),
    internalDate: t,
    sizeEstimate: p.body_html.length,
    headers: {},
    from: ctx.from,
    to: p.to,
    cc: p.cc ?? [],
    bcc: p.bcc ?? [],
    replyTo: "",
    subject: ctx.subject,
    date: t,
    messageId,
    inReplyTo: ctx.inReplyTo,
    references: ctx.references,
    listUnsubscribe: "",
    listId: "",
    precedence: "",
    autoSubmitted: "",
    text,
    html: p.body_html,
    attachments: [],
  };
  await ingestParsed(env, account, [parsed]);
  const row = await db.prepare(`SELECT id, thread_id FROM messages WHERE account_id = ? AND gmail_message_id = ?`).bind(account.id, messageId).first<{ id: string; thread_id: string }>();
  const localThreadId = row?.thread_id ?? ctx.thread?.id ?? "";
  if (localThreadId) {
    await db
      .prepare(`UPDATE threads SET reply_later = 0, reply_later_at = NULL, seen = 1, unread = 0, updated_at = ? WHERE id = ? AND account_id = ?`)
      .bind(now(), localThreadId, account.id)
      .run();
  }
  return { thread_id: localThreadId, message_id: row?.id ?? "" };
}

// ---------- Outlook: Microsoft Graph ----------

/**
 * Graph accepts a whole RFC822 message as base64 with `Content-Type: text/plain`, derives the
 * envelope from the headers (Bcc included, which it strips before delivery) and files the result in
 * Sent Items itself — the same end state Gmail sending reaches. It answers 202 with an empty body,
 * so there is nothing to read back and we record the message locally instead.
 */
async function sendFromOutlook(env: Env, account: AccountRow, p: SendParams, ctx: DomainSendCtx): Promise<{ thread_id: string; message_id: string }> {
  const domain = account.email.split("@")[1] || "outlook.com";
  const messageId = `<${uid()}@${domain}>`;
  const text = htmlToText(p.body_html);
  const mime = buildMimeBase64({
    from: ctx.from,
    to: p.to,
    cc: p.cc ?? [],
    bcc: p.bcc ?? [],
    subject: ctx.subject,
    html: p.body_html,
    text,
    inReplyTo: ctx.inReplyTo,
    references: referencesWithOwnId(ctx.references, messageId),
    attachments: p.attachments ?? [],
    autoSubmitted: p.autoSubmitted,
    messageId,
  });
  const res = await graphFetch(env, account, "sendMail", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: mime,
  }, TIMEOUT.transfer);
  if (!res.ok) {
    const body = await res.text();
    throw new MicrosoftError(res.status, body, `outlook_send_failed: ${body.slice(0, 300)}`);
  }
  return recordSentMessage(env, account, p, ctx, messageId, text);
}

// ---------- Third-party mailboxes: the provider's own SMTP server ----------

/**
 * Sending through the mailbox's own SMTP server means the provider signs DKIM for us, so
 * deliverability is theirs rather than something this app has to solve.
 *
 * Unlike the API transports, SMTP takes recipients from the *envelope*: Bcc must be a RCPT TO and
 * must not appear in the headers, or every recipient sees it.
 */
async function sendFromImapMailbox(env: Env, account: AccountRow, p: SendParams, ctx: DomainSendCtx): Promise<{ thread_id: string; message_id: string }> {
  const { sendViaImapAccount } = await import("./imapbox");
  const domain = account.email.split("@")[1] || "localhost";
  const messageId = `<${uid()}@${domain}>`;
  const text = htmlToText(p.body_html);
  const raw = buildRfc822(
    {
      from: ctx.from,
      to: p.to,
      cc: p.cc ?? [],
      bcc: p.bcc ?? [],
      subject: ctx.subject,
      html: p.body_html,
      text,
      inReplyTo: ctx.inReplyTo,
      references: referencesWithOwnId(ctx.references, messageId),
      attachments: p.attachments ?? [],
    autoSubmitted: p.autoSubmitted,
      messageId,
    },
    { includeBcc: false }
  );
  const recipients = [...p.to, ...(p.cc ?? []), ...(p.bcc ?? [])].map((a) => a.email).filter(Boolean);
  await sendViaImapAccount(env, account, { from: account.email, recipients, raw });
  return recordSentMessage(env, account, p, ctx, messageId, text);
}

/** A scheduled send that has been "sending" this long was cut off (the process stopped, or the mail server never answered). */
const STALE_SENDING_MS = 10 * 60_000;

export async function processScheduledSends(env: Env, budget: Budget = UNLIMITED): Promise<number> {
  const db = env.DB;
  const t = now();
  // A send that was claimed and never finished would sit in 'sending' for ever: not due, not failed, nowhere on the screen. It is not retried on its own,
  // because the mail may well have gone out and a second copy to the recipient is worse than a late one; it is marked failed so the person sees it
  // in Scheduled and can check Sent before sending again.
  await db
    .prepare(`UPDATE drafts SET status = 'failed', error = ?, updated_at = ? WHERE status = 'sending' AND send_at IS NOT NULL AND updated_at < ?`)
    .bind("Sending was interrupted, so it is not known whether this went out. Check Sent before sending it again.", t, t - STALE_SENDING_MS)
    .run();
  const due = await db
    .prepare(`SELECT d.*, a.id AS acc_id FROM drafts d JOIN accounts a ON a.id = d.account_id WHERE d.status = 'scheduled' AND d.send_at IS NOT NULL AND d.send_at <= ? LIMIT 10`)
    .bind(t)
    .all<any>();
  let sent = 0;
  for (const d of due.results) {
    if (budget.spent) break; // the rest are still scheduled and go out next minute
    const claimed = await db.prepare(`UPDATE drafts SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'scheduled'`).bind(t, d.id).run();
    if (!claimed.meta.changes) continue;
    const account = await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(d.account_id).first<AccountRow>();
    if (!account) continue;
    try {
      await sendMail(env, account, {
        thread_id: d.thread_id,
        reply_to_message_id: d.reply_to_message_id,
        to: safeJson<Address[]>(d.to_json, []),
        cc: safeJson<Address[]>(d.cc_json, []),
        bcc: safeJson<Address[]>(d.bcc_json, []),
        subject: d.subject,
        body_html: d.body_html,
      });
      await db.prepare(`DELETE FROM drafts WHERE id = ?`).bind(d.id).run();
      await logActivity(db, account.user_id, { actor: "you", kind: "send", summary: `Sent \u201c${d.subject || "(no subject)"}\u201d`, why: `Scheduled, sent from ${account.email}`, threadId: d.thread_id, accountId: account.id });
      sent++;
    } catch (e) {
      await db
        .prepare(`UPDATE drafts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
        .bind(((e as Error).message ?? "send failed").slice(0, 1000), now(), d.id)
        .run();
    }
  }
  return sent;
}
