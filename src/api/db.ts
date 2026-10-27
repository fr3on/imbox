import type { Bundle,
  Account,
  Address,
  Attachment,
  Contact,
  Label,
  Message,
  ThreadSummary,
  User,
  Bucket,
  ScreenStatus,
} from "@shared/types";
import type { AccountsRow, AttachmentsRow, BundlesRow, ContactsRow, DomainsRow, LabelsRow, MessagesRow, ThreadsRow, UsersRow } from "./schema";

// ---------- Row types ----------
// The columns come from the migrated schema (schema.ts, `npm run gen:schema`); a type here only narrows a column to the values the code writes to it.
type Narrow<T, N> = Omit<T, keyof N> & N;
export type UserRow = UsersRow;

export type AccountRow = Narrow<AccountsRow, { provider: "gmail" | "domain" | "outlook" | "imap"; sync_status: "idle" | "syncing" | "error" | "disconnected" }>;

export type DomainRow = DomainsRow;

export type ContactRow = Narrow<ContactsRow, { screen_status: ScreenStatus }>;

export type ThreadRow = Narrow<ThreadsRow, { bucket: Bucket }>;

export type MessageRow = MessagesRow;

export type AttachmentRow = AttachmentsRow;

export type LabelRow = LabelsRow;

// ---------- Helpers ----------
export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * How many values go in one `IN (...)` list. The old 90 was a limit of the database the app once ran on; PostgreSQL takes tens of thousands, and every piece
 * is a round trip, so a page that asks for the pictures of two hundred people was asking three times.
 */
export const LOOKUP_CHUNK = 500;

export const placeholders = (n: number) => Array(n).fill("?").join(",");

/** `IN (?,?,?)` fragment + params for a list of ids (never empty: an empty list yields `IN (NULL)`, which matches nothing). */
export function inClause(ids: string[]): { sql: string; params: string[] } {
  if (!ids.length) return { sql: "(NULL)", params: [] };
  return { sql: `(${placeholders(ids.length)})`, params: ids };
}

/** An account the user owns, or null. */
export async function ownedAccount(db: Db, userId: string, accountId: string): Promise<AccountRow | null> {
  return (await db.prepare(`SELECT * FROM accounts WHERE id = ? AND user_id = ?`).bind(accountId, userId).first<AccountRow>()) ?? null;
}

/** Whether a database error is "that value is already taken" (a unique key): the answer to a check-then-insert that two requests made together. */
export const isUniqueViolation = (e: unknown): boolean => (e as { code?: string | null } | null)?.code === "23505";

/** The tables whose rows belong to an account, and so to its owner: the only ones `ownedRow` will look in. */
const OWNED_TABLES = ["clips", "collections", "contacts", "drafts", "labels", "threads"] as const;
type OwnedTable = (typeof OWNED_TABLES)[number];

/** A row from an account-owned table, only if the account belongs to the user. The table name goes into the text, so it is one of a fixed few. */
export async function ownedRow<T>(db: Db, table: OwnedTable, id: string, userId: string): Promise<T | null> {
  if (!(OWNED_TABLES as readonly string[]).includes(table)) throw new Error(`${table} is not an account-owned table`);
  return (await db.prepare(`SELECT x.* FROM ${table} x JOIN accounts a ON a.id = x.account_id WHERE x.id = ? AND a.user_id = ?`).bind(id, userId).first<T>()) ?? null;
}

/** The account that owns a thread, if the user owns that account. */
export async function accountForThread(db: Db, userId: string, threadId: string): Promise<AccountRow | null> {
  return (
    (await db.prepare(`SELECT a.* FROM accounts a JOIN threads t ON t.account_id = a.id WHERE t.id = ? AND a.user_id = ?`).bind(threadId, userId).first<AccountRow>()) ?? null
  );
}

