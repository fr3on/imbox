import type { CalEvent } from "@shared/types";
import type { Env } from "../../env";
import { addDays, daysBetween, isValidDate, minutesOfDay, zonedTime } from "../dates";
import { createRemoteEvent } from "../google";
import { parseEventId } from "./ids";
import { assertWritable, fieldsFrom, type EventInput } from "./input";
import { toEvent } from "./mappers";
import { ownedCalendar, ownedEvent } from "./owned";
import { mirrorGoogle } from "./remote";
import { defaultCalendar, insertEvent } from "./rows";
import { userTimezone } from "../../timezone";

export async function createEvent(env: Env, userId: string, input: EventInput): Promise<CalEvent> {
  const db = env.DB;
  const cal = await defaultCalendar(db, userId, input.calendar_id);
  assertWritable(cal);
  const f = fieldsFrom(input, null, cal.timezone || (await userTimezone(db, userId)));
  let row = await insertEvent(db, userId, cal.id, f);

  const remote = await mirrorGoogle(env, cal, "create", (account) => createRemoteEvent(env, cal, account, row));
  if (remote?.remote_id) {
    row = { ...row, remote_id: remote.remote_id, etag: remote.etag ?? null };
    await db.prepare(`UPDATE events SET remote_id = ?, etag = ? WHERE id = ?`).bind(row.remote_id, row.etag, row.id).run();
  }
  return toEvent(row, cal);
}

/**
 * Copy an event, or one occurrence of a repeating one, into a standalone event on the same
 * calendar. The copy is deliberately plain: no recurrence, no attendees, and no link back to the
 * mail it may have come from — duplicating is for "the same thing again", not for re-inviting a
 * room full of people or forking a series. It keeps its times, so the caller can move it.
 */
export async function duplicateEvent(env: Env, userId: string, id: string): Promise<CalEvent> {
  const db = env.DB;
  const parsed = parseEventId(id);
  const row = await ownedEvent(db, userId, parsed.id);
  if (!row) throw new Error("not_found");
  const cal = await ownedCalendar(db, userId, row.calendar_id);
  if (!cal) throw new Error("not_found");
  assertWritable(cal);

  // For one occurrence of a series, copy that occurrence's own times rather than the master's.
  let starts = row.starts_at;
  let ends = row.ends_at;
  let startDate = row.start_date;
  let endDate = row.end_date;
  if (row.rrule && parsed.occurrence && isValidDate(parsed.occurrence)) {
    const tz = row.timezone || cal.timezone || (await userTimezone(db, userId));
    const span = row.ends_at - row.starts_at;
    const shifted = row.all_day
      ? Date.parse(`${parsed.occurrence}T00:00:00Z`)
      : zonedTime(parsed.occurrence, minutesOfDay(row.starts_at, tz), tz);
    starts = shifted;
    ends = shifted + span;
    if (row.all_day) {
      const days = row.start_date && row.end_date ? daysBetween(row.start_date, row.end_date) : 0;
      startDate = parsed.occurrence;
      endDate = addDays(parsed.occurrence, Math.max(0, days));
    }
  }

  return createEvent(env, userId, {
    calendar_id: cal.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    location: row.location,
    emoji: row.emoji,
    all_day: !!row.all_day,
    starts_at: starts,
    ends_at: ends,
    start_date: startDate,
    end_date: endDate,
    timezone: row.timezone,
    status: row.status,
    busy: !!row.busy,
    countdown: !!row.countdown,
    circled: !!row.circled,
    conference_url: row.conference_url,
    url: row.url,
    reminders: JSON.parse(row.reminders_json || "[]") as { minutes: number }[],
  });
}
