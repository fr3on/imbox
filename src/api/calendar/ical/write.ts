import { addDays, dateKey, daysBetween, isValidDate, isValidZone } from "../dates";
import { pad2 } from "./rule";
import { esc } from "./text";
import type { IcsEventInput } from "./types";

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/** RFC 5545 §3.1 content line folding: 75 octets, continuations prefixed with a space. */
function fold(line: string): string {
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // never cut a UTF-8 sequence in half
    if (end < bytes.length) while (end > start + 1 && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
    limit = 74; // continuation lines spend an octet on the leading space
  }
  return chunks.join("\r\n ");
}

function utcStamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${String(d.getUTCFullYear()).padStart(4, "0")}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

/** Wall-clock time in a zone as `YYYYMMDDTHHMMSS`, the form DTSTART;TZID= wants. */
function localStamp(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}${g("month")}${g("day")}T${g("hour")}${g("minute")}${g("second")}`;
}

function dateStamp(date: string): string {
  return date.replace(/-/g, "");
}

/**
 * Serialise events as a VCALENDAR. Timed values are written in UTC rather than TZID form: a TZID
 * reference is only legal alongside a matching VTIMEZONE body, and emitting a correct one would
 * mean shipping the whole tzdata. UTC is unambiguous and every client accepts it.
 */
export function buildIcs(
  events: IcsEventInput[],
  opts?: { name?: string; method?: "PUBLISH" | "REQUEST" | "CANCEL"; prodId?: string },
): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(fold(s));

  push("BEGIN:VCALENDAR");
  push("VERSION:2.0");
  push(`PRODID:${opts?.prodId ?? "-//inbox//Calendar//EN"}`);
  push("CALSCALE:GREGORIAN");
  if (opts?.method) push(`METHOD:${opts.method}`);
  if (opts?.name) push(`X-WR-CALNAME:${esc(opts.name)}`);

  const stamp = utcStamp(Date.now());
  for (const ev of events ?? []) {
    const allDay = !!ev.allDay;
    const startDate = ev.startDate && isValidDate(ev.startDate) ? ev.startDate : dateKey(ev.startsAt ?? Date.now(), "UTC");
    if (allDay && !isValidDate(startDate)) continue;
    if (!allDay && !Number.isFinite(ev.startsAt)) continue;

    push("BEGIN:VEVENT");
    push(`UID:${(ev.uid ?? `${stamp}-${lines.length}@inbox`).replace(/[\r\n]/g, "")}`);
    push(`DTSTAMP:${stamp}`);

    if (allDay) {
      const endInclusive = ev.endDate && isValidDate(ev.endDate) ? ev.endDate : startDate;
      const exclusive = addDays(daysBetween(startDate, endInclusive) < 0 ? startDate : endInclusive, 1);
      push(`DTSTART;VALUE=DATE:${dateStamp(startDate)}`);
      push(`DTEND;VALUE=DATE:${dateStamp(exclusive)}`); // DTEND is exclusive: the day after the last
    } else {
      const s = ev.startsAt as number;
      const e = Number.isFinite(ev.endsAt) && (ev.endsAt as number) > s ? (ev.endsAt as number) : s + 3600000;
      // A repeating event keeps its wall-clock time across daylight saving only if it is written in its own zone.
      if (ev.rrule && ev.tzid && isValidZone(ev.tzid)) {
        push(`DTSTART;TZID=${ev.tzid}:${localStamp(s, ev.tzid)}`);
        push(`DTEND;TZID=${ev.tzid}:${localStamp(e, ev.tzid)}`);
      } else {
        push(`DTSTART:${utcStamp(s)}`);
        push(`DTEND:${utcStamp(e)}`);
      }
    }
    if (ev.recurrenceId !== undefined) {
      push(typeof ev.recurrenceId === "number" ? `RECURRENCE-ID:${utcStamp(ev.recurrenceId)}` : `RECURRENCE-ID;VALUE=DATE:${dateStamp(ev.recurrenceId)}`);
    }
    for (const x of ev.exdates ?? []) push(typeof x === "number" ? `EXDATE:${utcStamp(x)}` : `EXDATE;VALUE=DATE:${dateStamp(x)}`);

    if (ev.summary) push(`SUMMARY:${esc(ev.summary)}`);
    if (ev.description) push(`DESCRIPTION:${esc(ev.description)}`);
    if (ev.location) push(`LOCATION:${esc(ev.location)}`);
    if (ev.url) push(`URL:${esc(ev.url)}`);
    if (ev.rrule) push(`RRULE:${ev.rrule.trim().replace(/^RRULE:/i, "").replace(/[\r\n]/g, "")}`);
    if (ev.tzid && isValidZone(ev.tzid)) push(`X-WR-TIMEZONE:${ev.tzid}`);
    push(`STATUS:${(ev.status ?? "confirmed").toUpperCase()}`);
    push("SEQUENCE:0");

    if (ev.organizer?.email) {
      const cn = ev.organizer.name ? `;CN="${ev.organizer.name.replace(/"/g, "")}"` : "";
      push(`ORGANIZER${cn}:mailto:${ev.organizer.email}`);
    }
    for (const a of ev.attendees ?? []) {
      if (!a?.email) continue;
      const cn = a.name ? `;CN="${a.name.replace(/"/g, "")}"` : "";
      const role = a.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT";
      const partstat = (a.rsvp ?? "needs-action").toUpperCase();
      push(`ATTENDEE${cn};ROLE=${role};PARTSTAT=${partstat};RSVP=TRUE:mailto:${a.email}`);
    }
    for (const m of ev.reminders ?? []) {
      if (!Number.isFinite(m)) continue;
      const mins = Math.round(m);
      push("BEGIN:VALARM");
      push("ACTION:DISPLAY");
      push(`DESCRIPTION:${esc(ev.summary || "Reminder")}`);
      push(`TRIGGER:${mins >= 0 ? `-PT${mins}M` : `PT${-mins}M`}`);
      push("END:VALARM");
    }
    push("END:VEVENT");
  }

  push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