/** Account rows by id (for grouping Gmail calls across accounts). */
export async function accountsById(db: Db, userId: string, ids: string[]): Promise<Map<string, AccountRow>> {
  const map = new Map<string, AccountRow>();
  const uniq = [...new Set(ids)];
  for (const part of chunk(uniq, 90)) {
    const rows = await db.prepare(`SELECT * FROM accounts WHERE user_id = ? AND id IN (${placeholders(part.length)})`).bind(userId, ...part).all<AccountRow>();
    for (const r of rows.results) map.set(r.id, r);
  }
  return map;
}

export function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Run a possibly-large batch of statements, chunked to keep each transaction a sensible size. */
export async function runBatch(db: Db, stmts: DbStatement[], size = 40) {
  for (const part of chunk(stmts, size)) {
    if (part.length) await db.batch(part);
  }
}

// ---------- Mappers ----------
export function toUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    disabled: !!r.disabled,
    settings: safeJson(r.settings_json, {}),
    created_at: r.created_at,
    two_factor_enabled: !!r.totp_enabled,
  };
}

export function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    provider: r.provider === "domain" || r.provider === "outlook" || r.provider === "imap" ? r.provider : "gmail",
    domain_id: r.domain_id ?? null,
    initial_sync_done: !!r.initial_sync_done,
    initial_sync_count: r.initial_sync_count,
    sync_status: r.sync_status,
    sync_error: r.sync_error,
    last_synced_at: r.last_synced_at,
    signature: r.signature,
    cover_art: r.cover_art,
    avatar_url: r.avatar_url ?? "",
    photos_synced_at: r.photos_synced_at ?? null,
    created_at: r.created_at,
  };
}

export function toContact(r: ContactRow): Contact {
  return {
    id: r.id,
    account_id: r.account_id,
    email: r.email,
    name: r.name,
    screen_status: r.screen_status,
    screened_at: r.screened_at,
    first_seen_at: r.first_seen_at,
    last_seen_at: r.last_seen_at,
    message_count: r.message_count,
    notes: r.notes,
    avatar_url: r.avatar_url ?? "",
    bundled: !!r.bundled,
  };
}

export function toLabel(r: LabelRow): Label {
  return { id: r.id, account_id: r.account_id, name: r.name, color: r.color };
}

export function toThreadSummary(r: ThreadRow, labels: Label[] = []): ThreadSummary {
  return {
    id: r.id,
    account_id: r.account_id,
    subject: r.custom_subject ?? r.subject,
    original_subject: r.subject,
    snippet: r.snippet,
    bucket: r.bucket,
    seen: !!r.seen,
    unread: !!r.unread,
    reply_later: !!r.reply_later,
    set_aside: !!r.set_aside,
    bubble_up_at: r.bubble_up_at,
    bubbled: !!r.bubbled,
    note: r.note,
    has_attachments: !!r.has_attachments,
    trackers_blocked: r.trackers_blocked,
    participants: safeJson<Address[]>(r.participants_json, []),
    last_from: { email: r.last_from_email, name: r.last_from_name },
    message_count: r.message_count,
    first_message_at: r.first_message_at,
    last_message_at: r.last_message_at,
    labels,
  };
}

export function toAttachment(r: AttachmentRow, extra?: { thread_subject?: string; from?: Address }): Attachment {
  return {
    id: r.id,
    account_id: r.account_id,
    message_id: r.message_id,
    thread_id: r.thread_id,
    filename: r.filename,
    mime_type: r.mime_type,
    size: r.size,
    is_inline: !!r.is_inline,
    created_at: r.created_at,
    ...(extra ?? {}),
  };
}

/**
 * Inline images arrive as `<img src="cid:...">` pointing at an attachment part. Rewrite them to the
 * attachment proxy so signatures, logos and embedded photos actually render.
 */
