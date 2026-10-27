// What can be done to a thread: read it, park it, move it, merge it, label it, delete it. One handler per action; applyAction finds the thread and runs the one asked for.
//
// Most actions are written for a list of threads, not one: the thread under the cursor is a list of one, and "select 100 and press e" is a list of a hundred, and
// both are a few statements, not a few for each thread. The four that need a thread of their own (merge, bundle, rename, note) are written for one, and a list of
// them is done one at a time.
import { type AccountRow, type ContactRow, type ThreadRow, accountsById, chunk, inClause, now, placeholders, runBatch, safeJson } from "./db";
import type { Address, Bucket } from "@shared/types";
import { idList } from "./input";
import { applyBundleFlag } from "./routes/screener";
import { gmailPost } from "./google";

export type ActionBody = {
  action: string;
  on?: boolean;
  at?: number | null;
  bucket?: Bucket;
  subject?: string | null;
  note?: string;
  thread_ids?: string[];
  add?: string[];
  remove?: string[];
};

export async function ownedThread(c: any, id: string): Promise<ThreadRow | null> {
  const db: Db = c.env.DB;
  const user = c.get("user");
  return (await db.prepare(`SELECT t.* FROM threads t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND a.user_id = ?`).bind(id, user.id).first<ThreadRow>()) ?? null;
}

type Result = { ok: true } | { error: string; status: number };

/** What a one-thread action is handed: the request, the thread and the few helpers it uses. */
interface Act {
  c: any;
  db: Db;
  t: number;
  row: ThreadRow;
  threadId: string;
  accId: string;
  body: ActionBody;
  /** Update this thread's own row, and stamp it. */
  upd: (sql: string, ...params: unknown[]) => Promise<unknown>;
}
type Handler = (a: Act) => Promise<Result>;

/** The part of a thread an action for many threads needs. */
type Target = Pick<ThreadRow, "id" | "account_id" | "bucket" | "gmail_thread_id">;
/** What an action for many threads is handed: the threads, all of them the user's, and the helpers it uses. */
interface ActMany {
  c: any;
  db: Db;
  t: number;
  rows: Target[];
  ids: string[];
  body: ActionBody;
  ownedIn: ReturnType<typeof inClause>;
  /** The accounts of these threads, for calls to Gmail (each thread's own, never the header account). */
  accountsOf: (rows: Target[]) => Promise<Map<string, AccountRow>>;
}
type ManyHandler = (a: ActMany) => Promise<Result>;

const OK: Result = { ok: true };
const inIds = (ids: string[]) => `(${placeholders(ids.length)})`;
/** One statement for all the threads: set these columns and stamp them. */
const setAll = (db: Db, t: number, ids: string[], sql: string, ...params: unknown[]) => db.prepare(`UPDATE threads SET ${sql}, updated_at = ? WHERE id IN ${inIds(ids)}`).bind(...params, t, ...ids);
/** The messages of these threads that are unread, marked read; the ones already read are not written again. */
const readMessages = (db: Db, ids: string[]) => db.prepare(`UPDATE messages SET unread = 0 WHERE thread_id IN ${inIds(ids)} AND unread = 1`).bind(...ids);

const bundle: Handler = async ({ db, t, row, accId, body }) => {
  const email = row.last_from_email.toLowerCase();
  let contact = await db.prepare(`SELECT * FROM contacts WHERE account_id = ? AND email = ?`).bind(accId, email).first<ContactRow>();
  if (!contact) {
    const status = row.bucket === "paper_trail" || row.bucket === "imbox" ? row.bucket : "imbox";
    contact = {
      id: crypto.randomUUID(), account_id: accId, email, name: row.last_from_name ?? "", screen_status: status, screened_at: t,
      first_seen_at: t, last_seen_at: t, message_count: 0, notes: "", avatar_url: "", bundled: 0, photo_checked_at: null,
    };
  }
  await applyBundleFlag(db, accId, contact, body.on !== false);
  return { ok: true };
};

const rename: Handler = async ({ body, upd }) => {
  const s = typeof body.subject !== "string" || body.subject.trim() === "" ? null : body.subject.trim().slice(0, 500);
  await upd(`custom_subject = ?`, s);
  return { ok: true };
};

