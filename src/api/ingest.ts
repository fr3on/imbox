// Storing mail: where a new message lands, and what happens to its thread and its sender. Gmail sync, IMAP sync, inbound mail and sending all end here.
import type { Env } from "./env";
import type { AccountRow, ContactRow, ThreadRow } from "./db";
import { assignBundles, uid, now, chunk, placeholders, safeJson, runBatch, logSync } from "./db";
import { parseGmailMessage, stripSubjectPrefixes, type GmailMessage, type ParsedMessage } from "./mime";
import { stripTrackers, htmlToText } from "./sanitize";
import { resolveBrandLogos } from "./bimi";
import { resolveSenderPhotos } from "./photos";
import { senderPicturesOn } from "./privacy";
import { insertRows, marks, pieces, updateRows } from "./sqlRows";
import { autoLetInOn, ruleLetIns, logLetIn } from "./autoletin";
import type { Address, Bucket, ScreenStatus } from "@shared/types";

function bucketForContact(status: ScreenStatus): Bucket {
  switch (status) {
    case "imbox":
    case "feed":
    case "paper_trail":
      return status;
    case "screened_out":
      return "screened_out";
    default:
      return "screener";
  }
}

function unionParticipants(existing: Address[], extra: Address[]): Address[] {
  const map = new Map<string, Address>();
  for (const a of existing) if (a.email) map.set(a.email, a);
  for (const a of extra) {
    if (!a.email) continue;
    const cur = map.get(a.email);
    if (!cur) map.set(a.email, a);
    else if (!cur.name && a.name) map.set(a.email, a);
  }
  return [...map.values()];
}

interface ContactState extends ContactRow {
  /** Was screened out, and you wrote to them: the saved status has to be overwritten, which a plain upsert does not do. */
  _reopened?: boolean;
  _dirty: boolean;
  _new: boolean;
}
interface ThreadState extends ThreadRow {
  /** Received a not-from-me message in this ingest → eligible to join the sender's open bundle. */
  _bundleCandidate?: boolean;
  _dirty: boolean;
  _new: boolean;
}

async function loadExistingMessageIds(db: Db, accountId: string, gmailIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (const ids of chunk(gmailIds, 90)) {
    const r = await db
      .prepare(`SELECT gmail_message_id FROM messages WHERE account_id = ? AND gmail_message_id IN (${placeholders(ids.length)})`)
      .bind(accountId, ...ids)
      .all<{ gmail_message_id: string }>();
    for (const row of r.results) set.add(row.gmail_message_id);
  }
  return set;
}

async function loadThreads(db: Db, accountId: string, gmailThreadIds: string[]): Promise<Map<string, ThreadState>> {
  const map = new Map<string, ThreadState>();
  for (const ids of chunk(gmailThreadIds, 90)) {
    const r = await db
      .prepare(`SELECT * FROM threads WHERE account_id = ? AND gmail_thread_id IN (${placeholders(ids.length)})`)
      .bind(accountId, ...ids)
      .all<ThreadRow>();
    for (const row of r.results) map.set(row.gmail_thread_id, { ...row, _dirty: false, _new: false });
  }
  return map;
}

