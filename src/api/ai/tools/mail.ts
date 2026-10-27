import { type ActionBody, applyAction, loadThreadDetail } from "../../routes/mail";
import { endOfDay, isValidDate, startOfDay } from "../../calendar/dates";
import { type ContactRow, type ThreadRow, LOOKUP_CHUNK, accountForThread, attachAvatars, chunk, inClause, threadsWithLabels } from "../../db";
import { userTimezone } from "../../timezone";
import { htmlToText } from "../../sanitize";
import type { ParsedSearch } from "@shared/searchQuery";
import { ADDRESS_TEXT, CONTACT_TEXT, RECIPIENTS_TEXT, commonTerms, termSql } from "../../search";
import { type Handler, accountById, ownedThreadRow, parseUnsubscribe, shim, summary, FLAGGED, text } from "./context";

const MAX_BODY = 6000;
const MAX_MESSAGES = 20;

export const search_mail: Handler = async ({ ctx, input, db, sc, t, ok, fail }) => {
  const q = text(input.query);
  const limit = Math.min(25, Math.max(1, Number(input.limit) || 10));
  const unreadOnly = !!input.unread_only;
  const hasAttachment = !!input.has_attachment;
  const fromSender = text(input.from_sender);
  const toRecipient = text(input.to_recipient);
  const label = text(input.label);
  const bucket = text(input.bucket);
  const day = (v: unknown) => (isValidDate(text(v)) ? text(v) : "");
  const sinceDate = day(input.since_date);
  const untilDate = day(input.until_date);

  const hasFilter = q || unreadOnly || hasAttachment || fromSender || toRecipient || label || bucket || sinceDate || untilDate;
  if (!hasFilter) {
    return fail("Provide a search query or at least one filter (e.g. from_sender, unread_only, has_attachment, bucket, date range, or label).");
  }

  const where: string[] = [`t.account_id IN ${sc.sql}`, `t.merged_into IS NULL`];
  const params: unknown[] = [...sc.params];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    params.push(...values);
  };
  const like = (v: string) => `%${v}%`;

  if (FLAGGED[bucket]) add(FLAGGED[bucket]);
  else if (bucket === "bubble_up") add(`t.bubble_up_at IS NOT NULL AND t.bubble_up_at > ? AND t.bucket <> 'trash'`, t);
  else if (bucket) add(`t.bucket = ?`, bucket);
  else add(`t.bucket <> 'trash'`);

  if (unreadOnly) add(`(t.unread = 1 OR t.seen = 0)`);
  if (hasAttachment) add(`t.has_attachments = 1`);
  if (fromSender) add(`(t.last_from_email ILIKE ? OR t.last_from_name ILIKE ? OR t.participants_json ILIKE ?)`, ...Array(3).fill(like(fromSender)));
  // Each text is asked of the trigram index first (the same expression as the index, so it can be used) and then exactly as before, so the answer is the same rows.
  if (toRecipient) {
    add(
      `t.id IN (SELECT m.thread_id FROM messages m WHERE m.account_id IN ${sc.sql} AND (${RECIPIENTS_TEXT("m")}) ILIKE ? AND (m.to_json ILIKE ? OR m.cc_json ILIKE ?))`,
      ...sc.params,
      ...Array(3).fill(like(toRecipient))
    );
  }
  if (label) add(`EXISTS (SELECT 1 FROM thread_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.thread_id = t.id AND (l.id = ? OR l.name ILIKE ?))`, label, like(label));

  if (sinceDate || untilDate) {
    const tz = await userTimezone(db, ctx.user.id);
    if (sinceDate) add(`t.last_message_at >= ?`, startOfDay(sinceDate, tz));
    if (untilDate) add(`t.last_message_at <= ?`, endOfDay(untilDate, tz));
  }

  if (q) {
    // The words are looked for the way the search page looks for them (src/api/search.ts): by index, unless the word is so common that walking the threads by date is quicker.
    const word = termSql(q, (await commonTerms(db, { terms: [q], excluded: [] } as unknown as ParsedSearch)).has(q));
    add(word.sql, ...word.params);
  }

  const rows = await db
    .prepare(`SELECT t.* FROM threads t WHERE ${where.join(" AND ")} ORDER BY t.last_message_at DESC LIMIT ?`)
    .bind(...params, limit)
    .all<ThreadRow>();

  const list = await attachAvatars(db, await threadsWithLabels(db, rows.results));
  const filterSummaries: string[] = [];
  if (q) filterSummaries.push(`“${q}”`);
  if (fromSender) filterSummaries.push(`from ${fromSender}`);
  if (unreadOnly) filterSummaries.push("unread");
  if (hasAttachment) filterSummaries.push("with attachments");
  if (bucket) filterSummaries.push(`in ${bucket.replace("_", " ")}`);
  if (label) filterSummaries.push(`labeled ${label}`);
  if (sinceDate && untilDate) filterSummaries.push(`${sinceDate} to ${untilDate}`);
  else if (sinceDate) filterSummaries.push(`since ${sinceDate}`);
  else if (untilDate) filterSummaries.push(`until ${untilDate}`);

  const desc = filterSummaries.length ? ` for ${filterSummaries.join(", ")}` : "";
  return ok({ results: list.map(summary), count: list.length }, `Searched mail${desc} · ${list.length} result${list.length === 1 ? "" : "s"}`);
};

