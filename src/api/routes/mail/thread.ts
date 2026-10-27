import { Hono } from "hono";
import type { AppEnv } from "../../env";
import type { AttachmentRow, MessageRow } from "../../db";
import {
  accountForThread,
  attachAvatarsToAll,
  attachHints,
  chunk,
  getLabelsForThreads,
  now,
  placeholders,
  toMessage,
  toThreadSummary,
} from "../../db";
import { applyAction, applyActionMany, ownedThread, type ActionBody } from "../../threadActions";
import { idList } from "../../input";
import { gmailPost } from "../../google";
import type { ThreadDetail } from "@shared/types";
import { scope } from "./shared";
import { NOT_WAITING } from "../../ai/brief";
import { PHISH_OK } from "../../ai/actions";
import { recordVerdict, verdictKeys } from "../../phish";
import { actionSentence, logActivity, threadSubject } from "../../activity";
import { applyScreenDecision } from "../screener";
import type { ContactRow } from "../../db";

const thread = new Hono<AppEnv>();

// ---------- Thread detail ----------
/**
 * A thread the user owns (through any of their accounts), regardless of the requested scope, with everything the page draws, and the Gmail ids of its
 * messages that are unread now (what opening the thread has to tell Gmail).
 *
 * It is asked for in three rounds, each of things that do not depend on each other: what hangs off the thread itself (merged threads, labels,
 * collections, clips, the hint, whether the sender is bundled), then the messages and files of the thread and those merged into it, then the pictures of
 * everyone on it in one lookup.
 */
async function loadThread(c: any, id: string): Promise<{ detail: ThreadDetail; unreadGmailIds: string[] } | null> {
  const db: Db = c.env.DB;
  const row = await ownedThread(c, id);
  if (!row) return null;
  const accId = row.account_id;
  const summary = toThreadSummary(row, []);
  const [merged, labels, cols, clips, , bundled] = await Promise.all([
    db.prepare(`SELECT id, subject, custom_subject FROM threads WHERE merged_into = ? AND account_id = ?`).bind(row.id, accId).all<{ id: string; subject: string; custom_subject: string | null }>(),
    getLabelsForThreads(db, [row.id]),
    db
      .prepare(`SELECT c.id, c.name FROM collection_threads ct JOIN collections c ON c.id = ct.collection_id WHERE ct.thread_id = ? ORDER BY c.name NULLS FIRST`)
      .bind(row.id)
      .all<{ id: string; name: string }>(),
    db.prepare(`SELECT * FROM clips WHERE thread_id = ? AND account_id = ? ORDER BY created_at DESC`).bind(row.id, accId).all<any>(),
    attachHints(db, [summary]),
    // One row either way: the sender's bundled flag (none for an unknown sender) and when the thread was marked Not waiting (none if it was not).
    db
      .prepare(
        `SELECT (SELECT bundled FROM contacts WHERE account_id = ? AND email = ?) AS bundled,
                (SELECT created_at FROM thread_action_state WHERE thread_id = ? AND action_id = '${NOT_WAITING}') AS closed_at,
                (SELECT created_at FROM thread_action_state WHERE thread_id = ? AND action_id = '${PHISH_OK}') AS phish_ok_at,
                (SELECT verdict FROM phish_verdicts WHERE user_id = ? AND key = ?) AS verdict_sender,
                (SELECT verdict FROM phish_verdicts WHERE user_id = ? AND key = ?) AS verdict_domain`
      )
      .bind(row.account_id, row.last_from_email.toLowerCase(), row.id, row.id, c.get("user").id, verdictKeys(row.last_from_email)[0], c.get("user").id, verdictKeys(row.last_from_email)[1])
      .first<{ bundled: number | null; closed_at: number | null; phish_ok_at: number | null; verdict_sender: string | null; verdict_domain: string | null }>(),
  ]);
  summary.labels = labels.get(row.id) ?? [];
  const threadIds = [row.id, ...merged.results.map((m) => m.id)];
  const [msgs, atts] = await Promise.all([
    db
      .prepare(`SELECT * FROM messages WHERE thread_id IN (${placeholders(threadIds.length)}) AND account_id = ? ORDER BY date ASC`)
      .bind(...threadIds, accId)
      .all<MessageRow>(),
    db
      .prepare(`SELECT * FROM attachments WHERE thread_id IN (${placeholders(threadIds.length)}) AND account_id = ? ORDER BY created_at ASC`)
      .bind(...threadIds, accId)
      .all<AttachmentRow>(),
  ]);
  const attsByMsg = new Map<string, AttachmentRow[]>();
  for (const a of atts.results) {
    const arr = attsByMsg.get(a.message_id) ?? [];
    arr.push(a);
    attsByMsg.set(a.message_id, arr);
  }
  const messages = msgs.results.map((m) => toMessage(m, attsByMsg.get(m.id) ?? []));
  const avatars = await attachAvatarsToAll(
    db,
    [[summary]],
    messages.map((m) => ({ account_id: m.account_id, email: m.from.email }))
  );
  for (const m of messages) {
    const u = avatars.get(`${m.account_id}|${m.from.email.toLowerCase()}`);
    if (u) m.from.avatar_url = u;
  }
  const detail: ThreadDetail = {
    ...summary,
    messages,
    collections: cols.results,
    clips: clips.results.map((k) => ({ id: k.id, account_id: k.account_id, thread_id: k.thread_id, message_id: k.message_id, text: k.text, created_at: k.created_at })),
    merged_threads: merged.results.map((m) => ({ id: m.id, subject: m.custom_subject ?? m.subject })),
    sender_bundled: !!bundled?.bundled,
    not_waiting: bundled?.closed_at != null && bundled.closed_at >= row.last_message_at,
    phish_ok: bundled?.phish_ok_at != null && bundled.phish_ok_at >= row.last_message_at,
    phish_verdict: ((bundled?.verdict_sender ?? bundled?.verdict_domain) as "bad" | "ok" | null | undefined) ?? null,
  };
  const unreadGmailIds = msgs.results.filter((m) => m.thread_id === row.id && m.unread === 1).map((m) => m.gmail_message_id);
  return { detail, unreadGmailIds };
}

