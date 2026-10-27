import type { EventAttendee, Reminder } from "@shared/types";
import { safeJson, } from "../../db";
import type { Env } from "../../env";
import type { IcsEventInput } from "../ical";
import { buildIcs } from "../ical";
import { parseEventId } from "./ids";
import { shiftToOccurrence } from "./input";
import { ownedCalendar, ownedEvent } from "./owned";
import { userTimezone } from "../../timezone";

/** One event as a downloadable `.ics`, occurrence-aware so `<row>@<date>` exports that instance. */
export async function eventIcs(env: Env, userId: string, id: string): Promise<string> {
  const db = env.DB;
  const parsed = parseEventId(id);
  const row = await ownedEvent(db, userId, parsed.id);
  if (!row) throw new Error("not_found");
  const cal = await ownedCalendar(db, userId, row.calendar_id);
  if (!cal) throw new Error("not_found");
  const tz = row.timezone || cal.timezone || (await userTimezone(db, userId));
  // A `<row>@<date>` id exports that one instance, so its times move and the RRULE is dropped.
  const occ = parsed.occurrence && row.rrule ? parsed.occurrence : null;
  const e = occ ? { ...shiftToOccurrence(row, occ, tz), rrule: null } : row;
  const ics: IcsEventInput = {
    uid: occ ? `${row.id}-${occ}@inbox` : row.ical_uid || `${row.id}@inbox`,
    summary: e.title,
    description: e.description,
    location: e.location,
    url: e.url,
    allDay: !!e.all_day,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    startDate: e.start_date,
    endDate: e.end_date,
    tzid: e.timezone || tz,
    rrule: e.rrule,
    organizer: e.organizer_email ? { email: e.organizer_email, name: e.organizer_name } : null,
    attendees: safeJson<EventAttendee[]>(e.attendees_json, []),
    reminders: safeJson<Reminder[]>(e.reminders_json, []).map((r) => r.minutes),
    status: e.status,
  };
  return buildIcs([ics], { name: cal.name || "Calendar" });
}