export const list_threads: Handler = async ({ input, db, sc, t, ok, VISIBLE }) => {
  const bucket = String(input.bucket ?? "imbox");
  const limit = Math.min(40, Math.max(1, Number(input.limit) || 15));
  const where: string[] = [`t.account_id IN ${sc.sql}`, bucket === "bubble_up" ? `t.merged_into IS NULL AND t.bubble_up_at IS NOT NULL AND t.bubble_up_at > ?` : VISIBLE];
  const params: unknown[] = [...sc.params, t];
  let order = "t.last_message_at DESC";
  switch (bucket) {
    case "imbox":
      where.push(`t.bucket = 'imbox' AND t.reply_later = 0 AND t.set_aside = 0`);
      if (input.only_new) where.push(`t.seen = 0`);
      break;
    case "previously_seen":
      where.push(`t.bucket = 'imbox' AND t.seen = 1`);
      break;
    case "feed":
    case "paper_trail":
    case "screener":
    case "screened_out":
    case "trash":
      where.push(`t.bucket = ?`);
      params.push(bucket);
      break;
    case "sent":
      where.push(`t.bucket <> 'trash' AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.is_from_me = 1)`);
      break;
    case "reply_later":
      where.push(`t.reply_later = 1 AND t.bucket <> 'trash'`);
      order = "t.reply_later_at DESC NULLS LAST";
      break;
    case "set_aside":
      where.push(`t.set_aside = 1 AND t.bucket <> 'trash'`);
      order = "t.set_aside_at DESC NULLS LAST";
      break;
    case "bubble_up":
      where.push(`t.bucket <> 'trash'`);
      order = "t.bubble_up_at ASC NULLS FIRST";
      break;
    default:
      where.push(`t.bucket <> 'trash' AND t.bucket <> 'screened_out'`);
  }
  const rows = await db.prepare(`SELECT t.* FROM threads t WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`).bind(...params, limit).all<ThreadRow>();
  const list = await threadsWithLabels(db, rows.results);
  return ok({ bucket, threads: list.map(summary) }, `Listed ${list.length} thread${list.length === 1 ? "" : "s"} in ${bucket.replace("_", " ")}`);
};

export const read_thread: Handler = async ({ ctx, input, db, ok, fail }) => {
  const id = String(input.thread_id ?? "");
  const acc = await accountForThread(db, ctx.user.id, id);
  if (!acc) return fail("Thread not found");
  const detail = await loadThreadDetail(shim(ctx, acc), id);
  if (!detail) return fail("Thread not found");
  ctx.threadHints = [id, ...(ctx.threadHints ?? []).filter((x) => x !== id)];
  const max = Math.min(MAX_MESSAGES, Math.max(1, Number(input.max_messages) || MAX_MESSAGES));
  const all = detail.messages;
  const slice = all.slice(Math.max(0, all.length - max));
  let truncated = slice.length < all.length;
  const messages = slice.map((m) => {
    let text = (m.text_body || htmlToText(m.html_body || "")).trim();
    if (text.length > MAX_BODY) {
      text = text.slice(0, MAX_BODY) + " …[truncated]";
      truncated = true;
    }
    return { message_id: m.id, from: m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email, to: m.to.map((a) => a.email), cc: m.cc.map((a) => a.email), date: new Date(m.date).toISOString(), from_me: m.is_from_me, text, attachments: m.attachments.map((a) => a.filename) };
  });
  return ok(
    { thread_id: detail.id, subject: detail.subject, bucket: detail.bucket, account_email: acc.email, participants: detail.participants, note: detail.note || null, message_count: all.length, truncated, messages },
    `Read “${detail.subject}” · ${messages.length} of ${all.length} message${all.length === 1 ? "" : "s"}${truncated ? " (trimmed)" : ""}`
  );
};

export const list_screener: Handler = async ({ ctx, db, sc, t, ok, VISIBLE }) => {
  const rows = await db
    .prepare(`SELECT t.* FROM threads t WHERE t.account_id IN ${sc.sql} AND t.bucket = 'screener' AND ${VISIBLE} ORDER BY t.last_message_at DESC LIMIT 200`)
    .bind(...sc.params, t)
    .all<ThreadRow>();
  const bySender = new Map<string, { account_id: string; email: string; name: string; threads: { thread_id: string; subject: string; snippet: string }[] }>();
  for (const r of rows.results) {
    const key = `${r.account_id}|${r.last_from_email}`;
    const e = bySender.get(key) ?? { account_id: r.account_id, email: r.last_from_email, name: r.last_from_name, threads: [] };
    if (e.threads.length < 3) e.threads.push({ thread_id: r.id, subject: r.custom_subject || r.subject, snippet: r.snippet.slice(0, 120) });
    bySender.set(key, e);
  }
  // Who of them is already a contact: one lookup for the addresses, not one for each sender.
  const contactOf = new Map<string, string>();
  for (const part of chunk([...new Set([...bySender.values()].map((e) => e.email))], LOOKUP_CHUNK)) {
    const known = await db
      .prepare(`SELECT id, account_id, email FROM contacts WHERE account_id IN ${sc.sql} AND email IN ${inClause(part).sql}`)
      .bind(...sc.params, ...part)
      .all<{ id: string; account_id: string; email: string }>();
    for (const c of known.results) contactOf.set(`${c.account_id}|${c.email}`, c.id);
  }
  const senders = [...bySender.entries()].map(([key, e]) => ({ contact_id: contactOf.get(key) ?? null, name: e.name, email: e.email, account_email: accountById(ctx, e.account_id)?.email, threads: e.threads }));
  return ok({ senders }, `Checked the Screener · ${senders.length} waiting`);
};

