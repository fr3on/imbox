// A calendar for every mailbox. Each IMAP mailbox gets one calendar named after its address, so the
// calendar shows what belongs to which mailbox and each can be shown or hidden on its own. It is where
// invitations that arrive in that mailbox land (./invites), and, for a mailbox on a server that speaks
// CalDAV, where that server's events are synced to (./caldav).

import { now, uid } from "../db";
import type { AccountRow } from "../db";
import type { CalendarRow } from "./types";

/** Muted, like every calendar colour here, so the blocks can carry light text. */
const PALETTE = ["#4f6f8f", "#6b8f71", "#a06b8f", "#b08a4f", "#7a6bb0", "#b06b6b", "#4f8f8f", "#8f7a4f"];

/** Tombstone key in `removed_calendars`: a calendar you removed by hand is not made again. */
export const MAILBOX_REMOTE_ID = "mailbox";

/** The same address always gets the same colour, so it does not change between visits. */
export function mailboxColor(email: string): string {
  let h = 0;
  for (const ch of email.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Mailboxes that should have a calendar and do not: IMAP ones, not agents, not removed on purpose. */
async function missing(db: Db, userId: string, accountId?: string): Promise<Pick<AccountRow, "id" | "email">[]> {
  const r = await db
    .prepare(
      `SELECT a.id, a.email FROM accounts a
       WHERE a.user_id = ? AND a.provider = 'imap' ${accountId ? "AND a.id = ?" : ""}
         AND NOT EXISTS (SELECT 1 FROM calendars c WHERE c.account_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM agent_mailboxes m WHERE m.account_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM removed_calendars x WHERE x.account_id = a.id AND x.remote_id = ?)
       ORDER BY a.created_at`
    )
    .bind(...(accountId ? [userId, accountId] : [userId]), MAILBOX_REMOTE_ID)
    .all<Pick<AccountRow, "id" | "email">>();
  return r.results;
}

/** Give every mailbox of this user a calendar. Cheap when there is nothing to do: one query. */
export async function ensureMailboxCalendars(db: Db, userId: string, accountId?: string): Promise<void> {
  const todo = await missing(db, userId, accountId);
  if (!todo.length) return;
  const pos = await db.prepare(`SELECT COALESCE(MAX(position), -1) AS p FROM calendars WHERE user_id = ?`).bind(userId).first<{ p: number }>();
  let position = (pos?.p ?? -1) + 1;
  const t = now();
  await db.batch(
    todo.map((a) =>
      db
        .prepare(
          `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at)
           VALUES (?, ?, ?, 'local', NULL, NULL, ?, '', ?, '', 1, 1, 0, ?, 'idle', ?, ?)`
        )
        .bind(uid(), userId, a.id, a.email, mailboxColor(a.email), position++, t, t)
    )
  );
}

/** The calendar of one mailbox, made if it is not there yet. Null for a mailbox that is not meant to have one. */
export async function mailboxCalendar(db: Db, account: Pick<AccountRow, "id" | "user_id" | "provider">): Promise<CalendarRow | null> {
  if (account.provider !== "imap") return null;
  await ensureMailboxCalendars(db, account.user_id, account.id);
  return db.prepare(`SELECT * FROM calendars WHERE account_id = ? ORDER BY created_at LIMIT 1`).bind(account.id).first<CalendarRow>();
}
