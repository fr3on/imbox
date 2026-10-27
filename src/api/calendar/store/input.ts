import type { EventAttendee } from "@shared/types";
import { now } from "../../db";
import { addDays, dateKey, daysBetween, isValidDate, minutesOfDay, zonedTime } from "../dates";
import type { CalendarRow, EventRow } from "../types";
import { clampInt, icsUtc, str, utcMidnight } from "./util";

const KINDS = ["event", "birthday", "anniversary", "todo"] as const;

const STATUSES = ["confirmed", "tentative", "cancelled"] as const;

export interface EventInput {
  calendar_id?: string;
  kind?: string;
  title?: string;
  description?: string;
  location?: string;
  emoji?: string;
  all_day?: boolean;
  starts_at?: number;
  ends_at?: number;
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string;
  rrule?: string | null;
  status?: string;
  busy?: boolean;
  countdown?: boolean;
  circled?: boolean;
  attendees?: { email: string; name?: string; optional?: boolean }[];
  conference_url?: string;
  url?: string;
  reminders?: { minutes: number }[];
  thread_id?: string | null;
  message_id?: string | null;
}

/** The columns an EventInput can write. Ownership, recurrence links and sync state are set separately. */
export interface EventFields {
  kind: EventRow["kind"];
  title: string;
  description: string;
  location: string;
  emoji: string;
  all_day: number;
  starts_at: number;
  ends_at: number;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  rrule: string | null;
  status: EventRow["status"];
  busy: number;
  countdown: number;
  circled: number;
  attendees_json: string;
  conference_url: string;
  url: string;
  reminders_json: string;
  thread_id: string | null;
  message_id: string | null;
}