export const thread_action: Handler = async ({ ctx, input, db, ok, fail }) => {
  const id = String(input.thread_id ?? "");
  const row = await ownedThreadRow(ctx, id);
  if (!row) return fail("Thread not found");
  const acc = accountById(ctx, row.account_id) ?? null;
  const action = String(input.action);
  if (action === "unsubscribe_info") {
    const m = await db.prepare(`SELECT list_unsubscribe FROM messages WHERE thread_id = ? AND list_unsubscribe <> '' ORDER BY date DESC LIMIT 1`).bind(id).first<{ list_unsubscribe: string }>();
    const info = m ? parseUnsubscribe(m.list_unsubscribe) : {};
    return ok({ ...info, found: !!(info.url || info.mailto) }, info.url || info.mailto ? "Found the unsubscribe link" : "No unsubscribe link in this thread");
  }
  let body: ActionBody;
  let label = "";
  const on = input.on === null || input.on === undefined ? true : !!input.on;
  switch (action) {
    case "reply_later": body = { action: "reply_later", on } as any; label = on ? "Added to Reply Later" : "Removed from Reply Later"; break;
    case "set_aside": body = { action: "set_aside", on } as any; label = on ? "Set aside" : "Removed from Set Aside"; break;
    case "bubble_up": body = { action: "bubble_up", at: input.at ?? null } as any; label = input.at ? `Bubbles up ${new Date(Number(input.at)).toLocaleString()}` : "Bubble up cancelled"; break;
    case "move": {
      const bucket = String(input.bucket ?? "");
      if (!["imbox", "feed", "paper_trail", "trash"].includes(bucket)) return fail("bucket must be imbox, feed, paper_trail or trash");
      body = { action: "move", bucket } as any; label = `Moved to ${bucket === "trash" ? "Trash" : bucket === "imbox" ? "Imbox" : "Feed"}`; break;
    }
    case "mark_read": body = { action: "mark_read" } as any; label = "Marked read"; break;
    case "mark_unread": body = { action: "mark_unread" } as any; label = "Marked unread"; break;
    case "label_add": if (!input.label_id) return fail("label_id required"); body = { action: "labels", add: [String(input.label_id)] } as any; label = "Label added"; break;
    case "label_remove": if (!input.label_id) return fail("label_id required"); body = { action: "labels", remove: [String(input.label_id)] } as any; label = "Label removed"; break;
    case "bundle": body = { action: "bundle", on } as any; label = on ? "Sender bundled" : "Sender unbundled"; break;
    default: return fail("Unknown action");
  }
  const r = await applyAction(shim(ctx, acc), id, body);
  if ("error" in r) return fail(r.error);
  return ok({ ok: true, thread_id: id, action }, `${label} · “${row.custom_subject || row.subject}”`);
};

export const find_contact: Handler = async ({ input, db, sc, ok, fail }) => {
  const q = String(input.query ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(input.limit) || 8));
  if (!q) return fail("query required");
  const like = `%${q}%`;
  const rows = await db
    .prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND (${CONTACT_TEXT("contacts")}) ILIKE ? AND (email ILIKE ? OR name ILIKE ?) ORDER BY last_seen_at DESC LIMIT ?`)
    .bind(...sc.params, like, like, like, limit)
    .all<ContactRow>();
  const seen = new Set(rows.results.map((r) => r.email));
  const book = await db
    .prepare(`SELECT email, name FROM address_book WHERE account_id IN ${sc.sql} AND (${ADDRESS_TEXT("address_book")}) ILIKE ? AND (email ILIKE ? OR name ILIKE ?) LIMIT ?`)
    .bind(...sc.params, like, like, like, limit)
    .all<{ email: string; name: string }>();
  const people = [
    ...rows.results.map((r) => ({ contact_id: r.id, name: r.name, email: r.email, screen_status: r.screen_status, bundled: !!(r as any).bundled, notes: r.notes || undefined })),
    ...book.results.filter((b) => !seen.has(b.email)).map((b) => ({ contact_id: null, name: b.name, email: b.email, screen_status: "unknown" })),
  ].slice(0, limit);
  return ok({ people }, `Looked up “${q}” · ${people.length} found`);
};