async function loadContacts(db: Db, accountId: string, emails: string[]): Promise<Map<string, ContactState>> {
  const map = new Map<string, ContactState>();
  for (const ids of chunk(emails, 90)) {
    const r = await db
      .prepare(`SELECT * FROM contacts WHERE account_id = ? AND email IN (${placeholders(ids.length)})`)
      .bind(accountId, ...ids)
      .all<ContactRow>();
    for (const row of r.results) map.set(row.email, { ...row, _dirty: false, _new: false });
  }
  // Screening decisions are user-wide: a sender already decided on another connected account inherits that decision here.
  const missing = emails.filter((e) => !map.has(e));
  for (const ids of chunk(missing, 90)) {
    const r = await db
      .prepare(
        `SELECT c.email, c.name, c.screen_status, c.screened_at, c.avatar_url, c.bundled FROM contacts c
         WHERE c.account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT user_id FROM accounts WHERE id = ?) AND id <> ?)
           AND c.screen_status <> 'pending' AND c.email IN (${placeholders(ids.length)})
         ORDER BY c.screened_at DESC NULLS LAST`
      )
      .bind(accountId, accountId, ...ids)
      .all<{ email: string; name: string; screen_status: ContactRow["screen_status"]; screened_at: number | null; avatar_url: string; bundled: number }>();
    const t = now();
    for (const row of r.results) {
      if (map.has(row.email)) continue;
      map.set(row.email, {
        id: uid(),
        account_id: accountId,
        email: row.email,
        name: row.name ?? "",
        screen_status: row.screen_status,
        screened_at: row.screened_at ?? t,
        first_seen_at: t,
        last_seen_at: t,
        message_count: 0,
        notes: "",
        avatar_url: row.avatar_url ?? "",
        bundled: row.bundled ?? 0,
        photo_checked_at: null,
        _dirty: true,
        _new: true,
      });
    }
  }
  return map;
}

function getOrCreateContact(map: Map<string, ContactState>, accountId: string, a: Address, t: number): ContactState {
  let c = map.get(a.email);
  if (!c) {
    c = {
      id: uid(),
      account_id: accountId,
      email: a.email,
      name: a.name ?? "",
      screen_status: "pending",
      screened_at: null,
      first_seen_at: t,
      last_seen_at: t,
      message_count: 0,
      notes: "",
      avatar_url: "",
      bundled: 0,
      photo_checked_at: null,
      _dirty: true,
      _new: true,
    };
    map.set(a.email, c);
  }
  return c;
}

export interface IngestResult {
  added: number;
  threadIds: string[];
}

/** Kept for call-site compatibility; there is no import mode any more (mail starts from the moment you connect). */

/**
 * Ingest a set of Gmail messages (format=full) for an account. Idempotent.
 */
export async function ingestMessages(env: Env, account: AccountRow, raw: GmailMessage[]): Promise<IngestResult> {
  const db = env.DB;
  if (!raw.length) return { added: 0, threadIds: [] };

  const existing = await loadExistingMessageIds(
    db,
    account.id,
    raw.map((m) => m.id)
  );
  const parsed: ParsedMessage[] = [];
  for (const m of raw) {
    if (!m?.id || existing.has(m.id)) continue;
    if ((m.labelIds ?? []).includes("SPAM")) continue;
    try {
      parsed.push(parseGmailMessage(m));
    } catch (e) {
      await logSync(db, account.id, "warn", `parse failed for ${m.id}: ${(e as Error).message}`);
    }
  }
  return ingestParsed(env, account, parsed);
}

/** What a batch of messages is ingested against: the threads and contacts they touch, loaded once, and the statements that will write the messages. */
interface Batch {
  db: Db;
  account: AccountRow;
  myEmail: string;
  t0: number;
  threadMap: Map<string, ThreadState>;
  contactMap: Map<string, ContactState>;
  /** Your other mailboxes' addresses. */
  ownEmails: Set<string>;
  /** Senders a rule lets in, with the reason. */
  letIn: Map<string, string>;
  stmts: DbStatement[];
}

/** What one message is, worked out once. */
interface Facts {
  labels: string[];
  fromMe: boolean;
  isTrash: boolean;
  isUnread: boolean;
  html: string;
  trackers: ReturnType<typeof stripTrackers>["trackers"];
  text: string;
  subjectClean: string;
}

