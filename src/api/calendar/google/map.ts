import type { EventAttendee, Reminder, Rsvp } from "@shared/types";
import { now, safeJson } from "../../db";
import { dateKey } from "../dates";
import type { CalendarRow, EventRow } from "../types";
import { DAY, type GEvent } from "./types";

export const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
/** Shift a "YYYY-MM-DD" by whole days, staying in UTC. */
export const shiftDate = (date: string, days: number) => dateKey(dayMs(date) + days * DAY, "UTC");

/** Map one instance Google handed us onto our column values. */
export function mapEvent(cal: CalendarRow, g: GEvent): Omit<EventRow, "id" | "created_at"> & { created_at: number } {
  const t = now();
  const attendees: EventAttendee[] = (g.attendees ?? [])
    .filter((a) => !!a.email)
    .map((a) => ({
      email: (a.email ?? "").toLowerCase(),
      name: a.displayName ?? "",
      rsvp: (a.responseStatus ?? "") as Rsvp,
      optional: !!a.optional,
      organizer: !!a.organizer,
    }));

  const entries = g.conferenceData?.entryPoints ?? [];
  const video = entries.find((e) => e.entryPointType === "video" && e.uri);
  const conference = g.hangoutLink || video?.uri || entries.find((e) => !!e.uri)?.uri || "";

  const reminders: Reminder[] =
    g.reminders && g.reminders.useDefault === false
      ? (g.reminders.overrides ?? []).filter((o) => typeof o.minutes === "number").map((o) => ({ minutes: o.minutes as number }))
      : [];

  const allDay = !!g.start?.date;
  let startsAt: number;
  let endsAt: number;
  let startDate: string | null = null;
  let endDate: string | null = null;
  let timezone = "";

  if (allDay) {
    const s = g.start!.date!;
    // Google's end.date is exclusive; we store the inclusive last day but keep the exclusive
    // midnight in ends_at so half-open window queries still work.
    const exclusiveEnd = g.end?.date && dayMs(g.end.date) > dayMs(s) ? g.end.date : shiftDate(s, 1);
    startDate = s;
    endDate = shiftDate(exclusiveEnd, -1);
    startsAt = dayMs(s);
    endsAt = dayMs(exclusiveEnd);
  } else {
    startsAt = Date.parse(g.start?.dateTime ?? "");
    endsAt = Date.parse(g.end?.dateTime ?? g.start?.dateTime ?? "");
    if (!Number.isFinite(startsAt)) startsAt = t;
    if (!Number.isFinite(endsAt)) endsAt = startsAt;
    timezone = g.start?.timeZone ?? "";
  }

  const self = (g.attendees ?? []).find((a) => a.self);

  return {
    user_id: cal.user_id,
    calendar_id: cal.id,
    remote_id: g.id ?? null,
    ical_uid: g.iCalUID ?? null,
    kind: "event",
    title: g.summary ?? "",
    description: g.description ?? "",
    location: g.location ?? "",
    emoji: "",
    all_day: allDay ? 1 : 0,
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: startDate,
    end_date: endDate,
    timezone,
    rrule: null,
    exdates: "",
    master_id: null,
    occurrence_date: null,
    status: g.status === "tentative" ? "tentative" : g.status === "cancelled" ? "cancelled" : "confirmed",
    busy: g.transparency === "transparent" ? 0 : 1,
    countdown: 0,
    circled: 0,
    organizer_email: (g.organizer?.email ?? "").toLowerCase(),
    organizer_name: g.organizer?.displayName ?? "",
    attendees_json: JSON.stringify(attendees),
    rsvp: self?.responseStatus ?? "",
    conference_url: conference,
    url: g.htmlLink ?? "",
    reminders_json: JSON.stringify(reminders),
    thread_id: null,
    message_id: null,
    done_at: null,
    etag: g.etag ?? null,
    created_at: t,
    updated_at: t,
  };
}

/** The Google request body for one of our rows. */
export function eventBody(row: EventRow): Record<string, unknown> {
  const attendees = safeJson<EventAttendee[]>(row.attendees_json, []);
  const reminders = safeJson<Reminder[]>(row.reminders_json, []);

  const body: Record<string, unknown> = {
    summary: row.title,
    description: row.description,
    location: row.location,
    status: row.status === "cancelled" ? "confirmed" : row.status,
    transparency: row.busy ? "opaque" : "transparent",
    reminders: {
      useDefault: false,
      overrides: reminders.filter((r) => typeof r.minutes === "number").map((r) => ({ method: "popup", minutes: r.minutes })),
    },
  };

  if (row.all_day) {
    const start = row.start_date ?? dateKey(row.starts_at, "UTC");
    const lastDay = row.end_date ?? start;
    // Google wants an exclusive end date.
    body.start = { date: start };
    body.end = { date: shiftDate(lastDay, 1) };
  } else {
    const tz = row.timezone || undefined;
    body.start = { dateTime: new Date(row.starts_at).toISOString(), ...(tz ? { timeZone: tz } : {}) };
    body.end = { dateTime: new Date(row.ends_at || row.starts_at).toISOString(), ...(tz ? { timeZone: tz } : {}) };
  }

  if (row.rrule) body.recurrence = [`RRULE:${row.rrule.replace(/^RRULE:/i, "")}`];

  if (attendees.length) {
    body.attendees = attendees.map((a) => ({
      email: a.email,
      ...(a.name ? { displayName: a.name } : {}),
      ...(a.optional ? { optional: true } : {}),
      ...(a.rsvp ? { responseStatus: a.rsvp } : {}),
    }));
  }

  return body;
}

export const sendUpdates = (row: EventRow) => (safeJson<EventAttendee[]>(row.attendees_json, []).length ? "all" : "none");
