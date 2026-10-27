// The notification center. Nothing is stored per notification: the list is worked out from mail, senders, mailbox health and
// invitations as they stand, newest first, and "unread" is simply "newer than the last time you opened the list".

import { isActive, splitForAway, vacationOf } from "./vacation";
import { now } from "./db";

export type NotificationKind = "mail" | "sender" | "sync" | "invite" | "agent";

export interface Notification {
  /** Stable for the same thing, so the app can tell what it has already announced. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  at: number;
  /** The mailbox it concerns, when there is more than one to tell apart. */
  mailbox: string;
}

const MAIL_WINDOW_MS = 14 * 24 * 3600_000;
const LIMIT = 60;

/** Everything worth telling this person about, newest first. Agent mailboxes are not theirs to be notified about. */
export async function listNotifications(db: Db, userId: string): Promise<Notification[]> {
  const t = now();
  const out: Notification[] = [];
  const own = `a.user_id = ? AND NOT EXISTS (SELECT 1 FROM agent_mailboxes m WHERE m.account_id = a.id)`;

  // Mail from people you have let in, that they wrote last, recently. A reply in a conversation you wrote in counts wherever its sender is filed. Bundled, snoozed and parked threads are quiet on purpose.
  const mail = await db
    .prepare(
      `SELECT t.id, t.subject, t.custom_subject, t.last_from_name, t.last_from_email, t.last_message_at, a.email AS mailbox
       FROM threads t JOIN accounts a ON a.id = t.account_id
       WHERE ${own} AND (t.bucket = 'imbox' OR (t.bucket IN ('feed', 'paper_trail') AND EXISTS (SELECT 1 FROM messages sm WHERE sm.thread_id = t.id AND sm.is_from_me = 1))) AND t.bundle_id IS NULL AND t.reply_later = 0 AND t.set_aside = 0 AND t.last_message_at > ?
         AND lower(t.last_from_email) NOT IN (SELECT lower(email) FROM accounts WHERE user_id = ?)
       ORDER BY t.last_message_at DESC LIMIT ?`
    )
    .bind(userId, t - MAIL_WINDOW_MS, userId, LIMIT)
    .all<{ id: string; subject: string; custom_subject: string | null; last_from_name: string; last_from_email: string; last_message_at: number; mailbox: string }>();
  // Away: only the people the person writes to, and the urgent, are worth a notification. The rest waits in "Back to work".
  let shown = mail.results;
  const u = await db.prepare(`SELECT settings_json FROM users WHERE id = ?`).bind(userId).first<{ settings_json: string }>();
  const vac = vacationOf(u?.settings_json);
  if (isActive(vac)) {
    const accountIds = (await db.prepare(`SELECT id FROM accounts WHERE user_id = ?`).bind(userId).all<{ id: string }>()).results.map((a) => a.id);
    const split = await splitForAway(db, vac, shown.map((r) => ({ ...r, snippet: null })), accountIds);
    const keep = new Set(split.kept.map((r) => r.id));
    shown = shown.filter((r) => keep.has(r.id));
  }
  for (const r of shown) {
    out.push({
      id: `mail:${r.id}:${r.last_message_at}`,
      kind: "mail",
      title: r.last_from_name || r.last_from_email,
      body: r.custom_subject || r.subject || "(no subject)",
      link: `/t/${r.id}`,
      at: r.last_message_at,
      mailbox: r.mailbox,
    });
  }

  // Senders waiting at the door.
  const senders = await db
    .prepare(
      `SELECT c.id, c.name, c.email, c.last_seen_at, a.email AS mailbox
       FROM contacts c JOIN accounts a ON a.id = c.account_id
       WHERE ${own} AND c.screen_status = 'pending' AND c.last_seen_at > ?
       ORDER BY c.last_seen_at DESC LIMIT ?`
    )
    .bind(userId, t - MAIL_WINDOW_MS, LIMIT)
    .all<{ id: string; name: string; email: string; last_seen_at: number; mailbox: string }>();
  for (const r of senders.results) {
    out.push({ id: `sender:${r.id}`, kind: "sender", title: "New sender in the Screener", body: `${r.name || r.email}${r.name ? ` · ${r.email}` : ""}`, link: "/screener", at: r.last_seen_at, mailbox: r.mailbox });
  }

  // A mailbox that has stopped working is the one thing that should never wait to be noticed.
  const broken = await db
    .prepare(
      `SELECT a.id, a.email, a.sync_status, a.sync_error, COALESCE(a.last_synced_at, a.created_at) AS at
       FROM accounts a WHERE ${own} AND a.sync_status IN ('error', 'disconnected')`
    )
    .bind(userId)
    .all<{ id: string; email: string; sync_status: string; sync_error: string | null; at: number }>();
  for (const r of broken.results) {
    out.push({
      id: `sync:${r.id}:${r.sync_status}`,
      kind: "sync",
      title: r.sync_status === "disconnected" ? `${r.email} stopped syncing` : `${r.email} has a sync problem`,
      body: r.sync_error || "Open settings to reconnect it.",
      link: "/settings/accounts",
      at: r.at,
      mailbox: r.email,
    });
  }

  // Meetings that arrived by email.
  const invites = await db
    .prepare(
      `SELECT e.id, e.title, e.starts_at, e.created_at, e.thread_id, a.email AS mailbox
       FROM events e JOIN calendars c ON c.id = e.calendar_id JOIN accounts a ON a.id = c.account_id
       WHERE ${own} AND e.thread_id IS NOT NULL AND e.status <> 'cancelled' AND e.created_at > ?
       ORDER BY e.created_at DESC LIMIT ?`
    )
    .bind(userId, t - MAIL_WINDOW_MS, LIMIT)
    .all<{ id: string; title: string; starts_at: number; created_at: number; thread_id: string; mailbox: string }>();
  for (const r of invites.results) {
    out.push({
      id: `invite:${r.id}`,
      kind: "invite",
      title: `Invitation: ${r.title || "(untitled)"}`,
      body: new Date(r.starts_at).toUTCString().replace(/:\d\d GMT$/, " UTC"),
      link: `/t/${r.thread_id}`,
      at: r.created_at,
      mailbox: r.mailbox,
    });
  }

  // What your agents did on their own: replies written for you to check, replies sent, and anything that went wrong.
  const runs = await db
    .prepare(
      `SELECT r.id, r.status, r.summary, r.subject, r.from_email, r.thread_id, r.updated_at, g.name AS agent, a.email AS mailbox
       FROM auto_agent_runs r JOIN auto_agents g ON g.id = r.agent_id JOIN accounts a ON a.id = r.account_id
       WHERE g.user_id = ? AND (r.status IN ('drafted', 'replied', 'acted', 'error') OR (r.status = 'skipped' AND r.summary ILIKE 'Chose not to reply%')) AND r.updated_at > ?
       ORDER BY r.updated_at DESC LIMIT ?`
    )
    .bind(userId, t - MAIL_WINDOW_MS, LIMIT)
    .all<{ id: string; status: string; summary: string; subject: string; from_email: string; thread_id: string; updated_at: number; agent: string; mailbox: string }>();
  for (const r of runs.results) {
    // "Chose not to reply" and "organised it" both mean the agent is handing this one back to you, and that is worth hearing about.
    const handedBack = r.status === "acted" || r.status === "skipped";
    const what = r.status === "drafted" ? "drafted a reply" : r.status === "replied" ? "replied" : handedBack ? "left one for you" : "hit a problem";
    const body = r.status === "drafted" || r.status === "replied" ? `${r.subject || "(no subject)"} · ${r.from_email}` : `${r.subject || "(no subject)"} · ${r.summary.replace(/^Chose not to reply:?\s*/i, "")}`;
    out.push({ id: `agent:${r.id}:${r.status}`, kind: "agent", title: `${r.agent} ${what}`, body, link: `/t/${r.thread_id}`, at: r.updated_at, mailbox: r.mailbox });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, LIMIT);
}

/** When this person last opened the list. The first time it is asked, that is now, so history is there but nothing starts unread. */
export async function seenAt(db: Db, userId: string): Promise<number> {
  const row = await db.prepare(`SELECT seen_at FROM notification_state WHERE user_id = ?`).bind(userId).first<{ seen_at: number }>();
  if (row) return row.seen_at;
  const t = now();
  await db.prepare(`INSERT INTO notification_state (user_id, seen_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(userId, t).run();
  return t;
}

export async function markSeen(db: Db, userId: string): Promise<number> {
  const t = now();
  await db
    .prepare(`INSERT INTO notification_state (user_id, seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at`)
    .bind(userId, t)
    .run();
  return t;
}