const note: Handler = async ({ body, upd }) => {
  await upd(`note = ?`, typeof body.note === "string" ? body.note.slice(0, 10_000) : "");
  return { ok: true };
};

const merge: Handler = async ({ db, t, row, threadId, accId, body }) => {
  const ids = idList(body.thread_ids, 200).filter((x) => x !== threadId);
  if (!ids.length) return { error: "no_threads", status: 400 };
  // Merging only within the same Gmail account (messages/attachments are keyed by account).
  const others = await db
    .prepare(`SELECT * FROM threads WHERE account_id = ? AND id IN (${placeholders(ids.length)}) AND merged_into IS NULL`)
    .bind(accId, ...ids)
    .all<ThreadRow>();
  if (!others.results.length) return { error: "not_found", status: 404 };
  let participants = safeJson<Address[]>(row.participants_json, []);
  let count = row.message_count;
  let last = row.last_message_at;
  let first = row.first_message_at;
  const stmts: DbStatement[] = [];
  for (const o of others.results) {
    count += o.message_count;
    last = Math.max(last, o.last_message_at);
    first = Math.min(first, o.first_message_at);
    const map = new Map(participants.map((p) => [p.email, p]));
    for (const p of safeJson<Address[]>(o.participants_json, [])) if (!map.has(p.email)) map.set(p.email, p);
    participants = [...map.values()];
    stmts.push(db.prepare(`UPDATE threads SET merged_into = ?, reply_later = 0, set_aside = 0, updated_at = ? WHERE id = ?`).bind(threadId, t, o.id));
    // Also re-point threads that were merged into the other thread.
    stmts.push(db.prepare(`UPDATE threads SET merged_into = ? WHERE merged_into = ?`).bind(threadId, o.id));
  }
  stmts.push(
    db
      .prepare(`UPDATE threads SET message_count = ?, last_message_at = ?, first_message_at = ?, participants_json = ?, has_attachments = GREATEST(has_attachments, ?), updated_at = ? WHERE id = ?`)
      .bind(count, last, first, JSON.stringify(participants), others.results.some((o) => o.has_attachments) ? 1 : 0, t, threadId)
  );
  await runBatch(db, stmts, 40);
  return { ok: true };
};

// ---------- Actions for many threads ----------

const mark_unread: ManyHandler = async ({ db, t, ids }) => {
  await setAll(db, t, ids, `unread = 1, seen = 0`).run();
  return OK;
};

const mark_read: ManyHandler = async ({ db, t, ids }) => {
  await db.batch([setAll(db, t, ids, `unread = 0, seen = 1`), readMessages(db, ids)]);
  return OK;
};

const seen: ManyHandler = async ({ db, t, ids }) => {
  await db.batch([setAll(db, t, ids, `seen = 1, unread = 0, bubbled = 0`), readMessages(db, ids)]);
  return OK;
};

const reply_later: ManyHandler = async ({ db, t, ids, body }) => {
  const on = body.on !== false;
  await setAll(db, t, ids, `reply_later = ?, reply_later_at = ?, set_aside = CASE WHEN ? THEN 0 ELSE set_aside END`, on ? 1 : 0, on ? t : null, on ? 1 : 0).run();
  return OK;
};

const set_aside: ManyHandler = async ({ db, t, ids, body }) => {
  const on = body.on !== false;
  await setAll(db, t, ids, `set_aside = ?, set_aside_at = ?, reply_later = CASE WHEN ? THEN 0 ELSE reply_later END`, on ? 1 : 0, on ? t : null, on ? 1 : 0).run();
  return OK;
};

const bubble_up: ManyHandler = async ({ db, t, ids, body }) => {
  const at = body.at == null ? null : Number(body.at);
  if (at != null && (!Number.isFinite(at) || at <= t)) return { error: "invalid_time", status: 400 };
  await setAll(db, t, ids, `bubble_up_at = ?, bubbled = 0`, at).run();
  return OK;
};

