import type { CalEvent } from "@shared/types";
import { now } from "../../db";
import type { Env } from "../../env";
import { isValidDate } from "../dates";
import { setRemoteRsvp } from "../google";
import type { EventRow } from "../types";
import { parseEventId } from "./ids";
import { assertWritable, occurrenceStart } from "./input";
import { toEvent } from "./mappers";
import { ownedCalendar, ownedEvent } from "./owned";
import { mirrorGoogle } from "./remote";
import { userTimezone } from "../../timezone";

const RSVPS = ["", "needsAction", "accepted", "declined", "tentative"] as const;

export async function setRsvp(env: Env, userId: string, id: string, rsvp: string): Promise<CalEvent> {
  const db = env.DB;
  if (!(RSVPS as readonly string[]).includes(rsvp)) throw new Error("bad_rsvp");
  const parsed = parseEventId(id);
  const row = await ownedEvent(db, userId, parsed.id);
  if (!row) throw new Error("not_found");
  const cal = await ownedCalendar(db, userId, row.calendar_id);
  if (!cal) throw new Error("not_found");
  assertWritable(cal);
  // An occurrence answers for itself when it already has an override row; otherwise the series answers.
  const target =
    parsed.occurrence && row.rrule
      ? (await db
        .prepare(`SELECT * FROM events WHERE user_id = ? AND master_id = ? AND occurrence_date = ?`)
        .bind(userId, row.id, parsed.occurrence)
        .first<EventRow>()) ?? row
      : row;
  const t = now();
  await db.prepare(`UPDATE events SET rsvp = ?, updated_at = ? WHERE id = ?`).bind(rsvp, t, target.id).run();
  const next: EventRow = { ...target, rsvp, updated_at: t };
  if (next.remote_id) await mirrorGoogle(env, cal, "rsvp", (account) => setRemoteRsvp(env, cal, account, next.remote_id!, rsvp));
  return toEvent(next, cal);
}

/** Tick a todo off. Repeating todos record one row per occurrence; a plain one just stamps `done_at`. */
export async function setDone(env: Env, userId: string, id: string, done: boolean, date?: string): Promise<CalEvent> {
  const db = env.DB;
  const parsed = parseEventId(id);
  const row = await ownedEvent(db, userId, parsed.id);
  if (!row) throw new Error("not_found");
  const cal = await ownedCalendar(db, userId, row.calendar_id);
  if (!cal) throw new Error("not_found");
  assertWritable(cal);
  const tz = row.timezone || cal.timezone || (await userTimezone(db, userId));
  const occ = date && isValidDate(date) ? date : parsed.occurrence;
  const t = now();

  if (row.rrule && occ) {
    if (done) {
      await db
        .prepare(`INSERT INTO event_completions (event_id, date, done_at) VALUES (?, ?, ?) ON CONFLICT(event_id, date) DO UPDATE SET done_at = excluded.done_at`)
        .bind(row.id, occ, t)
        .run();
    } else {
      await db.prepare(`DELETE FROM event_completions WHERE event_id = ? AND date = ?`).bind(row.id, occ).run();
    }
    const dur = Math.max(0, row.ends_at - row.starts_at);
    const s = occurrenceStart(row, occ, tz);
    return toEvent(row, cal, { date: occ, startsAt: s, endsAt: s + dur, done });
  }

  await db.prepare(`UPDATE events SET done_at = ?, updated_at = ? WHERE id = ?`).bind(done ? t : null, t, row.id).run();
  return toEvent({ ...row, done_at: done ? t : null, updated_at: t }, cal);
}