export function rewriteCidImages(html: string, messageId: string, attachments: AttachmentRow[]): string {
  if (!html?.includes("cid:")) return html;
  const byCid = new Map<string, string>();
  for (const a of attachments) {
    const cid = (a.content_id ?? "").replace(/^<|>$/g, "").trim().toLowerCase();
    if (cid) byCid.set(cid, a.id);
    // Some senders reference the filename instead of the Content-ID.
    const name = (a.filename ?? "").trim().toLowerCase();
    if (name && !byCid.has(name)) byCid.set(name, a.id);
  }
  if (byCid.size === 0) return html;
  return html.replace(/(["'(])cid:([^"')\s>]+)/gi, (whole, open: string, ref: string) => {
    const id = byCid.get(decodeURIComponent(ref).trim().toLowerCase());
    return id ? `${open}/api/messages/${messageId}/attachments/${id}` : whole;
  });
}

export function toMessage(r: MessageRow, attachments: AttachmentRow[] = []): Message {
  return {
    id: r.id,
    account_id: r.account_id,
    thread_id: r.thread_id,
    from: { email: r.from_email, name: r.from_name },
    to: safeJson<Address[]>(r.to_json, []),
    cc: safeJson<Address[]>(r.cc_json, []),
    bcc: safeJson<Address[]>(r.bcc_json, []),
    reply_to: r.reply_to,
    subject: r.subject,
    date: r.date,
    snippet: r.snippet,
    text_body: r.text_body,
    html_body: rewriteCidImages(r.html_body, r.id, attachments),
    is_from_me: !!r.is_from_me,
    unread: !!r.unread,
    has_attachments: !!r.has_attachments,
    trackers: safeJson<string[]>(r.trackers_json, []),
    auth_results: r.auth_results ?? "",
    list_unsubscribe: r.list_unsubscribe,
    attachments: attachments.map((a) => toAttachment(a)),
  };
}

/** Labels for many threads in as few queries as possible. */
export async function getLabelsForThreads(db: Db, threadIds: string[]): Promise<Map<string, Label[]>> {
  const map = new Map<string, Label[]>();
  if (!threadIds.length) return map;
  // The chunks are asked together: each is a round trip to the database, and they do not depend on each other.
  const parts = await Promise.all(
    chunk(threadIds, LOOKUP_CHUNK).map((ids) =>
      db
        .prepare(
          `SELECT tl.thread_id, l.id, l.account_id, l.name, l.color FROM thread_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.thread_id IN (${placeholders(ids.length)}) ORDER BY l.name NULLS FIRST`
        )
        .bind(...ids)
        .all<{ thread_id: string; id: string; account_id: string; name: string; color: string }>()
    )
  );
  for (const rows of parts) {
    for (const r of rows.results) {
      const arr = map.get(r.thread_id) ?? [];
      arr.push({ id: r.id, account_id: r.account_id, name: r.name, color: r.color });
      map.set(r.thread_id, arr);
    }
  }
  return map;
}

export async function threadsWithLabels(db: Db, rows: ThreadRow[]): Promise<ThreadSummary[]> {
  // Labels, pictures and hints each read a different table and write a different field of the summaries, so they are looked up side by side.
  const summaries = rows.map((r) => toThreadSummary(r, []));
  const [labels] = await Promise.all([
    getLabelsForThreads(
      db,
      rows.map((r) => r.id)
    ),
    attachAvatars(db, summaries),
    attachHints(db, summaries),
  ]);
  for (const s of summaries) s.labels = labels.get(s.id) ?? [];
  return summaries;
}

/** Mark the Feeds and Paper Trail threads that look like they need the person. A hint is for the thread's latest message only. */
export async function attachHints(db: Db, summaries: ThreadSummary[]): Promise<ThreadSummary[]> {
  const ids = summaries.filter((s) => s.bucket === "feed" || s.bucket === "paper_trail").map((s) => s.id);
  if (!ids.length) return summaries;
  const found = new Map<string, { reason: string; source: "rules" | "ai" }>();
  const parts = await Promise.all(
    chunk(ids, LOOKUP_CHUNK).map((part) =>
      db
        .prepare(
          `SELECT h.thread_id, h.reason, h.source FROM imbox_hints h JOIN threads t ON t.id = h.thread_id
         WHERE h.thread_id IN (${placeholders(part.length)}) AND h.verdict = 'move' AND h.dismissed = 0 AND h.last_message_at = t.last_message_at AND t.bucket IN ('feed', 'paper_trail')`
        )
        .bind(...part)
        .all<{ thread_id: string; reason: string; source: "rules" | "ai" }>()
    )
  );
  for (const rows of parts) for (const r of rows.results) found.set(r.thread_id, { reason: r.reason, source: r.source });
  for (const s of summaries) s.imbox_hint = found.get(s.id) ?? null;
  return summaries;
}

/** contacts.avatar_url for (account_id, email) pairs, keyed `${account_id}|${email}`. Only non-empty urls are returned. */
export async function avatarMap(db: Db, pairs: { account_id: string; email: string }[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const byAccount = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.email || !p.account_id) continue;
    const s = byAccount.get(p.account_id) ?? new Set<string>();
    s.add(p.email.toLowerCase());
    byAccount.set(p.account_id, s);
  }
  await Promise.all(
    [...byAccount].map(async ([accountId, emails]) => {
      const own = await Promise.all(
        chunk([...emails], LOOKUP_CHUNK).map((part) =>
          db
            .prepare(`SELECT email, avatar_url FROM contacts WHERE account_id = ? AND avatar_url <> '' AND email IN (${placeholders(part.length)})`)
            .bind(accountId, ...part)
            .all<{ email: string; avatar_url: string }>()
        )
      );
      for (const rows of own) for (const r of rows.results) map.set(`${accountId}|${r.email}`, r.avatar_url);
      // Fall back to the Google address book (any of this user's accounts) for people who aren't contacts yet.
      const missing = [...emails].filter((e) => !map.has(`${accountId}|${e}`));
      const book = await Promise.all(
        chunk(missing, LOOKUP_CHUNK).map((part) =>
          db
            .prepare(
              `SELECT b.email, b.avatar_url FROM address_book b
           WHERE b.avatar_url <> '' AND b.email IN (${placeholders(part.length)})
             AND b.account_id IN (SELECT id FROM accounts WHERE user_id = (SELECT user_id FROM accounts WHERE id = ?))`
            )
            .bind(...part, accountId)
            .all<{ email: string; avatar_url: string }>()
        )
      );
      for (const rows of book) for (const r of rows.results) if (!map.has(`${accountId}|${r.email}`)) map.set(`${accountId}|${r.email}`, r.avatar_url);
    })
  );
  return map;
}

