import type { CalEvent, Calendar, EventAttendee, Reminder } from "@shared/types";
import { type EventInput } from "@/api";
import { addDays, dateKey, daysBetween, minutesOfDay, msAt } from "@/lib/caldate";
import { type EditorTarget } from "@/calendar/CalendarContext";
import { baseRule, parseRepeat, stripEnd, untilStamp, type RepeatEnd, type RepeatKind } from "./recurrence";
import { DAY_MIN, STEP } from "./time";

export interface Form {
  calendar_id: string;
  title: string;
  emoji: string;
  all_day: boolean;
  startDate: string;
  /** Minutes past local midnight. Ignored while `all_day`. */
  startMin: number;
  /** While `all_day` this is the *inclusive* last day; otherwise the day the event stops on. */
  endDate: string;
  endMin: number;
  repeat: RepeatKind;
  rruleText: string;
  repeatEnd: RepeatEnd;
  until: string;
  count: number;
  location: string;
  description: string;
  guests: EventAttendee[];
  url: string;
  reminders: Reminder[];
  countdown: boolean;
  circled: boolean;
}

export function pickCalendar(calendars: Calendar[]): string {
  const writable = calendars.filter((c) => c.writable);
  return (writable.find((c) => c.is_default) ?? writable[0])?.id ?? "";
}

export function makeForm(target: EditorTarget, calendars: Calendar[]): Form {
  const base: Partial<CalEvent> = target.mode === "edit" ? target.event : target.prefill;
  const allDay = !!base.all_day;
  const starts = base.starts_at ?? Date.now();
  const ends = base.ends_at ?? starts + 60 * 60_000;
  // All-day rows carry their own inclusive dates; timed rows only carry instants.
  const startDate = (allDay ? base.start_date : null) ?? dateKey(starts);
  const endDate = allDay ? base.end_date ?? startDate : dateKey(ends);
  const startMin = minutesOfDay(starts);
  return {
    calendar_id: base.calendar_id ?? pickCalendar(calendars),
    title: base.title ?? "",
    emoji: base.emoji ?? "",
    all_day: allDay,
    startDate,
    startMin,
    endDate,
    endMin: allDay ? Math.min(startMin + 60, DAY_MIN - STEP) : minutesOfDay(ends),
    ...parseRepeat(base.rrule, startDate),
    location: base.location ?? "",
    description: base.description ?? "",
    guests: base.attendees ? [...base.attendees] : [],
    url: base.url ?? "",
    reminders: base.reminders ? [...base.reminders] : [],
    countdown: !!base.countdown,
    circled: !!base.circled,
  };
}

export function buildRrule(f: Form): string | null {
  if (f.repeat === "never") return null;
  // Custom rules are taken as typed, minus any ending the user wrote — the ending controls own
  // that half, and they were seeded from the same rule, so nothing is lost on the round trip.
  let rule = f.repeat === "custom" ? stripEnd(f.rruleText) : baseRule(f.repeat, f.startDate);
  if (!rule) return null;
  if (f.repeatEnd === "until" && f.until) rule += `;UNTIL=${untilStamp(f.until)}`;
  else if (f.repeatEnd === "count") rule += `;COUNT=${Math.max(1, Math.min(f.count || 1, 999))}`;
  return rule;
}

export function toInput(f: Form, timezone: string): EventInput {
  const common: EventInput = {
    calendar_id: f.calendar_id,
    title: f.title.trim(),
    description: f.description,
    location: f.location.trim(),
    emoji: f.emoji,
    rrule: buildRrule(f),
    attendees: f.guests,
    url: f.url.trim(),
    reminders: f.reminders,
    countdown: f.countdown,
    circled: f.circled,
    timezone,
  };
  if (f.all_day) {
    // `end_date` is inclusive, so the instant the day *stops* is midnight of the day after it.
    return { ...common, all_day: true, start_date: f.startDate, end_date: f.endDate, starts_at: msAt(f.startDate, 0), ends_at: msAt(addDays(f.endDate, 1), 0) };
  }
  return { ...common, all_day: false, start_date: null, end_date: null, starts_at: msAt(f.startDate, f.startMin), ends_at: msAt(f.endDate, f.endMin) };
}

/** What a setter of one field looks like. */
export type SetField = <K extends keyof Form>(k: K, v: Form[K]) => void;

/** Moving the start drags the end along, keeping the duration, the way every calendar does. */
export function startMoved(f: Form, patch: { date?: string; min?: number }): Form {
  const startDate = patch.date ?? f.startDate;
  if (f.all_day) {
    const span = Math.max(0, daysBetween(f.startDate, f.endDate));
    return { ...f, startDate, endDate: addDays(startDate, span) };
  }
  const startMin = patch.min ?? f.startMin;
  const keep = Math.max(0, msAt(f.endDate, f.endMin) - msAt(f.startDate, f.startMin));
  const end = msAt(startDate, startMin) + keep;
  return { ...f, startDate, startMin, endDate: dateKey(end), endMin: minutesOfDay(end) };
}

/** An end before the start is corrected, not rejected: it snaps to the first legal slot. */
export function endMoved(f: Form, patch: { date?: string; min?: number }): Form {
  if (f.all_day) {
    const endDate = patch.date ?? f.endDate;
    return { ...f, endDate: endDate < f.startDate ? f.startDate : endDate };
  }
  const start = msAt(f.startDate, f.startMin);
  let end = msAt(patch.date ?? f.endDate, patch.min ?? f.endMin);
  if (end <= start) end = start + STEP * 60_000;
  return { ...f, endDate: dateKey(end), endMin: minutesOfDay(end) };
}

/**
 * All-day and timed are two different shapes, not a flag on one shape, so the toggle converts.
 *
 * Timed → all-day: `end_date` is *inclusive*, so an event that stops at midnight belongs to the
 * day before the instant it ends on — otherwise a 9pm–midnight meeting would grow a second day.
 * All-day → timed: the inclusive end day becomes the day the event stops on, at a sane hour.
 */
export function allDaySet(f: Form, on: boolean): Form {
  if (on === f.all_day) return f;
  if (on) {
    let endDate = f.endDate;
    if (f.endMin === 0 && endDate > f.startDate) endDate = addDays(endDate, -1);
    if (endDate < f.startDate) endDate = f.startDate;
    return { ...f, all_day: true, endDate };
  }
  const startMin = f.startMin || 9 * 60;
  return { ...f, all_day: false, startMin, endMin: Math.min(startMin + 60, DAY_MIN - STEP) };
}

/** AddressInput speaks Address; attendees also carry an RSVP we must not throw away on edit. */
export function guestsSet(f: Form, next: { email: string; name: string }[]): Form {
  return {
    ...f,
    guests: next.map((a) => {
      const had = f.guests.find((g) => g.email.toLowerCase() === a.email.toLowerCase());
      return had ? { ...had, name: a.name || had.name } : { email: a.email, name: a.name };
    }),
  };
}
