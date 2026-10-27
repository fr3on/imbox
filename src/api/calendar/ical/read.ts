import { meetingLinkIn } from "../../../shared/meeting";
import { addDays, dateKey, daysBetween, zonedTime } from "../dates";
import { parseDt, type DtValue } from "./datetime";
import { parseDuration, splitLine, unesc, unfold, type Prop } from "./text";
import type { IcsEvent } from "./types";

const MAX_EVENTS = 20000;

export const MAX_LINES = 400000;

export const PARTSTAT: Record<string, string> = {
  "NEEDS-ACTION": "needs-action",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "tentative",
  DELEGATED: "delegated",
};

function mailboxOf(value: string): string {
  return value.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
}

export function parseIcs(text: string): { name: string; timezone: string; color: string; events: IcsEvent[] } {
  const out = { name: "", timezone: "", color: "", events: [] as IcsEvent[] };
  if (!text || typeof text !== "string") return out;

  let props: Prop[] | null = null; // the VEVENT being collected
  let alarms: Prop[][] = [];
  let alarm: Prop[] | null = null;
  let skip = 0; // depth inside a component we do not care about

  for (const line of unfold(text)) {
    const p = splitLine(line);
    if (!p) continue;

    if (p.name === "BEGIN") {
      const comp = p.value.trim().toUpperCase();
      if (skip > 0) {
        skip++;
      } else if (comp === "VEVENT" && !props) {
        props = [];
        alarms = [];
        alarm = null;
      } else if (props && comp === "VALARM" && !alarm) {
        alarm = [];
      } else if (comp === "VTODO" || comp === "VJOURNAL" || comp === "VFREEBUSY" || comp === "VTIMEZONE") {
        skip = 1;
      }
      continue;
    }

    if (p.name === "END") {
      const comp = p.value.trim().toUpperCase();
      if (skip > 0) {
        skip--;
      } else if (props && comp === "VALARM" && alarm) {
        alarms.push(alarm);
        alarm = null;
      } else if (props && comp === "VEVENT") {
        if (out.events.length < MAX_EVENTS) {
          const ev = toEvent(props, alarms);
          if (ev) out.events.push(ev);
        }
        props = null;
        alarms = [];
        alarm = null;
      }
      continue;
    }

    if (skip > 0) continue;
    if (alarm) {
      alarm.push(p);
      continue;
    }
    if (props) {
      props.push(p);
      continue;
    }
    if (p.name === "X-WR-CALNAME") out.name = unesc(p.value).trim();
    else if (p.name === "X-WR-TIMEZONE") out.timezone = p.value.trim();
    else if (p.name === "X-APPLE-CALENDAR-COLOR") out.color = p.value.trim();
  }

  return out;
}

type Props = Prop[];

/** The end of an event: DTEND, or DURATION, or a sane default (1 hour timed / 1 day all-day). `exclusiveDate` is the day after the last for all-day events. */
function endOf(first: (name: string) => Prop | undefined, start: DtValue): { ms: number; exclusiveDate: string } {
  const allDay = start.allDay;
  const fallback = () => ({ ms: allDay ? zonedTime(addDays(start.date, 1), 0, "UTC") : start.ms + 3600000, exclusiveDate: addDays(start.date, 1) });
  let end: { ms: number; exclusiveDate: string };
  const dtendProp = first("DTEND");
  const durProp = first("DURATION");
  if (dtendProp) {
    const dt = parseDt(dtendProp.value, dtendProp.params);
    end = dt ? { ms: dt.ms, exclusiveDate: dt.date } : fallback();
  } else if (durProp && parseDuration(durProp.value) !== null) {
    const ms = parseDuration(durProp.value) as number;
    const endMs = start.ms + Math.max(0, ms);
    end = { ms: endMs, exclusiveDate: allDay ? addDays(start.date, Math.max(1, Math.round(ms / 86400000))) : dateKey(endMs, start.zone) };
  } else {
    end = fallback();
  }
  return Number.isFinite(end.ms) && end.ms >= start.ms ? end : fallback();
}

/** The dates (YYYY-MM-DD) a series skips, from every EXDATE line. */
function exdatesOf(props: Props): string[] {
  const exdates: string[] = [];
  for (const p of props) {
    if (p.name !== "EXDATE") continue;
    for (const piece of p.value.split(",")) {
      const dv = parseDt(piece, p.params);
      if (!dv) continue;
      const key = dv.allDay ? dv.date : dateKey(dv.ms, dv.zone);
      if (key && !exdates.includes(key)) exdates.push(key);
    }
  }
  return exdates;
}

function attendeesOf(props: Props): IcsEvent["attendees"] {
  const attendees: IcsEvent["attendees"] = [];
  for (const p of props) {
    if (p.name !== "ATTENDEE") continue;
    const email = mailboxOf(p.value);
    if (!email || attendees.some((a) => a.email === email)) continue;
    attendees.push({
      email,
      name: unesc(p.params["CN"] ?? "").trim(),
      rsvp: PARTSTAT[(p.params["PARTSTAT"] ?? "").toUpperCase()] ?? "needs-action",
      optional: (p.params["ROLE"] ?? "").toUpperCase() === "OPT-PARTICIPANT",
    });
  }
  return attendees;
}