async function loadBatch(db: Db, account: AccountRow, parsed: ParsedMessage[]): Promise<Batch> {
  const myEmail = account.email.toLowerCase();
  const emails = new Set<string>();
  for (const p of parsed) {
    if (p.from.email) emails.add(p.from.email);
    for (const a of [...p.to, ...p.cc]) if (a.email) emails.add(a.email);
  }
  emails.delete(myEmail);
  // The threads and contacts the messages touch, and your own other addresses, are asked together: none depends on another, and each is a round trip.
  // Your own other addresses are you: mail between your mailboxes is not a stranger knocking, so it skips the Screener.
  const [threadMap, contactMap, ownRows] = await Promise.all([
    loadThreads(db, account.id, [...new Set(parsed.map((p) => p.threadId))]),
    loadContacts(db, account.id, [...emails]),
    db.prepare(`SELECT lower(email) AS email FROM accounts WHERE user_id = ? AND id <> ?`).bind(account.user_id, account.id).all<{ email: string }>(),
  ]);
  const ownEmails = new Set(ownRows.results.map((r) => r.email));

  const stmts: DbStatement[] = [];
  // With "Let obvious people in" on, a waiting sender in your address book, or answering a mail you sent, never reaches the Screener.
  const letIn = new Map<string, string>();
  const waiting = parsed.filter((p) => {
    if (!p.from.email || p.from.email === myEmail || p.labelIds.includes("SENT") || p.labelIds.includes("TRASH")) return false;
    const c = contactMap.get(p.from.email);
    return !c || c.screen_status === "pending";
  });
  if (waiting.length) {
    try {
      if (await autoLetInOn(db, account.user_id)) for (const [e, why] of await ruleLetIns(db, account.user_id, waiting)) letIn.set(e, why);
    } catch (e) {
      await logSync(db, account.id, "warn", `Letting people in automatically failed: ${(e as Error).message}`);
    }
  }
  return { db, account, myEmail, t0: now(), threadMap, contactMap, ownEmails, letIn, stmts };
}

function factsOf(p: ParsedMessage, myEmail: string): Facts {
  const labels = p.labelIds;
  const fromMe = labels.includes("SENT") || (p.from.email !== "" && p.from.email === myEmail);
  const isTrash = labels.includes("TRASH");
  const isUnread = labels.includes("UNREAD");
  const { html, trackers } = stripTrackers(p.html);
  const text = p.text || (html ? htmlToText(html) : "");
  const subjectClean = stripSubjectPrefixes(p.subject);
  return { labels, fromMe, isTrash, isUnread, html, trackers, text, subjectClean };
}

/** Who a message is from and to: create or update their contacts. Returns the sender, unless it is you. */
function noteContacts(b: Batch, p: ParsedMessage, f: Facts): ContactState | null {
  const { db, account, myEmail, contactMap, ownEmails, letIn, stmts } = b;
  const { fromMe } = f;
  let sender: ContactState | null = null;
  if (!fromMe && p.from.email) {
    sender = getOrCreateContact(contactMap, account.id, p.from, p.date);
    if (sender.screen_status === "pending" && ownEmails.has(sender.email.toLowerCase())) {
      sender.screen_status = "imbox";
      sender.screened_at = p.date;
    } else if (sender.screen_status === "pending" && letIn.has(sender.email.toLowerCase())) {
      sender.screen_status = "imbox";
      sender.screened_at = p.date;
      stmts.push(logLetIn(db, account.user_id, sender.email, sender.name || p.from.name, letIn.get(sender.email.toLowerCase())!, "rules"));
    }
    sender.message_count += 1;
    sender.last_seen_at = Math.max(sender.last_seen_at, p.date);
    sender.first_seen_at = Math.min(sender.first_seen_at, p.date);
    if (!sender.name && p.from.name) sender.name = p.from.name;
    sender._dirty = true;
  }
  if (fromMe) {
    for (const a of [...p.to, ...p.cc]) {
      if (!a.email || a.email === myEmail) continue;
      const c = getOrCreateContact(contactMap, account.id, a, p.date);
      c.last_seen_at = Math.max(c.last_seen_at, p.date);
      if (!c.name && a.name) c.name = a.name;
      if (c.screen_status === "pending") {
        c.screen_status = "imbox";
        c.screened_at = p.date;
      } else if (c.screen_status === "screened_out") {
        // Writing to someone is a yes: they are let back in, and their next mail is not hidden again.
        c.screen_status = "imbox";
        c.screened_at = p.date;
        c._reopened = true;
      }
      c._dirty = true;
    }
  }
  return sender;
}

