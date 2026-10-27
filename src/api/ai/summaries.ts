// Saved thread summaries. Generating one costs a model call, so it is done once and kept; opening the thread again shows it
// straight away, and it says when new messages have arrived since so you can choose to refresh it.

import { now } from "../db";

export interface SavedSummary {
  summary: string;
  message_count: number;
  saved_at: number;
}

export async function saveSummary(db: Db, accountId: string, threadId: string, summary: string, messageCount: number): Promise<void> {
  const t = now();
  await db
    .prepare(
      `INSERT INTO thread_summaries (thread_id, account_id, summary, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET summary = excluded.summary, message_count = excluded.message_count, account_id = excluded.account_id, updated_at = excluded.updated_at`
    )
    .bind(threadId, accountId, summary, messageCount, t, t)
    .run();
}

/** The saved summary for a thread and whether the thread has grown since it was written. Null when there is none. */
export async function loadSummary(db: Db, threadId: string): Promise<(SavedSummary & { stale: boolean }) | null> {
  const row = await db.prepare(`SELECT summary, message_count, updated_at FROM thread_summaries WHERE thread_id = ?`).bind(threadId).first<{ summary: string; message_count: number; updated_at: number }>();
  if (!row) return null;
  const now_ = await db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?`).bind(threadId).first<{ n: number }>();
  return { summary: row.summary, message_count: row.message_count, saved_at: row.updated_at, stale: (now_?.n ?? 0) > row.message_count };
}

export async function deleteSummary(db: Db, threadId: string): Promise<void> {
  await db.prepare(`DELETE FROM thread_summaries WHERE thread_id = ?`).bind(threadId).run();
}
