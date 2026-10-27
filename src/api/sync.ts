import type { Env } from "./env";
import { ingestMessages } from "./ingest";
import type { AccountRow } from "./db";
import { now, chunk, runBatch, logSync } from "./db";
import { gmailJson, gmailBatchGet, GmailError, hasMailScope } from "./google";
import { MicrosoftError, hasMsMailScope } from "./microsoft";
import { ImapError } from "./imap";
import { Budget } from "./jobs";
import { SmtpError } from "./smtp";
import type { GmailMessage } from "./mime";
import { syncContactPhotos } from "./people";

// ---------- Suggestion heuristics ----------
export interface SuggestInput {
  subject: string;
  from_email: string;
  list_unsubscribe?: string;
  list_id?: string;
  precedence?: string;
  labels: string[];
}

// Subjects that are almost only ever a receipt or a notice about money or a parcel. Loose words such as "order", "ticket" or "payment"
// are left out on purpose: they are just as likely to be a newsletter ("Your order of the week") or a friend ("ticket for Friday").
const RECEIPT_RE =
  /\b(receipts?|invoices?|(order|booking|reservation|shipping|delivery|payment|purchase|subscription) confirmation|order #?\d+|your (order|purchase) (#|\d|has|is|was|from|receipt)|payment (received|failed|successful|receipt)|(has|have) shipped|out for delivery|(has been|was) delivered|statement (is )?(ready|available)|e-?tickets?|itinerary|refund(ed)?|billing (statement|receipt)|subscription renew\w*|transaction receipt)\b/i;
const PAPER_SENDER_RE = /^(noreply|no-reply|no_reply|donotreply|do-not-reply|billing|receipts?|invoices?|orders?|payments?|notifications?)@/i;

export function suggestBucket(i: SuggestInput): "imbox" | "feed" | "paper_trail" {
  const labels = i.labels ?? [];
  const subj = i.subject ?? "";
  const bulk = !!i.list_unsubscribe?.trim() || !!i.list_id?.trim() || /bulk|list|junk/i.test(i.precedence ?? "");
  if (labels.includes("CATEGORY_PURCHASES") || RECEIPT_RE.test(subj)) return "paper_trail";
  // A sender that cannot be written back to, and sends no newsletter headers, is a notice or a receipt.
  if (PAPER_SENDER_RE.test(i.from_email) && !bulk) return "paper_trail";
  if (bulk || labels.includes("CATEGORY_PROMOTIONS") || labels.includes("CATEGORY_FORUMS")) return "feed";
  if (labels.includes("CATEGORY_UPDATES") && PAPER_SENDER_RE.test(i.from_email)) return "paper_trail";
  return "imbox";
}

// ---------- Sync drivers ----------
interface ListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * First sync of a freshly connected Gmail account. Nothing from the past is imported —
 * we just record Gmail's current historyId and watch for new mail from this moment on. Every sender
 * is screened when their first new message arrives.
 */
export async function startFromNow(env: Env, account: AccountRow): Promise<void> {
  const db = env.DB;
  const profile = await gmailJson<{ historyId: string }>(env, account, `profile`);
  account.history_id = profile.historyId;
  account.initial_sync_done = 1;
  account.initial_sync_count = 0;
  account.initial_sync_page_token = null;
  await db
    .prepare(`UPDATE accounts SET initial_sync_count = 0, initial_sync_page_token = NULL, initial_sync_done = 1, history_id = ? WHERE id = ?`)
    .bind(account.history_id, account.id)
    .run();
  await logSync(db, account.id, "info", "Connected — watching for new mail from now on");
  try {
    await syncContactPhotos(env, account);
  } catch (e) {
    await logSync(db, account.id, "warn", `Contact photos failed: ${(e as Error).message}`);
  }
}

interface HistoryResponse {
  history?: {
    id: string;
    messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
    messagesDeleted?: { message: { id: string; threadId: string } }[];
    labelsAdded?: { message: { id: string; threadId: string }; labelIds: string[] }[];
    labelsRemoved?: { message: { id: string; threadId: string }; labelIds: string[] }[];
  }[];
  nextPageToken?: string;
  historyId: string;
}

/** How many values go in one `IN (...)` list here. The old 90 was a limit of the database the app once ran on; each piece is a round trip. */
const IN_LIST = 500;
const inMarks = (n: number) => `(${Array.from({ length: n }, () => "?").join(",")})`;

/** After messages were deleted or their unread flags changed: the threads' flags and counts are made true again, and a thread left with no messages goes. */
async function recomputeThreadFlags(db: Db, threadIds: string[]) {
  const t = now();
  const stmts: DbStatement[] = [];
  for (const ids of chunk(threadIds, IN_LIST)) {
    stmts.push(
      db
        .prepare(
          `UPDATE threads SET
             seen = CASE WHEN threads.unread = 1 AND (SELECT COUNT(*) FROM messages m WHERE m.thread_id = threads.id AND m.unread = 1) = 0 THEN 1 ELSE seen END,
             unread = (SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM messages m WHERE m.thread_id = threads.id AND m.unread = 1),
             message_count = (SELECT COUNT(*) FROM messages m WHERE m.thread_id = threads.id),
             updated_at = ? WHERE id IN ${inMarks(ids.length)}`
        )
        .bind(t, ...ids),
      db.prepare(`DELETE FROM threads WHERE id IN ${inMarks(ids.length)} AND merged_into IS NULL AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = threads.id)`).bind(...ids)
    );
  }
  await runBatch(db, stmts, 40);
}

/** How many pages of history one pass reads, and how many new messages it fetches before it stops and leaves the rest for the next minute. */
const MAX_HISTORY_PAGES = 5;
const MAX_FETCH_PER_PASS = 300;
/** Messages fetched and ingested at a time. */
const FETCH_CHUNK = 50;

/** What the history since the cursor says happened, folded together: later changes to a message win over earlier ones. */
interface HistoryChanges {
  /** gmail message id -> thread id */
  addedIds: Map<string, string>;
  deletedIds: Set<string>;
  labelAdds: Map<string, Set<string>>;
  labelRemoves: Map<string, Set<string>>;
  /** Where the cursor can move to. */
  latestHistoryId: string;
}

type HistoryRecord = NonNullable<HistoryResponse["history"]>[number];

function foldRecord(c: HistoryChanges, rec: HistoryRecord): void {
  for (const a of rec.messagesAdded ?? []) {
    if ((a.message.labelIds ?? []).includes("SPAM")) continue;
    c.addedIds.set(a.message.id, a.message.threadId);
  }
  for (const d of rec.messagesDeleted ?? []) {
    c.deletedIds.add(d.message.id);
    c.addedIds.delete(d.message.id);
  }
  for (const l of rec.labelsAdded ?? []) {
    const s = c.labelAdds.get(l.message.id) ?? new Set<string>();
    for (const x of l.labelIds) {
      s.add(x);
      c.labelRemoves.get(l.message.id)?.delete(x);
    }
    c.labelAdds.set(l.message.id, s);
  }
  for (const l of rec.labelsRemoved ?? []) {
    const s = c.labelRemoves.get(l.message.id) ?? new Set<string>();
    for (const x of l.labelIds) {
      s.add(x);
      c.labelAdds.get(l.message.id)?.delete(x);
    }
    c.labelRemoves.set(l.message.id, s);
  }
}

/** Read the history after `startId`, a few pages at a time. */
async function readHistory(env: Env, account: AccountRow, startId: string): Promise<HistoryChanges> {
  const changes: HistoryChanges = { addedIds: new Map(), deletedIds: new Set(), labelAdds: new Map(), labelRemoves: new Map(), latestHistoryId: startId };
  // The cursor is only ever moved to a point this pass has really read up to. Gmail puts the mailbox's *current* history id on every page it
  // returns, so taking that id after reading a few pages of a long backlog would skip everything in the pages not read.
  let lastRecordId: string | null = null;
  let truncated = false;
  let pageToken: string | undefined;
  let pages = 0;
  do {
    let path = `history?startHistoryId=${encodeURIComponent(startId)}&maxResults=500&historyTypes=messageAdded&historyTypes=messageDeleted&historyTypes=labelAdded&historyTypes=labelRemoved`;
    if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;
    const h = await gmailJson<HistoryResponse>(env, account, path);
    for (const rec of h.history ?? []) {
      // Enough new mail for this pass: stop at a record boundary and leave the rest for the next minute.
      if (changes.addedIds.size >= MAX_FETCH_PER_PASS) {
        truncated = true;
        break;
      }
      lastRecordId = rec.id;
      foldRecord(changes, rec);
    }
    if (truncated) break;
    if (h.historyId) changes.latestHistoryId = h.historyId;
    pageToken = h.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_HISTORY_PAGES);
  // Stopped with pages unread (the page cap, or the mail cap above): resume from the last record read, not from where the mailbox is now.
  if (truncated || pageToken) changes.latestHistoryId = lastRecordId ?? startId;
  return changes;
}

async function saveHistoryId(db: Db, account: AccountRow, historyId: string): Promise<void> {
  account.history_id = historyId;
  await db.prepare(`UPDATE accounts SET history_id = ? WHERE id = ?`).bind(historyId, account.id).run();
}

/** The history has expired: list the last week again and take a new cursor. */
async function relistRecent(env: Env, account: AccountRow): Promise<{ added: number }> {
  await logSync(env.DB, account.id, "warn", "History expired; re-listing last 7 days");
  const list = await gmailJson<ListResponse>(env, account, `messages?maxResults=100&q=${encodeURIComponent("-in:spam -in:trash newer_than:7d")}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  let added = 0;
  if (ids.length) {
    const full = await gmailBatchGet<GmailMessage>(env, account, ids, "full");
    added = (await ingestMessages(env, account, full)).added;
  }
  const profile = await gmailJson<{ historyId: string }>(env, account, `profile`);
  await saveHistoryId(env.DB, account, profile.historyId);
  return { added };
}

/** Forget messages deleted at Gmail. Returns the threads they were in. */
async function deleteMessages(db: Db, account: AccountRow, deletedIds: Set<string>): Promise<Set<string>> {
  const affected = new Set<string>();
  // One statement for each piece: the delete says which threads the messages were in.
  const parts = await Promise.all(
    chunk([...deletedIds], IN_LIST).map((ids) =>
      db
        .prepare(`DELETE FROM messages WHERE account_id = ? AND gmail_message_id IN ${inMarks(ids.length)} RETURNING thread_id`)
        .bind(account.id, ...ids)
        .all<{ thread_id: string }>()
    )
  );
  for (const rows of parts) for (const r of rows.results) affected.add(r.thread_id);
  return affected;
}

/**
 * The updates for UNREAD and TRASH changes (other labels are not kept), and how many changes there are. Messages with the same change are updated together:
 * marking two hundred mails read in another app is a few statements, not two hundred. Changes are applied in the order they always were: what was added, then
 * what was removed.
 */
function labelStatements(db: Db, account: AccountRow, c: HistoryChanges): { stmts: DbStatement[]; changes: number } {
  const t = now();
  const idsWith = (m: Map<string, Set<string>>, label: string) => [...m].filter(([, labels]) => labels.has(label)).map(([id]) => id);
  const unreadOn = idsWith(c.labelAdds, "UNREAD");
  const unreadOff = idsWith(c.labelRemoves, "UNREAD");
  const trashOn = idsWith(c.labelAdds, "TRASH");
  const trashOff = idsWith(c.labelRemoves, "TRASH");
  const stmts: DbStatement[] = [];
  for (const ids of chunk(unreadOn, IN_LIST)) {
    stmts.push(db.prepare(`UPDATE messages SET unread = 1 WHERE account_id = ? AND is_from_me = 0 AND gmail_message_id IN ${inMarks(ids.length)}`).bind(account.id, ...ids));
  }
  for (const ids of chunk(unreadOff, IN_LIST)) {
    stmts.push(db.prepare(`UPDATE messages SET unread = 0 WHERE account_id = ? AND is_from_me = 0 AND gmail_message_id IN ${inMarks(ids.length)}`).bind(account.id, ...ids));
  }
  for (const ids of chunk(trashOn, IN_LIST)) {
    stmts.push(
      db
        .prepare(`UPDATE threads SET bucket = 'trash', updated_at = ? WHERE account_id = ? AND id IN (SELECT thread_id FROM messages WHERE account_id = ? AND gmail_message_id IN ${inMarks(ids.length)})`)
        .bind(t, account.id, account.id, ...ids)
    );
  }
  for (const ids of chunk(trashOff, IN_LIST)) {
    stmts.push(
      db
        .prepare(
          `UPDATE threads SET bucket = COALESCE((SELECT CASE c.screen_status WHEN 'pending' THEN (CASE WHEN threads.seen = 0 THEN 'screener' ELSE 'imbox' END) WHEN 'screened_out' THEN 'screened_out' ELSE c.screen_status END FROM contacts c WHERE c.account_id = threads.account_id AND c.email = threads.last_from_email), 'imbox'), updated_at = ?
           WHERE account_id = ? AND bucket = 'trash' AND id IN (SELECT thread_id FROM messages WHERE account_id = ? AND gmail_message_id IN ${inMarks(ids.length)})`
        )
        .bind(t, account.id, account.id, ...ids)
    );
  }
  return { stmts, changes: unreadOn.length + unreadOff.length + trashOn.length + trashOff.length };
}

/** The threads that hold messages whose labels changed. */
async function threadsOfMessages(db: Db, account: AccountRow, gmailIds: string[]): Promise<Set<string>> {
  const threads = new Set<string>();
  const parts = await Promise.all(
    chunk(gmailIds, IN_LIST).map((part) =>
      db
        .prepare(`SELECT DISTINCT thread_id FROM messages WHERE account_id = ? AND gmail_message_id IN ${inMarks(part.length)}`)
        .bind(account.id, ...part)
        .all<{ thread_id: string }>()
    )
  );
  for (const rows of parts) for (const r of rows.results) threads.add(r.thread_id);
  return threads;
}

export async function incrementalSync(env: Env, account: AccountRow): Promise<{ added: number }> {
  const db = env.DB;
  if (!account.history_id) {
    const profile = await gmailJson<{ historyId: string }>(env, account, `profile`);
    await saveHistoryId(db, account, profile.historyId);
    return { added: 0 };
  }

  let changes: HistoryChanges;
  try {
    changes = await readHistory(env, account, account.history_id);
  } catch (e) {
    if (e instanceof GmailError && e.status === 404) return relistRecent(env, account);
    throw e;
  }
  const { addedIds, deletedIds, labelAdds, labelRemoves } = changes;

  let added = 0;
  // In pieces, each ingested before the next is fetched: a hundred messages in full is already a lot of memory in a worker.
  for (const part of chunk([...addedIds.keys()], FETCH_CHUNK)) {
    const full = await gmailBatchGet<GmailMessage>(env, account, part, "full");
    added += (await ingestMessages(env, account, full)).added;
  }

  const affectedThreads = await deleteMessages(db, account, deletedIds);

  const labels = labelStatements(db, account, changes);
  if (labels.changes) {
    await runBatch(db, labels.stmts, 40);
    // Threads whose unread might have changed
    for (const id of await threadsOfMessages(db, account, [...new Set([...labelAdds.keys(), ...labelRemoves.keys()])])) affectedThreads.add(id);
  }
  if (affectedThreads.size) await recomputeThreadFlags(db, [...affectedThreads]);

  // Gmail hands back a historyId on every poll, but it only moves when something happened. Writing
  // it unchanged once a minute per account costs a row a minute and tells us nothing.
  if (changes.latestHistoryId !== account.history_id) await saveHistoryId(db, account, changes.latestHistoryId);
  if (added || deletedIds.size || labels.changes) {
    await logSync(db, account.id, "info", `Incremental sync: +${added} msgs, -${deletedIds.size} deleted, ${labels.changes} label changes`);
  }
  return { added };
}

// One sync at a time per account, in this process. A manual Sync, a connect or a mailbox change (all run after the reply is sent) and the once-a-minute
// job can all ask at the same moment, and two passes over one Gmail or Outlook account would read the same changes twice and race on the same threads.
// The second asker does nothing: the first is already doing it. (IMAP keeps its own guard as well, for callers that go straight to it.)
const syncing = new Set<string>();

// After a failed pass on a Gmail or Outlook account, wait before asking again, longer each time (2, 5, 10, 15, then 30 minutes), so a provider that is
// rate limiting or down is not hit again a minute later by every account. A person pressing Sync skips the wait. IMAP backs off for itself
// while it catches up (imapbox.ts), and its ordinary poll is one cheap connection.
const failures = new Map<string, { until: number; step: number }>();
export const SYNC_BACKOFF_MINUTES = [2, 5, 10, 15, 30];

const photosFailedAt = new Map<string, number>();
/** How long an account's contact photos wait after a failed pull. */
const PHOTOS_RETRY_AFTER_FAILURE_MS = 30 * 60_000;
/** A pass with less than this left does not start the contact photo pull (up to thirty requests), it is left for a pass with time. */
const PHOTOS_MIN_BUDGET_MS = 60_000;

/** Sync one account: continues initial sync (up to N chunks) or does an incremental sync. Safe for cron and manual calls. */
export async function syncAccount(env: Env, account: AccountRow, opts: SyncOptions = {}): Promise<{ added: number; status: string }> {
  if (account.sync_status === "disconnected") return { added: 0, status: "disconnected" };
  if (syncing.has(account.id)) return { added: 0, status: "ok" };
  const wait = failures.get(account.id);
  if (account.provider !== "imap" && !opts.force && wait && wait.until > Date.now()) return { added: 0, status: "waiting" };
  syncing.add(account.id);
  try {
    const out = await syncAccountNow(env, account, opts);
    if (account.provider !== "imap") {
      if (out.status === "error") {
        const step = Math.min((wait?.step ?? failures.get(account.id)?.step ?? -1) + 1, SYNC_BACKOFF_MINUTES.length - 1);
        failures.set(account.id, { until: Date.now() + SYNC_BACKOFF_MINUTES[step] * 60_000, step });
      } else failures.delete(account.id);
    }
    return out;
  } finally {
    syncing.delete(account.id);
  }
}

export interface SyncOptions {
  budgetMs?: number;
  force?: boolean;
  /** The once-a-minute job's budget for the whole mailbox pass. */
  budget?: Budget;
}

async function syncAccountNow(env: Env, account: AccountRow, opts: SyncOptions): Promise<{ added: number; status: string }> {
  const db = env.DB;
  // IMAP mailboxes hold a stored password in `imap_accounts`, not an OAuth refresh token, so the
  // token check below would wrongly disconnect every one of them.
  if (account.provider !== "imap" && !account.refresh_token) return { added: 0, status: "disconnected" };
  // An account connected for calendar only has no mail scope: every Gmail call would 403. Leave it
  // alone rather than writing a sync error every minute. (An empty `scopes` predates the column and
  // does have mail — see hasMailScope.)
  if (account.provider === "imap") {
    /* nothing to scope-check: an IMAP mailbox either has working credentials or it does not */
  } else if (account.provider === "outlook") {
    if (!hasMsMailScope(account.scopes)) return { added: 0, status: "no_mail_scope" };
  } else if (!hasMailScope(account.scopes)) {
    return { added: 0, status: "no_mail_scope" };
  }
  // The 'syncing' marker exists so a long run isn't started twice by overlapping cron ticks, and so
  // the UI can show a spinner. An incremental poll finishes in well under a second and needs
  // neither, so only the initial backfill pays for the marker. An Outlook mailbox is still walking
  // its delta chain while `initial_sync_done` is 0, so it pays for the marker on the same terms.
  const slow = !account.initial_sync_done;
  if (slow) await db.prepare(`UPDATE accounts SET sync_status = 'syncing' WHERE id = ?`).bind(account.id).run();
  let added = 0;
  try {
    if (account.provider === "imap") {
      const { syncImapAccount } = await import("./imapbox");
      added += (await syncImapAccount(env, account, opts)).added;
    } else if (account.provider === "outlook") {
      const { syncOutlookAccount } = await import("./outlook");
      added += (await syncOutlookAccount(env, account)).added;
    } else if (!account.initial_sync_done) {
      await startFromNow(env, account);
    } else {
      added += (await incrementalSync(env, account)).added;
      // Photos: daily, or 15 minutes after new senders showed up (so new people get their Gmail-style photo quickly).
      const marker = await db.prepare(`SELECT contacts_changed_at FROM accounts WHERE id = ?`).bind(account.id).first<{ contacts_changed_at: number | null }>();
      const last = account.photos_synced_at ?? 0;
      const sinceLast = now() - last;
      const newContacts = (marker?.contacts_changed_at ?? 0) > last;
      const hasTime = !opts.budget || opts.budget.left >= PHOTOS_MIN_BUDGET_MS;
      const coolingOff = Date.now() - (photosFailedAt.get(account.id) ?? 0) < PHOTOS_RETRY_AFTER_FAILURE_MS;
      if (hasTime && !coolingOff && (!account.photos_synced_at || sinceLast > 24 * 3600_000 || (newContacts && sinceLast > 15 * 60_000))) {
        try {
          await syncContactPhotos(env, account);
        } catch (e) {
          await logSync(db, account.id, "warn", `Contact photos failed: ${(e as Error).message}`);
          // A failed pull leaves `photos_synced_at` as it was, which means it is due again, so it ran again on the next tick (up to thirty requests and a
          // log row each time). It waits instead.
          photosFailedAt.set(account.id, Date.now());
        }
      }
    }
    // Every check stamps the time, quiet or not, so "Synced 2 minutes ago" is the last time the mailbox was looked at. The accounts trigger (migration 0028)
    // ignores this column, so it costs one small write per mailbox a minute and tells no window anything.
    const t = now();
    account.last_synced_at = t;
    account.sync_status = "idle";
    account.sync_error = null;
    await db
      .prepare(`UPDATE accounts SET sync_status = 'idle', sync_error = NULL, last_synced_at = ? WHERE id = ? AND sync_status <> 'disconnected'`)
      .bind(t, account.id)
      .run();
    return { added, status: "ok" };
  } catch (e) {
    const msg = ((e as Error).message ?? String(e)).slice(0, 1000);
    // Credentials the server has rejected are not going to start working on the next tick. Gmail and
    // Graph signal that with a 401; IMAP and SMTP raise it explicitly, so all four retire the account
    // rather than being re-selected by the cron a minute later, forever.
    const disconnected =
      ((e instanceof GmailError || e instanceof MicrosoftError) && (e.status === 401 || /invalid_grant|no_refresh_token/i.test(e.body))) ||
      ((e instanceof ImapError || e instanceof SmtpError) && e.auth);
    const status = disconnected ? "disconnected" : "error";
    // An account that keeps failing the same way has nothing new to record. Writing the row anyway
    // would cost an UPDATE and a log line every minute for as long as the fault lasts — the same
    // write amplification the heartbeat above exists to avoid on the success path.
    if (account.sync_status !== status || account.sync_error !== msg) {
      account.sync_status = status;
      account.sync_error = msg;
      await db
        .prepare(`UPDATE accounts SET sync_status = ?, sync_error = ?, last_synced_at = ? WHERE id = ?`)
        .bind(status, msg, now(), account.id)
        .run();
      await logSync(db, account.id, "error", `Sync failed: ${msg}`);
    }
    return { added, status };
  }
}

export async function processBubbleUps(db: Db): Promise<number> {
  const t = now();
  const r = await db
    .prepare(`UPDATE threads SET bubbled = 1, bubble_up_at = NULL, seen = 0, unread = 1, updated_at = ? WHERE bubble_up_at IS NOT NULL AND bubble_up_at <= ?`)
    .bind(t, t)
    .run();
  return r.meta.changes ?? 0;
}