async function loadThreadDetail(c: any, id: string): Promise<ThreadDetail | null> {
  return (await loadThread(c, id))?.detail ?? null;
}

thread.get("/threads/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const peek = c.req.query("peek") === "1";
  const loaded = await loadThread(c, id);
  if (!loaded) return c.json({ error: "not_found" }, 404);
  const { detail, unreadGmailIds } = loaded;
  // A thread you are coming back to has some messages already read (or written by you) and some that are not. New mail resets a
  // thread to unseen, so the thread's own flag cannot say this; the messages can.
  const hadRead = detail.messages.some((m) => !m.unread);
  if (peek) {
    // A peek does not mark anything read, so the unread flags are still the truth.
    detail.was_seen = hadRead;
    detail.new_message_ids = hadRead ? detail.messages.filter((m) => m.unread && !m.is_from_me).map((m) => m.id) : [];
  }
  if (!peek && (detail.unread || !detail.seen)) {
    await db.batch([
      db.prepare(`UPDATE threads SET seen = 1, unread = 0, bubbled = 0, updated_at = ? WHERE id = ?`).bind(now(), id),
      // Only the messages that are unread: the ones already read are not written again.
      db.prepare(`UPDATE messages SET unread = 0 WHERE thread_id = ? AND unread = 1`).bind(id),
    ]);
    // Opening clears every unread flag at once, so what was new has to be captured now. It is only "since you last read" when
    // some of the thread had been read before; one you have never read has nothing to catch up on, it is simply new.
    detail.was_seen = hadRead;
    detail.new_message_ids = hadRead ? detail.messages.filter((m) => m.unread && !m.is_from_me).map((m) => m.id) : [];
    detail.seen = true;
    detail.unread = false;
    detail.bubbled = false;
    for (const m of detail.messages) m.unread = false;
    if (unreadGmailIds.length) {
      const acc = await accountForThread(db, c.get("user").id, id);
      if (acc) {
        for (const part of chunk(unreadGmailIds, 900)) {
          c.executionCtx.waitUntil(gmailPost(c.env, acc, `messages/batchModify`, { ids: part, removeLabelIds: ["UNREAD"] }).catch(() => {}));
        }
      }
    }
  }
  return c.json(detail);
});