const pairsOf = (summaries: ThreadSummary[]) => {
  const pairs: { account_id: string; email: string }[] = [];
  for (const s of summaries) {
    pairs.push({ account_id: s.account_id, email: s.last_from.email });
    for (const p of s.participants) pairs.push({ account_id: s.account_id, email: p.email });
  }
  return pairs;
};

function applyAvatars(summaries: ThreadSummary[], map: Map<string, string>) {
  for (const s of summaries) {
    const u = map.get(`${s.account_id}|${s.last_from.email.toLowerCase()}`);
    if (u) s.last_from.avatar_url = u;
    for (const p of s.participants) {
      const pu = map.get(`${s.account_id}|${p.email.toLowerCase()}`);
      if (pu) p.avatar_url = pu;
    }
  }
}

/** Fill `last_from.avatar_url` (and participants) on thread summaries from the contacts table. */
export async function attachAvatars(db: Db, summaries: ThreadSummary[]): Promise<ThreadSummary[]> {
  await attachAvatarsToAll(db, [summaries]);
  return summaries;
}

/**
 * The same for several lists at once, with one lookup for all of them: a page of sections (new, seen, reply later, set aside) asks the database for the
 * pictures of everyone on it together, not once for each section that is not empty. `extra` adds people who are on the page but not in a list (the
 * Screener's senders); the pictures found are returned, keyed as `avatarMap` keys them.
 */