/** Minutes before the start, from each VALARM's TRIGGER, sorted and without repeats. */
function remindersOf(alarms: Props[], startMs: number): number[] {
  const reminders: number[] = [];
  for (const a of alarms) {
    const trig = a.find((p) => p.name === "TRIGGER");
    if (!trig) continue;
    let minutes: number | null = null;
    const dur = parseDuration(trig.value);
    if (dur !== null && (trig.params["VALUE"] ?? "").toUpperCase() !== "DATE-TIME") {
      minutes = Math.round(-dur / 60000); // TRIGGER:-PT15M is 15 minutes *before*
    } else {
      const at = parseDt(trig.value, trig.params);
      if (at) minutes = Math.round((startMs - at.ms) / 60000);
    }
    if (minutes === null || !Number.isFinite(minutes)) continue;
    if (minutes < -1440 || minutes > 40320) continue; // ignore nonsense (> 4 weeks out)
    if (!reminders.includes(minutes)) reminders.push(minutes);
  }
  return reminders.sort((a, b) => a - b);
}

/** One VEVENT → IcsEvent. Returns null for anything malformed; never throws. */
function toEvent(props: Props, alarms: Props[]): IcsEvent | null {
  try {
    const first = (name: string): Prop | undefined => props.find((p) => p.name === name);
    const textOf = (name: string): string => {
      const p = first(name);
      return p ? unesc(p.value).trim() : "";
    };

    const dtstartProp = first("DTSTART");
    if (!dtstartProp) return null;
    const start = parseDt(dtstartProp.value, dtstartProp.params);
    if (!start) return null;

    const allDay = start.allDay;
    const end = endOf(first, start);

    // An all-day DTEND is exclusive: 15th→17th is the 15th and 16th, so the inclusive last day is
    // the day before. Guard against a same-day DTEND, which some writers emit.
    let endDate: string | null = null;
    if (allDay) {
      const inclusive = addDays(end.exclusiveDate, -1);
      endDate = daysBetween(start.date, inclusive) < 0 ? start.date : inclusive;
    }

    const status = ((): IcsEvent["status"] => {
      const s = textOf("STATUS").toUpperCase();
      if (s === "TENTATIVE") return "tentative";
      if (s === "CANCELLED") return "cancelled";
      return "confirmed";
    })();

    const recProp = first("RECURRENCE-ID");
    let recurrenceId: string | null = null;
    if (recProp) {
      const rec = parseDt(recProp.value, recProp.params);
      if (rec) recurrenceId = rec.allDay ? rec.date : dateKey(rec.ms, rec.zone);
    }

    const orgProp = first("ORGANIZER");
    const orgEmail = orgProp ? mailboxOf(orgProp.value) : "";
    const organizer = orgEmail ? { email: orgEmail, name: unesc(orgProp?.params["CN"] ?? "").trim() } : null;

    const summary = textOf("SUMMARY");
    const description = textOf("DESCRIPTION");
    const location = textOf("LOCATION");
    const conferenceUrl =
      [textOf("X-GOOGLE-CONFERENCE"), textOf("CONFERENCE"), textOf("X-MICROSOFT-SKYPETEAMSMEETINGURL"), textOf("X-MICROSOFT-ONLINEMEETINGCONFLINKURL")].find((u) => /^https?:\/\//i.test(u)) ||
      meetingLinkIn(description) ||
      meetingLinkIn(location) ||
      meetingLinkIn(textOf("URL")) ||
      "";

    const lastModProp = first("LAST-MODIFIED") ?? first("DTSTAMP");
    const lastMod = lastModProp ? parseDt(lastModProp.value, lastModProp.params) : null;

    const seq = parseInt(textOf("SEQUENCE"), 10);
    const rruleProp = first("RRULE");
    const rrule = rruleProp?.value.trim() ? rruleProp.value.trim() : null;

    return {
      uid: textOf("UID") || `${start.ms}-${summary}`.slice(0, 200),
      recurrenceId,
      sequence: Number.isFinite(seq) ? seq : 0,
      summary,
      description,
      location,
      url: textOf("URL"),
      allDay,
      startsAt: start.ms,
      endsAt: end.ms,
      startDate: allDay ? start.date : null,
      endDate,
      tzid: start.zone,
      rrule,
      exdates: exdatesOf(props),
      status,
      busy: textOf("TRANSP").toUpperCase() !== "TRANSPARENT",
      organizer,
      attendees: attendeesOf(props),
      conferenceUrl,
      reminders: remindersOf(alarms, start.ms),
      lastModified: lastMod ? lastMod.ms : null,
    };
  } catch {
    return null; // a single bad VEVENT must never take down a whole feed
  }
}