thread.post("/threads/:id/actions", async (c) => {
  const body = await c.req.json<ActionBody>().catch(() => ({}) as ActionBody);
  const id = c.req.param("id");
  // The sentence is made before the action, because a deleted thread has no subject left to name.
  const said = actionSentence(body, await threadSubject(c.env.DB, id));
  const r = await applyAction(c, id, body);
  if ("error" in r) return c.json({ error: r.error }, r.status as any);
  if (said) await logActivity(c.env.DB, c.get("user").id, { actor: "you", ...said, threadId: body.action === "delete" ? null : id });
  if (body.action === "delete") return c.json({ ok: true, deleted: true });
  const detail = await loadThreadDetail(c, id);
  return c.json(detail);
});

// "Not now" on "Move this one to the Imbox?": the hint goes away for this message. A new message in the thread is looked at again.
thread.post("/threads/:id/hint/dismiss", async (c) => {
  const id = c.req.param("id");
  const detail = await loadThreadDetail(c, id);
  if (!detail) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`UPDATE imbox_hints SET dismissed = 1 WHERE thread_id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// "Report" a message as phishing or spam: its sender is screened out everywhere, so they are never seen again, and the thread goes to the trash.
// The mail provider is not told; this only acts inside the app.
thread.post("/threads/:id/report", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const row = await ownedThread(c, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const from = await db
    .prepare(`SELECT from_email, from_name FROM messages WHERE thread_id = ? AND account_id = ? AND is_from_me = 0 ORDER BY date DESC LIMIT 1`)
    .bind(id, row.account_id)
    .first<{ from_email: string; from_name: string }>();
  if (!from?.from_email) return c.json({ error: "no_sender" }, 400);
  const email = from.from_email.toLowerCase();
  const known = await db.prepare(`SELECT * FROM contacts WHERE account_id = ? AND lower(email) = ?`).bind(row.account_id, email).first<ContactRow>();
  const contact = known ?? ({ id: "", account_id: row.account_id, email, name: from.from_name ?? "", screen_status: "pending", avatar_url: "" } as ContactRow);
  await applyScreenDecision(db, row.account_id, contact, "screened_out", "all");
  await recordVerdict(db, c.get("user").id, email, "bad");
  await logActivity(db, c.get("user").id, { actor: "you", kind: "report", summary: `Reported ${email} as phishing`, why: "Blocked everywhere, and the conversation is in the Trash", threadId: id, accountId: row.account_id });
  const r = await applyAction(c, id, { action: "move", bucket: "trash" });
  if ("error" in r) return c.json({ error: r.error }, r.status as any);
  return c.json({ ok: true, blocked: email });
});

thread.post("/threads/bulk", async (c) => {
  const body = await c.req.json<ActionBody>().catch(() => ({}) as ActionBody);
  const ids = idList(body.thread_ids, 200);
  if (!ids.length) return c.json({ error: "no_threads" }, 400);
  if (body.action === "merge") return c.json({ error: "use_thread_action" }, 400);
  // The threads may span several accounts; the action is done to all of them together, and Gmail is told through each thread's own account.
  const count = await applyActionMany(c, ids, body);
  const said = count ? actionSentence(body, `${count} conversation${count === 1 ? "" : "s"}`, true) : null;
  if (said) await logActivity(c.env.DB, c.get("user").id, { actor: "you", ...said, why: "Done to a selection" });
  return c.json({ ok: true, count });
});

// Delete everything in the trash for good (this person's mailboxes), in rounds so a very full trash does not hold one request open for long.
thread.post("/threads/empty-trash", async (c) => {
  const sc = scope(c);
  let deleted = 0;
  for (let round = 0; round < 10; round++) {
    const rows = await c.env.DB.prepare(`SELECT t.id FROM threads t WHERE ${sc.sql} AND t.bucket = 'trash' AND t.merged_into IS NULL LIMIT 200`).bind(...sc.params).all<{ id: string }>();
    if (!rows.results.length) break;
    deleted += await applyActionMany(c, rows.results.map((r) => r.id), { action: "delete" } as ActionBody);
  }
  return c.json({ ok: true, deleted });
});

export { loadThreadDetail, applyAction, applyActionMany };
export type { ActionBody };
export default thread;