export async function attachAvatarsToAll(db: Db, lists: ThreadSummary[][], extra: { account_id: string; email: string }[] = []): Promise<Map<string, string>> {
  const all = lists.flat();
  const pairs = [...pairsOf(all), ...extra];
  if (!pairs.length) return new Map();
  const map = await avatarMap(db, pairs);
  if (map.size) applyAvatars(all, map);
  return map;
}

export async function logSync(db: Db, accountId: string | null, level: "info" | "warn" | "error", message: string) {
  try {
    await db
      .prepare(`INSERT INTO sync_log (account_id, level, message, created_at) VALUES (?, ?, ?, ?)`)
      .bind(accountId, level, message.slice(0, 2000), now())
      .run();
  } catch {
    // ignore
  }
}

/**
 * Bundles: collapse threads from bundled senders into one entry per (account, sender).
 * Returns the remaining threads plus the bundles (each with its latest thread and counts).
 */
export type BundleRow = Narrow<BundlesRow, { status: "open" | "seen" }>;

/** A person's mailboxes, oldest first, each with whether it is an outside agent's: the accounts and the agent list in one read. */
export async function accountsWithAgentFlag(db: Db, userId: string): Promise<(AccountRow & { is_agent: boolean })[]> {
  const rows = await db
    .prepare(`SELECT a.*, (m.account_id IS NOT NULL) AS is_agent FROM accounts a LEFT JOIN agent_mailboxes m ON m.account_id = a.id WHERE a.user_id = ? ORDER BY a.created_at ASC`)
    .bind(userId)
    .all<AccountRow & { is_agent: boolean }>();
  return rows.results;
}

/**
 * Bundle batches for the accounts in scope, with the latest (non-parked) thread as the row preview. `only` asks for one bundle by id. The preview threads and the
 * counts of every bundle come from one query each, not a pair per bundle: a mailbox with sixty bundles was running 120 statements for its Imbox.
 */
export async function loadBundles(db: Db, accountIds: string[], bucket: "imbox" | "paper_trail", now_: number, only?: string): Promise<Bundle[]> {
  if (!accountIds.length) return [];
  const sc = inClause(accountIds);
  const rows = await db
    .prepare(
      `SELECT b.*, c.name AS contact_name, c.avatar_url AS contact_avatar FROM bundles b
       LEFT JOIN contacts c ON c.id = b.contact_id
       WHERE b.account_id IN ${sc.sql} ${only ? "AND b.id = ?" : ""}
         AND EXISTS (SELECT 1 FROM threads t WHERE t.bundle_id = b.id AND t.bucket = ? AND t.merged_into IS NULL AND t.reply_later = 0 AND t.set_aside = 0 AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?))
       ORDER BY b.last_message_at DESC, b.id LIMIT 200`
    )
    .bind(...sc.params, ...(only ? [only] : []), bucket, now_)
    .all<BundleRow & { contact_name: string | null; contact_avatar: string | null }>();
  if (!rows.results.length) return [];
  const ids = inClause(rows.results.map((b) => b.id));
  const [latestRows, countRows] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT ON (t.bundle_id) t.* FROM threads t
         WHERE t.bundle_id IN ${ids.sql} AND t.bucket = ? AND t.merged_into IS NULL AND t.reply_later = 0 AND t.set_aside = 0 AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?)
         ORDER BY t.bundle_id NULLS LAST, t.last_message_at DESC, t.id`
      )
      .bind(...ids.params, bucket, now_)
      .all<ThreadRow>(),
    db
      .prepare(
        `SELECT t.bundle_id, COUNT(*) AS threads, COALESCE(SUM(t.message_count), 0) AS messages FROM threads t
         WHERE t.bundle_id IN ${ids.sql} AND t.merged_into IS NULL AND t.reply_later = 0 AND t.set_aside = 0 GROUP BY t.bundle_id`
      )
      .bind(...ids.params)
      .all<{ bundle_id: string; threads: number; messages: number }>(),
  ]);
  const previews = await attachAvatars(db, latestRows.results.map((r) => toThreadSummary(r, [])));
  const latestOf = new Map(latestRows.results.map((r, i) => [r.bundle_id, previews[i]]));
  const countsOf = new Map(countRows.results.map((r) => [r.bundle_id, r]));
  const out: Bundle[] = [];
  for (const b of rows.results) {
    const latest = latestOf.get(b.id);
    if (!latest) continue;
    const counts = countsOf.get(b.id);
    out.push({
      id: b.id,
      contact_id: b.contact_id,
      account_id: b.account_id,
      email: b.email,
      name: b.contact_name || latest.last_from.name || b.email,
      avatar_url: b.contact_avatar || latest.last_from.avatar_url || "",
      status: b.status,
      thread_count: counts?.threads ?? b.thread_count,
      message_count: counts?.messages ?? b.message_count,
      latest,
      first_message_at: b.first_message_at,
      last_message_at: b.last_message_at,
    });
  }
  return out;
}

/** Recompute a bundle's counts and timestamps from its threads. */
export async function refreshBundle(db: Db, bundleId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE bundles SET
         thread_count = (SELECT COUNT(*) FROM threads t WHERE t.bundle_id = bundles.id AND t.merged_into IS NULL),
         message_count = (SELECT COALESCE(SUM(t.message_count), 0) FROM threads t WHERE t.bundle_id = bundles.id AND t.merged_into IS NULL),
         first_message_at = COALESCE((SELECT MIN(t.first_message_at) FROM threads t WHERE t.bundle_id = bundles.id), first_message_at),
         last_message_at = COALESCE((SELECT MAX(t.last_message_at) FROM threads t WHERE t.bundle_id = bundles.id), last_message_at)
       WHERE id = ?`
    )
    .bind(bundleId)
    .run();
}

