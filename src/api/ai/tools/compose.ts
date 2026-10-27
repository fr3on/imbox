import { PLAIN_EMAIL } from "../../mime";
import { logActivity } from "../../activity";
import { type AccountRow, type MessageRow, ownedRow, safeJson, uid } from "../../db";
import type { Address } from "@shared/types";
import { sendMail } from "../../send";
import { type Handler, accountById, ownedThreadRow, textToHtml } from "./context";

export const create_draft: Handler = async ({ ctx, input, db, t, ok, fail }) => {
  const mode = String(input.mode ?? "new");
  let acc: AccountRow | null = null;
  let threadId: string | null = null;
  let replyTo: MessageRow | null = null;
  let to: Address[] = [];
  let cc: Address[] = [];
  let subject = String(input.subject ?? "").trim();
  let quoted = "";
  const parseList = (v: unknown): Address[] => (Array.isArray(v) ? v.map((e) => String(e).trim().toLowerCase()).filter((e) => PLAIN_EMAIL.test(e)).map((email) => ({ email, name: "" })) : []);
  if (mode !== "new") {
    threadId = String(input.thread_id ?? "").trim();
    let row = threadId ? await ownedThreadRow(ctx, threadId) : null;
    // The model left the thread out (or got the id wrong): use the one this conversation is about.
    if (!row) {
      for (const hint of ctx.threadHints ?? []) {
        row = await ownedThreadRow(ctx, hint);
        if (row) {
          threadId = hint;
          break;
        }
      }
    }
    if (!row) return fail("No thread to reply to. Pass thread_id: the id from the [[context thread=…]] block, or one from list_threads / read_thread / search_mail.");
    acc = accountById(ctx, row.account_id) ?? null;
    replyTo = await db.prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1`).bind(threadId).first<MessageRow>();
    const me = (acc?.email ?? "").toLowerCase();
    const baseSubject = row.custom_subject || row.subject;
    if (mode === "forward") {
      to = parseList(input.to);
      if (!to.length) return fail("`to` is required for a forward");
      subject = subject || (/^fwd?:/i.test(baseSubject) ? baseSubject : `Fwd: ${baseSubject}`);
      const from = replyTo ? `${replyTo.from_name || replyTo.from_email} <${replyTo.from_email}>` : "";
      quoted = replyTo ? `<p>---------- Forwarded message ----------<br>From: ${from}<br>Date: ${new Date(replyTo.date).toUTCString()}<br>Subject: ${replyTo.subject}</p>${replyTo.html_body || textToHtml(replyTo.text_body)}` : "";
    } else {
      if (!replyTo) return fail("Nothing to reply to");
      const sender: Address = { email: replyTo.from_email, name: replyTo.from_name };
      const isMe = sender.email.toLowerCase() === me;
      to = isMe ? safeJson<Address[]>(replyTo.to_json, []) : [sender];
      if (mode === "reply_all") {
        const others = [...safeJson<Address[]>(replyTo.to_json, []), ...safeJson<Address[]>(replyTo.cc_json, [])].filter((a) => a.email.toLowerCase() !== me && !to.some((x) => x.email === a.email));
        cc = others;
      }
      subject = subject || (/^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`);
    }
  } else {
    to = parseList(input.to);
    cc = parseList(input.cc);
    if (!to.length) return fail("`to` is required for a new message");
    if (!subject) return fail("`subject` is required for a new message");
    acc = (input.account_id && accountById(ctx, String(input.account_id))) || ctx.accounts[0] || null;
  }
  if (!acc) return fail("No account to send from");
  const bodyText = String(input.body_text ?? "").trim();
  if (!bodyText) return fail("body_text is required");
  const html = textToHtml(bodyText) + (acc.signature ? `<p>${acc.signature}</p>` : "") + quoted;
  const id = uid();
  await db
    .prepare(`INSERT INTO drafts (id, account_id, thread_id, reply_to_message_id, to_json, cc_json, bcc_json, subject, body_html, send_at, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, NULL, 'draft', NULL, ?, ?)`)
    .bind(id, acc.id, threadId, replyTo?.id ?? null, JSON.stringify(to), JSON.stringify(cc), subject.slice(0, 500), html.slice(0, 500_000), t, t)
    .run();
  const draft = { draft_id: id, account_id: acc.id, from: acc.email, thread_id: threadId, to, cc, subject, body_text: bodyText };
  ctx.emit({ type: "draft", draft });
  return ok({ ...draft, note: ctx.autoSend ? "You may call send_draft." : "The user will review and press Send." }, `Drafted “${subject}” to ${to.map((a) => a.email).join(", ")}`);
};

export const send_draft: Handler = async ({ ctx, input, db, ok, fail }) => {
  const id = String(input.draft_id ?? "");
  const row = await ownedRow<any>(db, "drafts", id, ctx.user.id);
  if (!row) return fail("Draft not found");
  if (!ctx.autoSend) return ok({ needs_confirmation: true, draft_id: id }, "Waiting for the user to press Send");
  const acc = accountById(ctx, row.account_id);
  if (!acc) return fail("Account not found");
  const r = await sendMail(ctx.env, acc, { thread_id: row.thread_id, reply_to_message_id: row.reply_to_message_id, to: safeJson(row.to_json, []), cc: safeJson(row.cc_json, []), bcc: safeJson(row.bcc_json, []), subject: row.subject, body_html: row.body_html, autoSubmitted: ctx.autoSubmitted });
  await db.prepare(`DELETE FROM drafts WHERE id = ?`).bind(id).run();
  await logActivity(db, ctx.user.id, { actor: "ai", kind: "send", summary: `Sent \u201c${row.subject || "(no subject)"}\u201d for you`, why: "The assistant sent it, because Send without asking is on", threadId: r.thread_id, accountId: acc.id });
  ctx.emit({ type: "sent", draft_id: id, thread_id: r.thread_id });
  return ok({ ok: true, thread_id: r.thread_id }, `Sent “${row.subject}”`);
};