/** Add a message to its thread, or start the thread, and decide which bucket it is in. */
function placeInThread(b: Batch, p: ParsedMessage, f: Facts, sender: ContactState | null): ThreadState {
  const { account, t0, threadMap } = b;
  const { fromMe, isTrash, isUnread, trackers, subjectClean } = f;
  let th = threadMap.get(p.threadId);
  const participants: Address[] = [p.from, ...p.to, ...p.cc].filter((a) => a.email);
  if (!th) {
    let bucket: Bucket;
    const st = sender?.screen_status ?? "pending";
    if (isTrash) bucket = "trash";
    else if (fromMe) bucket = "imbox";
    else bucket = bucketForContact(st);
    th = {
      id: uid(),
      account_id: account.id,
      gmail_thread_id: p.threadId,
      subject: subjectClean,
      custom_subject: null,
      snippet: p.snippet,
      bucket,
      seen: fromMe ? 1 : 0,
      unread: fromMe ? 0 : isUnread ? 1 : 0,
      reply_later: 0,
      reply_later_at: null,
      set_aside: 0,
      set_aside_at: null,
      bubble_up_at: null,
      bubbled: 0,
      merged_into: null,
      note: "",
      has_attachments: p.attachments.some((a) => !a.isInline) ? 1 : 0,
      trackers_blocked: trackers.length,
      participants_json: JSON.stringify(unionParticipants([], participants)),
      last_from_email: p.from.email,
      last_from_name: p.from.name,
      message_count: 1,
      first_message_at: p.date,
      last_message_at: p.date,
      is_sent_only: fromMe ? 1 : 0,
      bundle_id: null,
      created_at: t0,
      updated_at: t0,
      _dirty: true,
      _new: true,
      _bundleCandidate: !fromMe && !isTrash,
    };
    threadMap.set(p.threadId, th);
  } else {
    th._dirty = true;
    th.message_count += 1;
    th.updated_at = t0;
    if (!th.subject && subjectClean) th.subject = subjectClean;
    th.has_attachments = th.has_attachments || (p.attachments.some((a) => !a.isInline) ? 1 : 0);
    th.trackers_blocked += trackers.length;
    th.participants_json = JSON.stringify(unionParticipants(safeJson<Address[]>(th.participants_json, []), participants));
    th.first_message_at = Math.min(th.first_message_at, p.date);
    const isNewest = p.date >= th.last_message_at;
    if (isNewest) {
      th.last_message_at = p.date;
      th.snippet = p.snippet;
      th.last_from_email = p.from.email;
      th.last_from_name = p.from.name;
    }
    if (!fromMe) {
      th.is_sent_only = 0;
      if (isNewest && !isTrash) th._bundleCandidate = true;
      const st = sender?.screen_status ?? "pending";
      if (isNewest) {
        th.seen = 0; // new mail shows up in "New" again
        if (isUnread) th.unread = 1;
      } else if (isUnread) th.unread = 1;
      // Bucket rules
      if (!isTrash) {
        if (th.bucket === "screener" || th.bucket === "screened_out") {
          th.bucket = bucketForContact(st);
        } else if (st === "screened_out" && th.bucket !== "trash") {
          th.bucket = "screened_out";
        } else if (th.bucket === "trash" && isNewest) {
          // A new incoming message on a trashed thread brings it back.
          th.bucket = bucketForContact(st);
        }
      }
    } else {
      if (th.bucket === "screener" && !isTrash) th.bucket = "imbox";
      if (th.bucket === "screened_out" && !isTrash) th.bucket = "imbox";
    }
  }
  return th;
}

