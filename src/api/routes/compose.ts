import { Hono } from "hono";
import type { AppEnv } from "../env";
import { uid, now, safeJson, inClause, ownedRow, ownedAccount, accountForThread } from "../db";
import type { AccountRow } from "../db";
import { creationAccountId } from "./labels";
import { sendMail } from "../send";
import { logActivity } from "../activity";
import type { Address, Draft } from "@shared/types";
import { PLAIN_EMAIL, oneLine, safeMimeType, type OutgoingAttachment } from "../mime";
import { isId } from "../input";

const compose = new Hono<AppEnv>();

/** Most recipients one message may have across To, Cc and Bcc. A body of a few megabytes could otherwise name tens of thousands. */
const MAX_RECIPIENTS = 200;
/** Gmail takes 25 MB of message; base64 is a third bigger than the bytes. Past this the provider would refuse it anyway, after we had held it all in memory. */
const MAX_ATTACHMENT_CHARS = 35_000_000;
/** The furthest ahead a message may be scheduled. */
const MAX_SCHEDULE_MS = 366 * 86_400_000;

/** A send still marked in progress after this long is taken to be dead, and a retry may take over. */
const SEND_STALE_MS = 150_000;

function mapDraft(r: any): Draft {
  return {
    id: r.id,
    account_id: r.account_id,
    thread_id: r.thread_id,
    reply_to_message_id: r.reply_to_message_id,
    to: safeJson<Address[]>(r.to_json, []),
    cc: safeJson<Address[]>(r.cc_json, []),
    bcc: safeJson<Address[]>(r.bcc_json, []),
    subject: r.subject,
    body_html: r.body_html,
    send_at: r.send_at,
    status: r.status,
    error: r.error,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function cleanAddrs(list: unknown): Address[] {
  if (!Array.isArray(list)) return [];
  const out: Address[] = [];
  for (const x of list) {
    if (out.length >= MAX_RECIPIENTS * 2) break;
    if (typeof x === "string") {
      const e = x.trim().toLowerCase();
      if (PLAIN_EMAIL.test(e)) out.push({ email: e, name: "" });
    } else if (x && typeof x === "object" && typeof (x as any).email === "string") {
      const e = (x as any).email.trim().toLowerCase();
      if (PLAIN_EMAIL.test(e)) out.push({ email: e, name: oneLine(String((x as any).name ?? "")).slice(0, 200) });
    }
  }
  return out;
}

compose.get("/drafts", async (c) => {
  const sc = inClause(c.get("accountIds"));
  const rows = await c.env.DB.prepare(`SELECT * FROM drafts WHERE account_id IN ${sc.sql} AND status IN ('draft','scheduled','failed') ORDER BY updated_at DESC LIMIT 200`).bind(...sc.params).all<any>();
  return c.json(rows.results.map(mapDraft));
});

compose.post("/drafts", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const accountId = await creationAccountId(c, b);
  if (!accountId) return c.json({ error: "invalid_account" }, 400);
  const id = uid();
  const t = now();
  const row = await c.env.DB.prepare(
    `INSERT INTO drafts (id, account_id, thread_id, reply_to_message_id, to_json, cc_json, bcc_json, subject, body_html, send_at, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', NULL, ?, ?) RETURNING *`
  )
    .bind(id, accountId, isId(b.thread_id) ? b.thread_id : null, isId(b.reply_to_message_id) ? b.reply_to_message_id : null, JSON.stringify(cleanAddrs(b.to)), JSON.stringify(cleanAddrs(b.cc)), JSON.stringify(cleanAddrs(b.bcc)), String(b.subject ?? "").slice(0, 500), String(b.body_html ?? "").slice(0, 500_000), t, t)
    .first<any>();
  return c.json(mapDraft(row));
});

compose.patch("/drafts/:id", async (c) => {
  const row = await ownedRow<any>(c.env.DB, "drafts", c.req.param("id"), c.get("user").id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const b = await c.req.json<any>().catch(() => ({}));
  // Optionally move the draft to another owned account (changing the From).
  let accountId: string = row.account_id;
  if (typeof b.account_id === "string" && b.account_id && b.account_id !== row.account_id) {
    const a = await ownedAccount(c.env.DB, c.get("user").id, b.account_id);
    if (!a) return c.json({ error: "invalid_account" }, 400);
    accountId = a.id;
  }
  const fresh = await c.env.DB.prepare(`UPDATE drafts SET account_id = ?, thread_id = ?, reply_to_message_id = ?, to_json = ?, cc_json = ?, bcc_json = ?, subject = ?, body_html = ?, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(
      accountId,
      b.thread_id !== undefined ? (isId(b.thread_id) ? b.thread_id : null) : row.thread_id,
      b.reply_to_message_id !== undefined ? (isId(b.reply_to_message_id) ? b.reply_to_message_id : null) : row.reply_to_message_id,
      b.to !== undefined ? JSON.stringify(cleanAddrs(b.to)) : row.to_json,
      b.cc !== undefined ? JSON.stringify(cleanAddrs(b.cc)) : row.cc_json,
      b.bcc !== undefined ? JSON.stringify(cleanAddrs(b.bcc)) : row.bcc_json,
      b.subject !== undefined ? String(b.subject).slice(0, 500) : row.subject,
      b.body_html !== undefined ? String(b.body_html).slice(0, 500_000) : row.body_html,
      now(),
      row.id
    )
    .first<any>();
  return c.json(mapDraft(fresh));
});

compose.delete("/drafts/:id", async (c) => {
  const row = await ownedRow<any>(c.env.DB, "drafts", c.req.param("id"), c.get("user").id);
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`DELETE FROM drafts WHERE id = ?`).bind(row.id).run();
  return c.json({ ok: true });
});

compose.post("/send", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const b = await c.req.json<any>().catch(() => ({}));
  const threadId = isId(b.thread_id) ? b.thread_id : null;
  const replyToId = isId(b.reply_to_message_id) ? b.reply_to_message_id : null;
  const draftId = isId(b.draft_id) ? b.draft_id : null;
  // From account: body.account_id (owned) → the thread's account for replies → primary.
  let acc: AccountRow | null = null;
  if (typeof b.account_id === "string" && b.account_id) {
    acc = await ownedAccount(db, user.id, b.account_id);
    if (!acc) return c.json({ error: "invalid_account" }, 400);
  } else if (threadId) {
    acc = await accountForThread(db, user.id, threadId);
    if (!acc) return c.json({ error: "thread_not_found" }, 404);
  } else {
    acc = c.get("account");
  }
  if (!acc) return c.json({ error: "no_account" }, 400);
  if (acc.sync_status === "disconnected") return c.json({ error: "account_disconnected" }, 400);
  // A reply must go out from the account that owns the thread (Gmail threadId is account-specific).
  if (threadId) {
    const owner = await accountForThread(db, user.id, threadId);
    if (!owner) return c.json({ error: "thread_not_found" }, 404);
    if (owner.id !== acc.id) return c.json({ error: "reply_from_other_account" }, 400);
  }
  const to = cleanAddrs(b.to);
  const cc = cleanAddrs(b.cc);
  const bcc = cleanAddrs(b.bcc);
  if (!to.length && !cc.length && !bcc.length) return c.json({ error: "no_recipients" }, 400);
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) return c.json({ error: "too_many_recipients", message: `At most ${MAX_RECIPIENTS} recipients per message.` }, 400);
  const subject = oneLine(String(b.subject ?? "")).slice(0, 500);
  const body_html = String(b.body_html ?? "").slice(0, 500_000);
  // A time that is not a time is refused; read as "now", the message would go out at once.
  let sendAt: number | null = null;
  if (b.send_at !== undefined && b.send_at !== null && b.send_at !== 0 && b.send_at !== "") {
    sendAt = typeof b.send_at === "number" || typeof b.send_at === "string" ? Number(b.send_at) : NaN;
    if (!Number.isFinite(sendAt) || sendAt < 0) return c.json({ error: "invalid_send_at", message: "send_at must be a time in milliseconds." }, 400);
    if (sendAt > now() + MAX_SCHEDULE_MS) return c.json({ error: "send_at_too_far", message: "A message can be scheduled at most a year ahead." }, 400);
  }
  const attachments: OutgoingAttachment[] = Array.isArray(b.attachments)
    ? b.attachments
        .filter((a: any) => a && typeof a.data_base64 === "string")
        .slice(0, 10)
        .map((a: any) => ({ filename: String(a.filename ?? "attachment").slice(0, 200), mime_type: safeMimeType(String(a.mime_type ?? "")), data_base64: a.data_base64 as string }))
    : [];
  if (attachments.reduce((n, a) => n + a.data_base64.length, 0) > MAX_ATTACHMENT_CHARS) return c.json({ error: "attachments_too_large", message: "The attachments are too large to send." }, 413);

  if (sendAt && sendAt > now() + 30_000) {
    if (attachments.length) return c.json({ error: "scheduled_send_no_attachments" }, 400);
    let id = uid();
    if (draftId) {
      // Reuse the draft id only if it is ours (or doesn't exist yet).
      const existing = await db.prepare(`SELECT account_id FROM drafts WHERE id = ?`).bind(draftId).first<{ account_id: string }>();
      if (!existing || (c.get("allAccountIds") ?? []).includes(existing.account_id)) id = draftId;
    }
    const t = now();
    // The upsert only changes a draft that is in one of the person's mailboxes, whatever happened between the look above and now.
    const ownMarks = inClause(c.get("allAccountIds") ?? []);
    await db
      .prepare(
        `INSERT INTO drafts (id, account_id, thread_id, reply_to_message_id, to_json, cc_json, bcc_json, subject, body_html, send_at, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, thread_id = excluded.thread_id, reply_to_message_id = excluded.reply_to_message_id, to_json = excluded.to_json, cc_json = excluded.cc_json, bcc_json = excluded.bcc_json, subject = excluded.subject, body_html = excluded.body_html, send_at = excluded.send_at, status = 'scheduled', error = NULL, updated_at = excluded.updated_at
         WHERE drafts.account_id IN ${ownMarks.sql}`
      )
      .bind(id, acc.id, threadId, replyToId, JSON.stringify(to), JSON.stringify(cc), JSON.stringify(bcc), subject, body_html, sendAt, t, t, ...ownMarks.params)
      .run();
    return c.json({ ok: true, scheduled: true, draft_id: id, send_at: sendAt, account_id: acc.id });
  }

  // The browser makes one id per send and repeats it on a retry. The first request to arrive sends; a repeat gets the first one's result, or is
  // told to wait while that one is still going, so a lost reply can never turn into a second copy of the message.
  const clientId = typeof b.client_id === "string" && /^[\w-]{8,64}$/.test(b.client_id) ? b.client_id : "";
  if (clientId) {
    const t = now();
    const mine = await db.prepare(`INSERT INTO send_attempts (user_id, client_id, status, created_at) VALUES (?, ?, 'sending', ?) ON CONFLICT(user_id, client_id) DO NOTHING`).bind(user.id, clientId, t).run();
    if (!mine.meta.changes) {
      const prior = await db.prepare(`SELECT status, result_json, created_at FROM send_attempts WHERE user_id = ? AND client_id = ?`).bind(user.id, clientId).first<{ status: string; result_json: string | null; created_at: number }>();
      if (prior?.status === "sent") return c.json({ ...safeJson<Record<string, unknown>>(prior.result_json ?? "{}", {}), ok: true, repeat: true });
      // Still going. If it has been a couple of minutes the first request is gone, so this one takes over.
      if (prior && t - prior.created_at < SEND_STALE_MS) return c.json({ error: "already_sending", message: "This message is already being sent." }, 409);
      // Taking over is one statement that only succeeds if the record is still the dead one (or was removed after a failure): of several retries that arrive together, one takes it.
      const took = prior
        ? await db.prepare(`UPDATE send_attempts SET status = 'sending', created_at = ? WHERE user_id = ? AND client_id = ? AND status = 'sending' AND created_at = ?`).bind(t, user.id, clientId, prior.created_at).run()
        : await db.prepare(`INSERT INTO send_attempts (user_id, client_id, status, created_at) VALUES (?, ?, 'sending', ?) ON CONFLICT(user_id, client_id) DO NOTHING`).bind(user.id, clientId, t).run();
      if (!took.meta.changes) return c.json({ error: "already_sending", message: "This message is already being sent." }, 409);
    }
  }

  try {
    const r = await sendMail(c.env, acc, { thread_id: threadId, reply_to_message_id: replyToId, to, cc, bcc, subject, body_html, attachments });
    if (draftId) {
      const own = inClause(c.get("allAccountIds"));
      await db.prepare(`DELETE FROM drafts WHERE id = ? AND account_id IN ${own.sql}`).bind(draftId, ...own.params).run();
    }
    await logActivity(db, user.id, { actor: "you", kind: "send", summary: `Sent \u201c${subject || "(no subject)"}\u201d`, why: `From ${acc.email} to ${to.length} ${to.length === 1 ? "person" : "people"}`, threadId: r.thread_id, accountId: acc.id });
    const result = { ok: true, thread_id: r.thread_id, message_id: r.message_id, account_id: acc.id };
    if (clientId) await db.prepare(`UPDATE send_attempts SET status = 'sent', result_json = ? WHERE user_id = ? AND client_id = ?`).bind(JSON.stringify(result), user.id, clientId).run().catch(() => {});
    return c.json(result);
  } catch (e) {
    // It did not go, so the same id may try again.
    if (clientId) await db.prepare(`DELETE FROM send_attempts WHERE user_id = ? AND client_id = ? AND status = 'sending'`).bind(user.id, clientId).run().catch(() => {});
    const msg = (e as Error).message ?? "";
    if (msg === "sending_not_configured") return c.json({ error: "sending_not_configured", message: "No outbound provider for this mailbox. Enable Cloudflare Email Sending or set RESEND_API_KEY." }, 400);
    return c.json({ error: "send_failed", message: msg.slice(0, 500) }, 502);
  }
});

compose.post("/send/cancel", async (c) => {
  const b = await c.req.json<{ draft_id?: string }>().catch(() => ({}) as any);
  const own = inClause(c.get("allAccountIds"));
  const r = await c.env.DB.prepare(`UPDATE drafts SET status = 'draft', send_at = NULL, updated_at = ? WHERE id = ? AND account_id IN ${own.sql} AND status = 'scheduled'`)
    .bind(now(), isId(b.draft_id) ? b.draft_id : "", ...own.params)
    .run();
  if (!r.meta.changes) return c.json({ error: "not_scheduled" }, 404);
  return c.json({ ok: true });
});

export default compose;