const move: ManyHandler = async ({ c, db, t, rows, ids, body, accountsOf }) => {
  const b = body.bucket;
  if (!b || !["imbox", "feed", "paper_trail", "trash", "screened_out", "screener"].includes(b)) return { error: "invalid_bucket", status: 400 };
  await setAll(db, t, ids, `bucket = ?, reply_later = CASE WHEN ? = 'trash' THEN 0 ELSE reply_later END, set_aside = CASE WHEN ? = 'trash' THEN 0 ELSE set_aside END`, b, b, b).run();
  // Into the trash, or out of it, Gmail is told, each thread through its own account.
  const touched = rows.filter((r) => b === "trash" || r.bucket === "trash");
  if (touched.length) {
    const accounts = await accountsOf(touched);
    for (const r of touched) {
      const acc = accounts.get(r.account_id);
      if (acc) c.executionCtx.waitUntil(gmailPost(c.env, acc, `threads/${r.gmail_thread_id}/${b === "trash" ? "trash" : "untrash"}`, {}).catch(() => {}));
    }
  }
  return OK;
};

const labels: ManyHandler = async ({ db, ids, body, ownedIn }) => {
  const add = idList(body.add, 100);
  const remove = idList(body.remove, 100);
  const stmts: DbStatement[] = [];
  // A label of another person's is not added: only labels of the user's own mailboxes are found.
  if (add.length) {
    stmts.push(
      db
        .prepare(`INSERT INTO thread_labels (thread_id, label_id) SELECT t.id, l.id FROM threads t CROSS JOIN labels l WHERE t.id IN ${inIds(ids)} AND l.id IN ${inIds(add)} AND l.account_id IN ${ownedIn.sql} ON CONFLICT DO NOTHING`)
        .bind(...ids, ...add, ...ownedIn.params)
    );
  }
  if (remove.length) stmts.push(db.prepare(`DELETE FROM thread_labels WHERE thread_id IN ${inIds(ids)} AND label_id IN ${inIds(remove)}`).bind(...ids, ...remove));
  if (stmts.length) await db.batch(stmts);
  return OK;
};

const collections: ManyHandler = async ({ db, t, ids, body, ownedIn }) => {
  const add = idList(body.add, 100);
  const remove = idList(body.remove, 100);
  const stmts: DbStatement[] = [];
  if (add.length) {
    stmts.push(
      db
        .prepare(`INSERT INTO collection_threads (collection_id, thread_id, added_at) SELECT c.id, t.id, ? FROM collections c CROSS JOIN threads t WHERE c.id IN ${inIds(add)} AND c.account_id IN ${ownedIn.sql} AND t.id IN ${inIds(ids)} ON CONFLICT DO NOTHING`)
        .bind(t, ...add, ...ownedIn.params, ...ids),
      db.prepare(`UPDATE collections SET updated_at = ? WHERE id IN ${inIds(add)} AND account_id IN ${ownedIn.sql}`).bind(t, ...add, ...ownedIn.params)
    );
  }
  if (remove.length) stmts.push(db.prepare(`DELETE FROM collection_threads WHERE collection_id IN ${inIds(remove)} AND thread_id IN ${inIds(ids)}`).bind(...remove, ...ids));
  if (stmts.length) await db.batch(stmts);
  return OK;
};

const delete_thread: ManyHandler = async ({ c, db, rows, ids, ownedIn, accountsOf }) => {
  // The threads merged into these go with them.
  const merged = await db
    .prepare(`SELECT id, gmail_thread_id, merged_into FROM threads WHERE merged_into IN ${inIds(ids)} AND account_id IN ${ownedIn.sql}`)
    .bind(...ids, ...ownedIn.params)
    .all<{ id: string; gmail_thread_id: string; merged_into: string }>();
  const all = [...ids, ...merged.results.map((m) => m.id)];
  await db.batch([
    db.prepare(`DELETE FROM thread_labels WHERE thread_id IN ${inIds(all)}`).bind(...all),
    db.prepare(`DELETE FROM collection_threads WHERE thread_id IN ${inIds(all)}`).bind(...all),
    db.prepare(`DELETE FROM clips WHERE thread_id IN ${inIds(all)}`).bind(...all),
    db.prepare(`DELETE FROM attachments WHERE thread_id IN ${inIds(all)}`).bind(...all),
    db.prepare(`DELETE FROM messages WHERE thread_id IN ${inIds(all)}`).bind(...all),
    db.prepare(`DELETE FROM threads WHERE id IN ${inIds(all)}`).bind(...all),
  ]);
  const mergedOf = new Map<string, string[]>();
  for (const m of merged.results) mergedOf.set(m.merged_into, [...(mergedOf.get(m.merged_into) ?? []), m.gmail_thread_id]);
  const accounts = await accountsOf(rows);
  const calls: Promise<unknown>[] = [];
  for (const r of rows) {
    const acc = accounts.get(r.account_id);
    if (!acc) continue;
    for (const g of [r.gmail_thread_id, ...(mergedOf.get(r.id) ?? [])]) calls.push(gmailPost(c.env, acc, `threads/${g}/trash`, {}).catch(() => {}));
  }
  if (calls.length) c.executionCtx.waitUntil(Promise.all(calls));
  return OK;
};