/** The values of the rows that store a message, its attachments and their bytes, in the order of the column lists below. */
interface MessageRows {
  message: unknown[];
  attachments: unknown[][];
  blobs: unknown[][];
}

function messageRows(b: Batch, th: ThreadState, p: ParsedMessage, f: Facts): MessageRows {
  const { account, t0 } = b;
  const { labels, fromMe, isUnread, html, trackers, text } = f;
  const msgId = uid();
  const message = [
    msgId, account.id, th.id, p.gmailId, p.from.email, p.from.name, JSON.stringify(p.to), JSON.stringify(p.cc), JSON.stringify(p.bcc), p.replyTo, p.subject, p.date, p.snippet,
    text.slice(0, 200_000), html, fromMe ? 1 : 0, !fromMe && isUnread ? 1 : 0, p.messageId, p.inReplyTo, p.references.slice(0, 8000), p.listUnsubscribe.slice(0, 2000),
    (p.listId ?? "").slice(0, 500), (p.precedence ?? "").slice(0, 100), JSON.stringify(labels), p.attachments.length ? 1 : 0, JSON.stringify(trackers), (p.authResults ?? "").slice(0, 100), p.sizeEstimate, t0,
  ];
  const attachments: unknown[][] = [];
  const blobs: unknown[][] = [];
  for (const a of p.attachments) {
    if (!a.attachmentId) continue;
    const attId = uid();
    attachments.push([attId, account.id, msgId, th.id, a.attachmentId, a.filename, a.mimeType, a.size, a.contentId, a.isInline ? 1 : 0, p.date]);
    if (a.blob) blobs.push([attId, a.blob, t0]);
  }
  return { message, attachments, blobs };
}

// ---------- Writing many rows with one statement ----------
// A statement is a round trip, so a batch of messages is written with a handful of statements, each holding many rows, and not one for each message, thread and
// contact. They are cut into pieces so no statement is huge (a message can hold 200 KB of text) and the shapes stay few.