/**
 * Batch assignment after ingest: threads that just received a not-from-me message from a bundled sender join that
 * sender's open bundle for the account (creating one when none is open). Threads sitting in a seen bundle move to the
 * open one. Bundling is not retroactive: only threads touched by new mail are considered.
 */
export async function assignBundles(db: Db, accountId: string, threadIds: string[]): Promise<void> {
  if (!threadIds.length) return;
  const t = Date.now();
  for (const ids of chunk(threadIds, 90)) {
    const rows = await db
      .prepare(
        `SELECT t.id, t.bundle_id, t.last_from_email, t.last_message_at, t.first_message_at, t.message_count, c.id AS contact_id
         FROM threads t JOIN contacts c ON c.account_id = t.account_id AND c.email = t.last_from_email
         WHERE t.account_id = ? AND t.id IN (${placeholders(ids.length)}) AND c.bundled = 1 AND t.bucket IN ('imbox','paper_trail') AND t.merged_into IS NULL AND t.is_sent_only = 0`
      )
      .bind(accountId, ...ids)
      .all<{ id: string; bundle_id: string | null; last_from_email: string; last_message_at: number; first_message_at: number; message_count: number; contact_id: string }>();
    const touched = new Set<string>();
    for (const r of rows.results) {
      let open = await db
        .prepare(`SELECT id FROM bundles WHERE account_id = ? AND email = ? AND status = 'open' LIMIT 1`)
        .bind(accountId, r.last_from_email)
        .first<{ id: string }>();
      if (!open) {
        const id = crypto.randomUUID();
        await db
          .prepare(`INSERT INTO bundles (id, account_id, contact_id, email, status, thread_count, message_count, first_message_at, last_message_at, seen_at, created_at) VALUES (?, ?, ?, ?, 'open', 0, 0, ?, ?, NULL, ?)`)
          .bind(id, accountId, r.contact_id, r.last_from_email, r.last_message_at, r.last_message_at, t)
          .run();
        open = { id };
      }
      if (r.bundle_id !== open.id) {
        if (r.bundle_id) touched.add(r.bundle_id);
        await db.prepare(`UPDATE threads SET bundle_id = ?, updated_at = ? WHERE id = ?`).bind(open.id, t, r.id).run();
      }
      touched.add(open.id);
    }
    for (const id of touched) await refreshBundle(db, id);
  }
}
