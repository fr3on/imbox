import { now, uid } from "../../db";
import type { CalendarRow, EventRow } from "../types";
import type { EventFields } from "./input";
import { ownedCalendar } from "./owned";

const INSERT_COLUMNS =
  `id, user_id, calendar_id, remote_id, ical_uid, kind, title, description, location, emoji, all_day, starts_at, ends_at,
   start_date, end_date, timezone, rrule, exdates, master_id, occurrence_date, status, busy, countdown, circled,
   organizer_email, organizer_name, attendees_json, rsvp, conference_url, url, reminders_json, thread_id, message_id,
   done_at, etag, created_at, updated_at`;

export async function insertEvent(
  db: Db,
  userId: string,
  calendarId: string,
  f: EventFields,
  extra?: Partial<Pick<EventRow, "master_id" | "occurrence_date" | "exdates" | "ical_uid" | "organizer_email" | "organizer_name" | "rsvp" | "done_at">>
): Promise<EventRow> {
  const t = now();
  const row: EventRow = {
    id: uid(),
    user_id: userId,
    calendar_id: calendarId,
    remote_id: null,
    ical_uid: extra?.ical_uid ?? null,
    exdates: extra?.exdates ?? "",
    master_id: extra?.master_id ?? null,
    occurrence_date: extra?.occurrence_date ?? null,
    organizer_email: extra?.organizer_email ?? "",
    organizer_name: extra?.organizer_name ?? "",
    rsvp: extra?.rsvp ?? "",
    done_at: extra?.done_at ?? null,
    etag: null,
    created_at: t,
    updated_at: t,
    ...f,
  };
  await db
    .prepare(`INSERT INTO events (${INSERT_COLUMNS}) VALUES (${Array(37).fill("?").join(", ")})`)
    .bind(
      row.id, row.user_id, row.calendar_id, row.remote_id, row.ical_uid, row.kind, row.title, row.description, row.location,
      row.emoji, row.all_day, row.starts_at, row.ends_at, row.start_date, row.end_date, row.timezone, row.rrule, row.exdates,
      row.master_id, row.occurrence_date, row.status, row.busy, row.countdown, row.circled, row.organizer_email,
      row.organizer_name, row.attendees_json, row.rsvp, row.conference_url, row.url, row.reminders_json, row.thread_id,
      row.message_id, row.done_at, row.etag, row.created_at, row.updated_at
    )
    .run();
  return row;
}

export async function updateEventRow(db: Db, row: EventRow, f: EventFields): Promise<EventRow> {
  const next: EventRow = { ...row, ...f, updated_at: now() };
  await db
    .prepare(
      `UPDATE events SET kind = ?, title = ?, description = ?, location = ?, emoji = ?, all_day = ?, starts_at = ?, ends_at = ?,
         start_date = ?, end_date = ?, timezone = ?, rrule = ?, status = ?, busy = ?, countdown = ?, circled = ?,
         attendees_json = ?, conference_url = ?, url = ?, reminders_json = ?, thread_id = ?, message_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      next.kind, next.title, next.description, next.location, next.emoji, next.all_day, next.starts_at, next.ends_at,
      next.start_date, next.end_date, next.timezone, next.rrule, next.status, next.busy, next.countdown, next.circled,
      next.attendees_json, next.conference_url, next.url, next.reminders_json, next.thread_id, next.message_id,
      next.updated_at, next.id
    )
    .run();
  return next;
}

/** The calendar a create lands on: the one asked for, else the default, else the first writable one. */
export async function defaultCalendar(db: Db, userId: string, calendarId?: string): Promise<CalendarRow> {
  if (calendarId) {
    const cal = await ownedCalendar(db, userId, calendarId);
    if (!cal) throw new Error("no_calendar");
    return cal;
  }
  const def = await db
    .prepare(`SELECT * FROM calendars WHERE user_id = ? AND is_default = 1 AND source <> 'ics' ORDER BY position, created_at LIMIT 1`)
    .bind(userId)
    .first<CalendarRow>();
  if (def) return def;
  const first = await db
    .prepare(`SELECT * FROM calendars WHERE user_id = ? AND source <> 'ics' AND (writable = 1 OR source = 'local') ORDER BY position, created_at LIMIT 1`)
    .bind(userId)
    .first<CalendarRow>();
  if (!first) throw new Error("no_calendar");
  return first;
}