/** Close an open-ended series at `untilMs`, dropping any UNTIL/COUNT it already carried. */
export function withUntil(rrule: string, untilMs: number): string {
  const parts = rrule
    .replace(/^RRULE:/i, "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !/^(UNTIL|COUNT)=/i.test(p));
  parts.push(`UNTIL=${icsUtc(untilMs)}`);
  return parts.join(";");
}

/** Where one occurrence of a master actually starts: same wall-clock minute, that date. */
export function occurrenceStart(master: EventRow, date: string, tz: string): number {
  if (master.all_day) return utcMidnight(date) ?? master.starts_at;
  return zonedTime(date, minutesOfDay(master.starts_at, tz), tz);
}

/** A copy of a master with its times moved onto one occurrence — the seed for a split or a new series. */
export function shiftToOccurrence(master: EventRow, date: string, tz: string): EventRow {
  const dur = Math.max(0, master.ends_at - master.starts_at);
  const s = occurrenceStart(master, date, tz);
  const span = master.all_day && master.start_date && master.end_date ? Math.max(0, daysBetween(master.start_date, master.end_date)) : 0;
  return {
    ...master,
    starts_at: s,
    ends_at: s + dur,
    start_date: master.all_day ? date : null,
    end_date: master.all_day ? addDays(date, span) : null,
  };
}

/**
 * Merge an input over a previous row (or over blank defaults for a create), clamping strings the way
 * the rest of the codebase does and normalising all-day items onto UTC midnights so the window query
 * in `rangeFor` treats them like everything else.
 */
export function fieldsFrom(input: EventInput, prev: EventRow | null, tz: string): EventFields {
  const t = now();
  const f: EventFields = {
    kind: (KINDS as readonly string[]).includes(String(input.kind)) ? (input.kind as EventRow["kind"]) : prev?.kind ?? "event",
    title: str(input.title, 500, prev?.title ?? ""),
    description: str(input.description, 50_000, prev?.description ?? ""),
    location: str(input.location, 500, prev?.location ?? ""),
    emoji: str(input.emoji, 16, prev?.emoji ?? ""),
    all_day: input.all_day !== undefined ? (input.all_day ? 1 : 0) : prev?.all_day ?? 0,
    starts_at: input.starts_at !== undefined ? Math.round(Number(input.starts_at)) : prev?.starts_at ?? t,
    ends_at: input.ends_at !== undefined ? Math.round(Number(input.ends_at)) : prev?.ends_at ?? NaN,
    start_date: input.start_date !== undefined ? (input.start_date || null) : prev?.start_date ?? null,
    end_date: input.end_date !== undefined ? (input.end_date || null) : prev?.end_date ?? null,
    timezone: str(input.timezone, 64, prev?.timezone ?? ""),
    rrule: input.rrule !== undefined ? (input.rrule ? String(input.rrule).replace(/^RRULE:/i, "").slice(0, 1000) : null) : prev?.rrule ?? null,
    status: (STATUSES as readonly string[]).includes(String(input.status)) ? (input.status as EventRow["status"]) : prev?.status ?? "confirmed",
    busy: input.busy !== undefined ? (input.busy ? 1 : 0) : prev?.busy ?? 1,
    countdown: input.countdown !== undefined ? (input.countdown ? 1 : 0) : prev?.countdown ?? 0,
    circled: input.circled !== undefined ? (input.circled ? 1 : 0) : prev?.circled ?? 0,
    attendees_json: prev?.attendees_json ?? "[]",
    conference_url: str(input.conference_url, 2000, prev?.conference_url ?? ""),
    url: str(input.url, 2000, prev?.url ?? ""),
    reminders_json: prev?.reminders_json ?? "[]",
    thread_id: input.thread_id !== undefined ? (input.thread_id || null) : prev?.thread_id ?? null,
    message_id: input.message_id !== undefined ? (input.message_id || null) : prev?.message_id ?? null,
  };

  if (input.attendees !== undefined) {
    const list = (input.attendees ?? [])
      .slice(0, 200)
      .map((a) => {
        const email = String(a?.email ?? "").trim().toLowerCase().slice(0, 320);
        const out: EventAttendee = { email };
        if (a?.name) out.name = String(a.name).slice(0, 200);
        if (a?.optional) out.optional = true;
        return out;
      })
      .filter((a) => a.email.includes("@"));
    f.attendees_json = JSON.stringify(list);
  }
  if (input.reminders !== undefined) {
    const list = (input.reminders ?? [])
      .slice(0, 20)
      .map((r) => ({ minutes: clampInt(r?.minutes, 0, 40_320, 0) }))
      .filter((r) => Number.isFinite(r.minutes));
    f.reminders_json = JSON.stringify(list);
  }

  if (f.all_day) {
    // A birthday must land on the same date everywhere, so all-day rows are pinned to UTC midnight.
    const sd = (f.start_date && isValidDate(f.start_date) ? f.start_date : null) ?? dateKey(f.starts_at, "UTC");
    const ed = (f.end_date && isValidDate(f.end_date) ? f.end_date : null) ?? sd;
    f.start_date = sd;
    f.end_date = ed < sd ? sd : ed;
    if (input.starts_at === undefined) f.starts_at = utcMidnight(f.start_date) ?? f.starts_at;
    if (input.ends_at === undefined) f.ends_at = utcMidnight(f.end_date) ?? f.starts_at;
  } else {
    f.start_date = null;
    f.end_date = null;
    // A timed event with no end gets an hour; long enough to be visible, short enough to be obvious.
    if (!Number.isFinite(f.ends_at)) f.ends_at = f.starts_at + 3_600_000;
  }

  if (!Number.isFinite(f.starts_at) || !Number.isFinite(f.ends_at)) throw new Error("bad_time");
  if (f.ends_at < f.starts_at) throw new Error("bad_time");
  if (!f.timezone) f.timezone = tz;
  return f;
}

/** ICS feeds mirror someone else's calendar; a Google calendar we only have read access to is the same. */
export function assertWritable(cal: CalendarRow): void {
  if (cal.source === "ics") throw new Error("read_only");
  if (cal.source === "google" && !cal.writable) throw new Error("read_only");
}
