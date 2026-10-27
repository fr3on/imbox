import { type ActionBody, applyActionMany } from "../../routes/mail";
import { THREAD_TEXT } from "../../search";
import { type AccountRow, type ThreadRow, inClause, uid } from "../../db";
import type { AiBulkActionProposal, AiBulkThreadItem } from "@shared/types";
import { type Handler, accountById, shim, text, FLAGGED } from "./context";

export const bulk_thread_action: Handler = async ({ ctx, input, db, sc, ok, fail }) => {
  const action = String(input.action || "");
  if (!["move", "mark_read", "mark_unread", "reply_later", "set_aside", "trash"].includes(action)) {
    return fail("Invalid action. Must be one of: move, mark_read, mark_unread, reply_later, set_aside, trash");
  }
  const targetBucket = action === "trash" ? "trash" : text(input.bucket);
  if (action === "move" && !["imbox", "feed", "paper_trail", "trash", "screened_out", "screener"].includes(targetBucket)) {
    return fail("For action 'move', a valid bucket (imbox, feed, paper_trail, trash) is required");
  }

  let rows: ThreadRow[] = [];
  const explicitIds = Array.isArray(input.thread_ids) ? (input.thread_ids as unknown[]).map(String).filter(Boolean) : [];

  if (explicitIds.length > 0) {
    const inSql = inClause(explicitIds);
    const res = await db
      .prepare(`SELECT t.* FROM threads t WHERE t.id IN ${inSql.sql} AND t.account_id IN ${sc.sql} AND t.merged_into IS NULL LIMIT 100`)
      .bind(...inSql.params, ...sc.params)
      .all<ThreadRow>();
    rows = res.results;
  } else {
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
    const where: string[] = [`t.account_id IN ${sc.sql}`, `t.merged_into IS NULL`];
    const params: unknown[] = [...sc.params];

    const currentBucket = text(input.current_bucket);
    if (FLAGGED[currentBucket]) {
      where.push(FLAGGED[currentBucket]);
    } else if (currentBucket) {
      where.push(`t.bucket = ?`);
      params.push(currentBucket);
    } else {
      where.push(`t.bucket <> 'trash'`);
    }

    if (input.unread_only) {
      where.push(`(t.unread = 1 OR t.seen = 0)`);
    }

    const fromSender = text(input.from_sender);
    if (fromSender) {
      const likeSender = `%${fromSender}%`;
      where.push(`(t.last_from_email ILIKE ? OR t.last_from_name ILIKE ?)`);
      params.push(likeSender, likeSender);
    }

    const q = text(input.query);
    if (q) {
      const like = `%${q}%`;
      where.push(`(${THREAD_TEXT("t")}) ILIKE ? AND (t.subject ILIKE ? OR t.custom_subject ILIKE ? OR t.snippet ILIKE ?)`);
      params.push(like, like, like, like);
    }

    const res = await db
      .prepare(`SELECT t.* FROM threads t WHERE ${where.join(" AND ")} ORDER BY t.last_message_at DESC LIMIT ?`)
      .bind(...params, limit)
      .all<ThreadRow>();
    rows = res.results;
  }

  if (!rows.length) {
    return fail("No matching threads found for this bulk action.");
  }

  const threadItems: AiBulkThreadItem[] = rows.map((r) => ({
    id: r.id,
    subject: r.custom_subject || r.subject,
    from: r.last_from_name ? `${r.last_from_name} <${r.last_from_email}>` : r.last_from_email,
    previous_bucket: r.bucket,
    previous_unread: !!r.unread,
  }));
  const threadIds = rows.map((r) => r.id);

  const n = threadIds.length;
  const noun = `${n} thread${n === 1 ? "" : "s"}`;
  const desc =
    action === "move" || action === "trash" ? `Move ${noun} to ${targetBucket.replace("_", " ")}`
    : action === "mark_read" ? `Mark ${noun} as read`
    : action === "mark_unread" ? `Mark ${noun} as unread`
    : action === "reply_later" ? `Add ${noun} to Reply Later`
    : `Set aside ${noun}`;

  const confirmed = input.confirm === true;
  if (confirmed) {
    const accountCache = new Map<string, AccountRow>();
    for (const a of ctx.accounts) accountCache.set(a.id, a);

    const actionBody: ActionBody =
      action === "mark_read" || action === "mark_unread" ? { action }
      : action === "reply_later" || action === "set_aside" ? { action, on: true }
      : { action: "move", bucket: targetBucket as any };

    // All the threads at once, those in a mailbox the assistant can see.
    await applyActionMany(shim(ctx), rows.filter((r) => accountById(ctx, r.account_id)).map((r) => r.id), actionBody, accountCache);
  }

  const proposal: AiBulkActionProposal = {
    id: uid(),
    description: desc,
    action: action as any,
    bucket: targetBucket || undefined,
    thread_ids: threadIds,
    threads: threadItems,
    applied: confirmed,
  };

  ctx.emit({ type: "bulk_action_proposal", proposal });

  if (confirmed) {
    return ok(
      { ok: true, count: threadIds.length, applied: true, proposal },
      `Completed: ${desc}. An undo card has been shown to the user.`
    );
  } else {
    return ok(
      { ok: true, count: threadIds.length, applied: false, proposal },
      `Proposed: ${desc}? A confirmation card has been shown to the user with Apply and Undo options.`
    );
  }
};

export const undo_bulk_action: Handler = async ({ ctx, input, ok, fail }) => {
  const threadIds = (Array.isArray(input.thread_ids) ? input.thread_ids : []).map(String).filter(Boolean);
  if (!threadIds.length) return fail("No thread IDs provided to undo");
  const restoreAction = String(input.restore_action || "");
  const restoreBucket = typeof input.restore_bucket === "string" ? input.restore_bucket : "imbox";

  let body: ActionBody;
  if (restoreAction === "mark_unread") {
    body = { action: "mark_unread" };
  } else if (restoreAction === "mark_read") {
    body = { action: "mark_read" };
  } else if (restoreAction === "reply_later_off") {
    body = { action: "reply_later", on: false };
  } else if (restoreAction === "set_aside_off") {
    body = { action: "set_aside", on: false };
  } else {
    body = { action: "move", bucket: restoreBucket as any };
  }

  const accountCache = new Map<string, AccountRow>();
  for (const a of ctx.accounts) accountCache.set(a.id, a);

  // The ones that are still the user's are put back together; a thread that is gone is skipped.
  const restoredCount = await applyActionMany(shim(ctx), threadIds, body, accountCache);

  return ok(
    { ok: true, restored_count: restoredCount, thread_ids: threadIds },
    `Undone bulk action · Restored ${restoredCount} thread${restoredCount === 1 ? "" : "s"}`
  );
};
