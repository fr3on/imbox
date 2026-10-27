import type { CalEvent, Calendar, CalendarDay, CalendarSettings, CalendarView, EventAttendee, Reminder, Rsvp } from "@shared/types";
import { safeJson } from "../../db";
import { addDays, daysBetween } from "../dates";
import type { CalendarDayRow, CalendarRow, CalendarSettingsRow, EventRow } from "../types";
import { seriesMasterId } from "./ids";

export function toCalendar(r: CalendarRow, extra?: { account_email?: string | null; event_count?: number }): Calendar {
  return {
    id: r.id,
    account_id: r.account_id ?? null,
    account_email: extra?.account_email ?? null,
    source: r.source,
    remote_id: r.remote_id ?? null,
    url: r.url ?? null,
    name: r.name,
    description: r.description,
    color: r.color,
    timezone: r.timezone,
    visible: !!r.visible,
    writable: !!r.writable,
    is_default: !!r.is_default,
    position: r.position,
    last_synced_at: r.last_synced_at,
    sync_status: r.sync_status,
    sync_error: r.sync_error,
    ...(extra?.event_count !== undefined ? { event_count: extra.event_count } : {}),
  };
}

/**
 * One drawable event. `occurrence` is supplied only for an instance expanded out of a recurring
 * master: it moves the times, restamps the all-day dates, and gives the composite `<row>@<date>` id
 * the routes address a single instance by.
 */
export function toEvent(
  r: EventRow,
  cal: CalendarRow,
  occurrence?: { date: string; startsAt: number; endsAt: number; done: boolean } | null
): CalEvent {
  // An all-day master spanning N days keeps that span on every occurrence.
  const span = r.all_day && r.start_date && r.end_date ? Math.max(0, daysBetween(r.start_date, r.end_date)) : 0;
  return {
    id: occurrence ? `${r.id}@${occurrence.date}` : r.id,
    event_id: r.id,
    occurrence_date: occurrence ? occurrence.date : r.occurrence_date ?? null,
    calendar_id: r.calendar_id,
    calendar_name: cal.name,
    calendar_color: cal.color,
    source: cal.source,
    writable: cal.source !== "ics" && (cal.source === "local" || !!cal.writable),
    kind: r.kind,
    title: r.title,
    description: r.description,
    location: r.location,
    emoji: r.emoji,
    all_day: !!r.all_day,
    starts_at: occurrence ? occurrence.startsAt : r.starts_at,
    ends_at: occurrence ? occurrence.endsAt : r.ends_at,
    start_date: occurrence ? (r.all_day ? occurrence.date : null) : r.start_date,
    end_date: occurrence ? (r.all_day ? addDays(occurrence.date, span) : null) : r.end_date,
    timezone: r.timezone,
    rrule: r.rrule ?? null,
    recurring: !!r.rrule || !!r.master_id || !!seriesMasterId(r.remote_id),
    // A Google-expanded series: repeating, but with no RRULE here to narrow a save down with.
    series: !r.rrule && !r.master_id && !!seriesMasterId(r.remote_id),
    status: r.status,
    busy: !!r.busy,
    countdown: !!r.countdown,
    circled: !!r.circled,
    organizer: r.organizer_email ? { email: r.organizer_email, name: r.organizer_name } : null,
    attendees: safeJson<EventAttendee[]>(r.attendees_json, []),
    rsvp: (r.rsvp || "") as Rsvp,
    conference_url: r.conference_url,
    url: r.url,
    reminders: safeJson<Reminder[]>(r.reminders_json, []),
    thread_id: r.thread_id ?? null,
    done: occurrence ? occurrence.done : !!r.done_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function toCalendarDay(r: CalendarDayRow): CalendarDay {
  return {
    date: r.date,
    label: r.label,
    cover_url: r.cover_url,
    cover_id: r.cover_id ?? null,
    cover_position: r.cover_position || "50% 50%",
    has_journal: !!(r.journal_html?.trim()),
    journal_updated_at: r.journal_updated_at,
  };
}

export function toSettings(r: CalendarSettingsRow): CalendarSettings {
  return {
    timezone: r.timezone,
    week_start: r.week_start,
    night_start: r.night_start,
    night_end: r.night_end,
    collapse_night: !!r.collapse_night,
    time_format: r.time_format === "24" ? "24" : "12",
    default_view: (["days", "week", "month", "year"].includes(r.default_view) ? r.default_view : "week") as CalendarView,
    show_declined: !!r.show_declined,
    cover_art: !!r.cover_art,
  };
}