const MANY: Record<string, ManyHandler> = { mark_unread, mark_read, seen, reply_later, set_aside, bubble_up, move, labels, collections, delete: delete_thread };
const ONE: Record<string, Handler> = { bundle, rename, note, merge };
const isMany = (action: unknown): action is string => typeof action === "string" && Object.hasOwn(MANY, action);

/** Run an action for these threads, which are the user's. `accountCache` holds accounts the caller already has, for the calls to Gmail. */
async function runMany(c: any, rows: Target[], body: ActionBody, accountCache?: Map<string, AccountRow>): Promise<Result> {
  const db: Db = c.env.DB;
  const userId = c.get("user").id;
  const accountsOf = async (rs: Target[]) => {
    const out = new Map<string, AccountRow>();
    const missing: string[] = [];
    for (const id of new Set(rs.map((r) => r.account_id))) {
      const hit = accountCache?.get(id);
      if (hit) out.set(id, hit);
      else missing.push(id);
    }
    if (missing.length) {
      for (const [id, a] of await accountsById(db, userId, missing)) {
        out.set(id, a);
        accountCache?.set(id, a);
      }
    }
    return out;
  };
  return MANY[body.action]({ c, db, t: now(), rows, ids: rows.map((r) => r.id), body, ownedIn: inClause(c.get("allAccountIds") ?? []), accountsOf });
}

export async function applyAction(c: any, threadId: string, body: ActionBody, accountCache?: Map<string, AccountRow>): Promise<Result> {
  const db: Db = c.env.DB;
  const row = await ownedThread(c, threadId);
  if (!row) return { error: "not_found", status: 404 };
  if (isMany(body.action)) return runMany(c, [row], body, accountCache);
  const handler = typeof body.action === "string" && Object.hasOwn(ONE, body.action) ? ONE[body.action] : null;
  if (!handler) return { error: "unknown_action", status: 400 };
  const t = now();
  const accId = row.account_id;
  const upd = (sql: string, ...params: unknown[]) => db.prepare(`UPDATE threads SET ${sql}, updated_at = ? WHERE id = ? AND account_id = ?`).bind(...params, t, threadId, accId).run();
  return handler({ c, db, t, row, threadId, accId, body, upd });
}

/**
 * One action for a list of threads, and how many it was done to (the ones that are the user's; an id that is not theirs or not there is skipped, as a
 * refused action is). The user's threads are read with one statement and the action is done to all of them at once. The actions that need a thread of
 * their own are done one after the other.
 */
export async function applyActionMany(c: any, threadIds: string[], body: ActionBody, accountCache?: Map<string, AccountRow>): Promise<number> {
  if (!isMany(body.action)) {
    let n = 0;
    for (const id of threadIds) if ("ok" in (await applyAction(c, id, body, accountCache))) n++;
    return n;
  }
  const db: Db = c.env.DB;
  const rows: Target[] = [];
  for (const part of chunk(threadIds, 200)) {
    const found = await db
      .prepare(`SELECT t.id, t.account_id, t.bucket, t.gmail_thread_id FROM threads t JOIN accounts a ON a.id = t.account_id WHERE t.id IN ${inIds(part)} AND a.user_id = ?`)
      .bind(...part, c.get("user").id)
      .all<Target>();
    rows.push(...found.results);
  }
  if (!rows.length) return 0;
  return "ok" in (await runMany(c, rows, body, accountCache)) ? rows.length : 0;
}