const MESSAGE_COLUMNS = [
  "id", "account_id", "thread_id", "gmail_message_id", "from_email", "from_name", "to_json", "cc_json", "bcc_json", "reply_to", "subject", "date", "snippet", "text_body", "html_body",
  "is_from_me", "unread", "message_id_header", "in_reply_to", "references_header", "list_unsubscribe", "list_id", "precedence", "gmail_labels_json", "has_attachments", "trackers_json", "auth_results",
  "size_estimate", "created_at",
];
const ATTACHMENT_COLUMNS = ["id", "account_id", "message_id", "thread_id", "gmail_attachment_id", "filename", "mime_type", "size", "content_id", "is_inline", "created_at"];
const ATTACHMENT_TYPES = ["TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "BIGINT", "TEXT", "BIGINT", "BIGINT"];
const BLOB_COLUMNS = ["attachment_id", "data", "created_at"];
const BLOB_TYPES = ["TEXT", "BYTEA", "BIGINT"];
const CONTACT_COLUMNS = ["id", "account_id", "email", "name", "screen_status", "screened_at", "first_seen_at", "last_seen_at", "message_count", "notes", "bundled"];
const THREAD_COLUMNS = [
  "id", "account_id", "gmail_thread_id", "subject", "custom_subject", "snippet", "bucket", "seen", "unread", "reply_later", "reply_later_at", "set_aside", "set_aside_at", "bubble_up_at",
  "bubbled", "merged_into", "note", "has_attachments", "trackers_blocked", "participants_json", "last_from_email", "last_from_name", "message_count", "first_message_at", "last_message_at",
  "is_sent_only", "created_at", "updated_at",
];
const THREAD_UPDATE_COLUMNS = [
  "id", "subject", "snippet", "bucket", "seen", "unread", "has_attachments", "trackers_blocked", "participants_json", "last_from_email", "last_from_name", "message_count",
  "first_message_at", "last_message_at", "is_sent_only", "updated_at",
];
const THREAD_UPDATE_TYPES = ["TEXT", "TEXT", "TEXT", "TEXT", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "TEXT", "TEXT", "TEXT", "BIGINT", "BIGINT", "BIGINT", "BIGINT", "BIGINT"];

/** The same for rows that go in only where `exists` holds for the row (an attachment of a message that went in): a SELECT over a VALUES list, whose values have to say their type. */
function insertRowsWhere(db: Db, table: string, columns: string[], types: string[], rows: unknown[][], exists: string): DbStatement[] {
  return pieces(rows).map((part) =>
    db
      .prepare(`INSERT INTO ${table} (${columns.join(", ")}) SELECT v.* FROM (VALUES ${part.map(() => marks(columns.length, types)).join(", ")}) AS v(${columns.join(", ")}) WHERE ${exists}`)
      .bind(...part.flat())
  );
}

function contactStatements({ db, contactMap }: Batch): DbStatement[] {
  const dirty = [...contactMap.values()].filter((c) => c._dirty);
  const rows = dirty.map((c) => [c.id, c.account_id, c.email, c.name, c.screen_status, c.screened_at, c.first_seen_at, c.last_seen_at, c.message_count, c.notes, c.bundled ?? 0]);
  const contactStmts = insertRows(
    db,
    "contacts",
    CONTACT_COLUMNS,
    rows,
    ` ON CONFLICT(account_id, email) DO UPDATE SET
       name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
       screen_status = CASE WHEN contacts.screen_status = 'pending' THEN excluded.screen_status ELSE contacts.screen_status END,
       screened_at = COALESCE(contacts.screened_at, excluded.screened_at),
       first_seen_at = LEAST(contacts.first_seen_at, excluded.first_seen_at),
       last_seen_at = GREATEST(contacts.last_seen_at, excluded.last_seen_at),
       message_count = excluded.message_count`
  );
  for (const c of contactMap.values()) {
    if (c._reopened && !c._new) {
      contactStmts.push(db.prepare(`UPDATE contacts SET screen_status = 'imbox', screened_at = ? WHERE account_id = ? AND email = ? AND screen_status = 'screened_out'`).bind(c.screened_at, c.account_id, c.email));
    }
  }
  return contactStmts;
}

function threadStatements({ db, threadMap }: Batch): DbStatement[] {
  const added: unknown[][] = [];
  const changed: unknown[][] = [];
  for (const th of threadMap.values()) {
    if (!th._dirty) continue;
    if (th._new) {
      added.push([
        th.id, th.account_id, th.gmail_thread_id, th.subject, th.custom_subject, th.snippet, th.bucket, th.seen, th.unread, th.reply_later, th.reply_later_at, th.set_aside, th.set_aside_at,
        th.bubble_up_at, th.bubbled, th.merged_into, th.note, th.has_attachments, th.trackers_blocked, th.participants_json, th.last_from_email, th.last_from_name, th.message_count,
        th.first_message_at, th.last_message_at, th.is_sent_only, th.created_at, th.updated_at,
      ]);
    } else {
      changed.push([
        th.id, th.subject, th.snippet, th.bucket, th.seen, th.unread, th.has_attachments, th.trackers_blocked, th.participants_json, th.last_from_email, th.last_from_name, th.message_count,
        th.first_message_at, th.last_message_at, th.is_sent_only, th.updated_at,
      ]);
    }
  }
  return [...insertRows(db, "threads", THREAD_COLUMNS, added), ...updateRows(db, "threads", THREAD_UPDATE_COLUMNS, THREAD_UPDATE_TYPES, changed)];
}

/** The statements that store the messages, their attachments and the bytes of the attachments. */
function messageStatements(db: Db, rows: MessageRows[]): DbStatement[] {
  return [
    // Another sync may have stored a message first: it is skipped, and so are the attachments that point at it.
    ...insertRows(db, "messages", MESSAGE_COLUMNS, rows.map((r) => r.message), " ON CONFLICT DO NOTHING", (r) => String(r[13] ?? "").length + String(r[14] ?? "").length),
    ...insertRowsWhere(db, "attachments", ATTACHMENT_COLUMNS, ATTACHMENT_TYPES, rows.flatMap((r) => r.attachments), "EXISTS (SELECT 1 FROM messages m WHERE m.id = v.message_id)"),
    ...insertRowsWhere(db, "attachment_blobs", BLOB_COLUMNS, BLOB_TYPES, rows.flatMap((r) => r.blobs), "EXISTS (SELECT 1 FROM attachments a WHERE a.id = v.attachment_id)"),
  ];
}

/** After the rows are written: join bundles, and look up pictures for senders seen for the first time. */
async function afterIngest(env: Env, b: Batch): Promise<void> {
  const { db, account, threadMap, contactMap } = b;
  // Bundles are batches: only mail that arrives after a sender was bundled joins their open bundle.
  const bundleCandidates = [...threadMap.values()].filter((th) => th._bundleCandidate).map((th) => th.id);
  if (bundleCandidates.length) {
    try {
      await assignBundles(db, account.id, bundleCandidates);
    } catch (e) {
      await logSync(db, account.id, "warn", `Bundle assignment failed: ${(e as Error).message}`);
    }
  }

  // New senders: brand logos (BIMI, what Gmail shows for companies) right away; Google People photos on the next photo sync.
  const newSenders = [...contactMap.values()].filter((c) => c._new).map((c) => c.email);
  if (newSenders.length) {
    await db.prepare(`UPDATE accounts SET contacts_changed_at = ? WHERE id = ?`).bind(now(), account.id).run();
    // Whether the person allows sender pictures is asked once for both lookups.
    let pictures = false;
    try {
      pictures = await senderPicturesOn(db, account.id);
    } catch (e) {
      await logSync(db, account.id, "warn", `Sender pictures failed: ${(e as Error).message}`);
    }
    if (pictures) {
      try {
        await resolveBrandLogos(env, account.id, newSenders, { picturesOn: true });
      } catch (e) {
        await logSync(db, account.id, "warn", `Brand logos failed: ${(e as Error).message}`);
      }
      // Whoever still has no picture: a Gravatar photo, or their site's icon.
      try {
        await resolveSenderPhotos(env, account.id, newSenders, { picturesOn: true });
      } catch (e) {
        await logSync(db, account.id, "warn", `Sender pictures failed: ${(e as Error).message}`);
      }
    }
  }
}

/**
 * Provider-agnostic ingest of already-parsed messages (Gmail sync and the inbound email handler both end up here).
 * `gmailId` must be unique per account (Gmail id, or the Message-ID for domain mailboxes); `threadId` groups messages
 * into threads (Gmail thread id, or a locally generated id). Idempotent via the (account_id, gmail_message_id) unique key.
 */
export async function ingestParsed(env: Env, account: AccountRow, parsed: ParsedMessage[]): Promise<IngestResult> {
  if (!parsed.length) return { added: 0, threadIds: [] };
  parsed.sort((a, b) => a.date - b.date);
  const batch = await loadBatch(env.DB, account, parsed);
  const touched = new Set<string>();
  const rows: MessageRows[] = [];
  for (const p of parsed) {
    const f = factsOf(p, batch.myEmail);
    const sender = noteContacts(batch, p, f);
    const th = placeInThread(batch, p, f, sender);
    touched.add(th.id);
    rows.push(messageRows(batch, th, p, f));
  }

  // Order matters: contacts + threads before messages, and the messages before their attachments (FK). What noteContacts logged (who was let in) is independent of them.
  await runBatch(batch.db, [...contactStatements(batch), ...threadStatements(batch), ...batch.stmts, ...messageStatements(batch.db, rows)], 40);
  await afterIngest(env, batch);
  return { added: parsed.length, threadIds: [...touched] };
}
