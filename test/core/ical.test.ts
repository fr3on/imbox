import { describe, expect, it } from "vitest";
import { expandRRule, parseIcs } from "../../src/api/calendar/ical";

// The iCalendar reader and the recurrence expander, pinned by snapshot over a broad set of feeds and rules. Everything here is fixed dates, so the
// answers do not depend on when the tests run.

const cal = (...event: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...event, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const read = (...lines: string[]) => parseIcs(cal(vevent(...lines)));
const one = (...lines: string[]) => read("UID:u1", "SUMMARY:S", ...lines).events;
const iso = (ms: number[]) => ms.map((m) => new Date(m).toISOString());

describe("reading a calendar", () => {
  it("reads the calendar's own name, zone and colour, and skips what is not an event", () => {
    const text = [
      "BEGIN:VCALENDAR", "X-WR-CALNAME:Work\\, mostly", "X-WR-TIMEZONE:Europe/Berlin", "X-APPLE-CALENDAR-COLOR:#FF2968",
      "BEGIN:VTIMEZONE", "TZID:Custom", "BEGIN:STANDARD", "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE",
      "BEGIN:VTODO", "UID:todo", "SUMMARY:A task", "DTSTART:20260105T090000Z", "END:VTODO",
      vevent("UID:ok", "SUMMARY:Kept", "DTSTART:20260105T090000Z"),
      "END:VCALENDAR",
    ].join("\r\n");
    expect(parseIcs(text)).toMatchSnapshot();
  });

  it("gives nothing for nothing, or for text that is not a calendar", () => {
    expect(parseIcs("")).toMatchSnapshot("empty");
    expect(parseIcs(undefined as unknown as string)).toMatchSnapshot("undefined");
    expect(parseIcs("hello\r\nworld")).toMatchSnapshot("text");
  });

  it("drops an event without a start, or with a start it cannot read, and keeps the others", () => {
    const text = cal(vevent("UID:a", "SUMMARY:No start"), vevent("UID:b", "DTSTART:garbage"), vevent("UID:c", "SUMMARY:Fine", "DTSTART:20260105T090000Z"));
    expect(parseIcs(text).events.map((e) => e.uid)).toEqual(["c"]);
  });

  it("unfolds long lines, and reads escaped text", () => {
    expect(one("DTSTART:20260105T090000Z", "DESCRIPTION:Line one\\nLine two\\, with a comma; and a semi\\\\colon", "LOCATION:Room\r\n  12, Building A", "SUMMARY:A very long summary that was folded by the writer at seventy-five c\r\n haracters and carries on").map((e) => [e.description, e.location, e.summary])).toMatchSnapshot();
  });
});

describe("when an event starts and ends", () => {
  it("reads UTC, zoned and floating times", () => {
    expect(one("DTSTART:20260105T090000Z", "DTEND:20260105T100000Z")).toMatchSnapshot("utc");
    expect(one("DTSTART;TZID=America/New_York:20260105T090000", "DTEND;TZID=America/New_York:20260105T103000")).toMatchSnapshot("zoned");
    expect(one("DTSTART;TZID=America/New_York:20260308T013000", "DTEND;TZID=America/New_York:20260308T033000")).toMatchSnapshot("across the clocks changing");
    expect(one("DTSTART:20260105T090000")).toMatchSnapshot("floating");
    expect(one("DTSTART;TZID=Not/AZone:20260105T090000")).toMatchSnapshot("unknown zone");
  });

  it("reads all-day events, whose end is the day after the last", () => {
    expect(one("DTSTART;VALUE=DATE:20260115", "DTEND;VALUE=DATE:20260117")).toMatchSnapshot("two days");
    expect(one("DTSTART;VALUE=DATE:20260115")).toMatchSnapshot("no end");
    expect(one("DTSTART;VALUE=DATE:20260115", "DTEND;VALUE=DATE:20260115")).toMatchSnapshot("same-day end");
    expect(one("DTSTART;VALUE=DATE:20260115", "DTEND;VALUE=DATE:20260110")).toMatchSnapshot("end before start");
    expect(one("DTSTART;VALUE=DATE:20260115", "DURATION:P3D")).toMatchSnapshot("duration days");
    expect(one("DTSTART;VALUE=DATE:20260115", "DTEND:garbage")).toMatchSnapshot("bad end");
  });

  it("falls back to a duration, then to an hour, and never ends before it starts", () => {
    expect(one("DTSTART:20260105T090000Z", "DURATION:PT1H30M")).toMatchSnapshot("duration");
    expect(one("DTSTART:20260105T090000Z", "DURATION:P1DT2H")).toMatchSnapshot("day and hours");
    expect(one("DTSTART:20260105T090000Z", "DURATION:nonsense")).toMatchSnapshot("bad duration");
    expect(one("DTSTART:20260105T090000Z")).toMatchSnapshot("nothing");
    expect(one("DTSTART:20260105T090000Z", "DTEND:20260105T080000Z")).toMatchSnapshot("end before start");
    expect(one("DTSTART:20260105T090000Z", "DTEND:garbage")).toMatchSnapshot("bad end");
    expect(one("DTSTART:20260105T090000Z", "DURATION:-PT1H")).toMatchSnapshot("negative duration");
  });
});

describe("what kind of event it is", () => {
  it("reads status, busy or free, sequence, and the dates it was changed", () => {
    for (const status of ["TENTATIVE", "CANCELLED", "CONFIRMED", "WEIRD"]) expect(one("DTSTART:20260105T090000Z", `STATUS:${status}`)[0].status).toMatchSnapshot(status);
    expect(one("DTSTART:20260105T090000Z", "TRANSP:TRANSPARENT")[0].busy).toBe(false);
    expect(one("DTSTART:20260105T090000Z", "TRANSP:OPAQUE")[0].busy).toBe(true);
    expect(one("DTSTART:20260105T090000Z", "SEQUENCE:7", "LAST-MODIFIED:20260102T030405Z", "DTSTAMP:20250101T000000Z").map((e) => [e.sequence, e.lastModified])).toMatchSnapshot("modified");
    expect(one("DTSTART:20260105T090000Z", "SEQUENCE:abc", "DTSTAMP:20250101T000000Z").map((e) => [e.sequence, e.lastModified])).toMatchSnapshot("stamp only");
  });

  it("makes an id from the start and summary when there is none, and reads the URL", () => {
    expect(read("SUMMARY:No id here", "DTSTART:20260105T090000Z", "URL:https://example.org/e/1").events.map((e) => [e.uid, e.url])).toMatchSnapshot();
    expect(read("SUMMARY:" + "x".repeat(300), "DTSTART:20260105T090000Z").events[0].uid.length).toBe(200);
  });

  it("reads a recurrence rule, the occurrences skipped, and which occurrence an event replaces", () => {
    expect(one("DTSTART:20260105T090000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20260112T090000Z,20260119T090000Z", "EXDATE:20260112T090000Z", "EXDATE:bad")).toMatchSnapshot("series");
    expect(one("DTSTART;VALUE=DATE:20260105", "EXDATE;VALUE=DATE:20260106")).toMatchSnapshot("all-day exdate");
    expect(one("DTSTART:20260126T100000Z", "RECURRENCE-ID:20260126T090000Z")[0].recurrenceId).toMatchSnapshot("timed");
    expect(one("DTSTART;VALUE=DATE:20260126", "RECURRENCE-ID;VALUE=DATE:20260126")[0].recurrenceId).toMatchSnapshot("all-day");
    expect(one("DTSTART:20260105T090000Z", "RRULE:  ")[0].rrule).toBeNull();
  });
});

describe("who is in it", () => {
  it("reads the organiser and the attendees, once each", () => {
    expect(
      one(
        "DTSTART:20260105T090000Z",
        'ORGANIZER;CN="Maya Chen":mailto:Maya@Chen.test',
        "ATTENDEE;CN=Sam Ortiz;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:sam@example.org",
        "ATTENDEE;PARTSTAT=DECLINED:mailto:no@example.org",
        "ATTENDEE;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:mailto:maybe@example.org",
        "ATTENDEE;PARTSTAT=DELEGATED:mailto:deleg@example.org",
        "ATTENDEE;PARTSTAT=WEIRD:mailto:weird@example.org",
        "ATTENDEE:mailto:sam@example.org",
        "ATTENDEE:not an address",
      ),
    ).toMatchSnapshot();
    expect(one("DTSTART:20260105T090000Z", "ORGANIZER:nothing")[0].organizer).toMatchSnapshot("not an address");
  });
});

describe("the meeting link", () => {
  it("takes it from the calendar's own field first, then from the text", () => {
    expect(one("DTSTART:20260105T090000Z", "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij", "DESCRIPTION:https://zoom.us/j/123456789")[0].conferenceUrl).toMatchSnapshot("google");
    expect(one("DTSTART:20260105T090000Z", "CONFERENCE:not a link", "X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/xyz")[0].conferenceUrl).toMatchSnapshot("microsoft");
    expect(one("DTSTART:20260105T090000Z", "DESCRIPTION:Join us https://zoom.us/j/123456789?pwd=a")[0].conferenceUrl).toMatchSnapshot("description");
    expect(one("DTSTART:20260105T090000Z", "LOCATION:https://teams.microsoft.com/l/meetup-join/abc")[0].conferenceUrl).toMatchSnapshot("location");
    expect(one("DTSTART:20260105T090000Z", "URL:https://meet.google.com/xxx-yyyy-zzz")[0].conferenceUrl).toMatchSnapshot("url");
    expect(one("DTSTART:20260105T090000Z", "DESCRIPTION:no link here")[0].conferenceUrl).toBe("");
  });
});

describe("reminders", () => {
  const alarm = (...lines: string[]) => ["BEGIN:VALARM", "ACTION:DISPLAY", ...lines, "END:VALARM"].join("\r\n");
  it("reads minutes before the start, sorted, once each, and ignores nonsense", () => {
    const text = cal(
      ["BEGIN:VEVENT", "UID:r", "SUMMARY:R", "DTSTART:20260105T090000Z", alarm("TRIGGER:-PT15M"), alarm("TRIGGER:-PT1H"), alarm("TRIGGER:-PT15M"), alarm("TRIGGER:PT0S"), alarm("TRIGGER:-P1D"),
        alarm("TRIGGER;VALUE=DATE-TIME:20260105T080000Z"), alarm("TRIGGER:-P60D"), alarm("TRIGGER:+PT2H"), alarm("DESCRIPTION:no trigger"), alarm("TRIGGER:garbage"), "END:VEVENT"].join("\r\n"),
    );
    expect(parseIcs(text).events[0].reminders).toMatchSnapshot();
  });
});

describe("repeating events", () => {
  const seed = Date.UTC(2026, 0, 5, 9); // Monday 5 January 2026, 09:00 UTC
  const range = (from: string, to: string) => ({ from: Date.parse(from), to: Date.parse(to) });
  const expand = (rule: string, o: Partial<Parameters<typeof expandRRule>[2]> & { start?: number } = {}) => {
    const { start = seed, ...rest } = o;
    return iso(expandRRule(rule, start, { tz: "UTC", allDay: false, ...range("2026-01-01T00:00:00Z", "2026-03-31T23:59:59Z"), ...rest }));
  };

  it("repeats daily, with an interval, a count and an end", () => {
    expect(expand("FREQ=DAILY;COUNT=4")).toMatchSnapshot("count");
    expect(expand("FREQ=DAILY;INTERVAL=10")).toMatchSnapshot("interval");
    expect(expand("FREQ=DAILY;UNTIL=20260109T090000Z")).toMatchSnapshot("until");
    expect(expand("FREQ=DAILY;UNTIL=20260108")).toMatchSnapshot("until a date");
    expect(expand("FREQ=DAILY;BYDAY=MO,FR;COUNT=5")).toMatchSnapshot("by day");
    expect(expand("FREQ=DAILY;BYMONTH=2;BYMONTHDAY=1,-1")).toMatchSnapshot("by month and day");
  });

  it("repeats weekly on several days, and counts weeks from the chosen week start", () => {
    expect(expand("FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=7")).toMatchSnapshot("three days");
    expect(expand("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=6")).toMatchSnapshot("fortnightly, Monday start");
    expect(expand("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU;COUNT=6")).toMatchSnapshot("fortnightly, Sunday start");
    expect(expand("FREQ=WEEKLY;COUNT=3")).toMatchSnapshot("the seed's weekday");
    expect(expand("FREQ=WEEKLY;BYDAY=MO;BYMONTH=2")).toMatchSnapshot("in one month");
  });

  it("repeats monthly by day of month, by weekday, and by position", () => {
    const start = Date.UTC(2026, 0, 31, 9);
    expect(expand("FREQ=MONTHLY;COUNT=4", { start })).toMatchSnapshot("the 31st skips short months");
    expect(expand("FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=5")).toMatchSnapshot("two days");
    expect(expand("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3")).toMatchSnapshot("last day");
    expect(expand("FREQ=MONTHLY;BYDAY=2TU;COUNT=3")).toMatchSnapshot("second Tuesday");
    expect(expand("FREQ=MONTHLY;BYDAY=-1FR;COUNT=3")).toMatchSnapshot("last Friday");
    expect(expand("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3")).toMatchSnapshot("last weekday");
    expect(expand("FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=13;COUNT=2", { to: Date.parse("2027-12-31T00:00:00Z") })).toMatchSnapshot("a Monday the 13th");
    expect(expand("FREQ=MONTHLY;INTERVAL=2;COUNT=3")).toMatchSnapshot("every other month");
    expect(expand("FREQ=MONTHLY;BYDAY=5MO;COUNT=3", { to: Date.parse("2027-12-31T00:00:00Z") })).toMatchSnapshot("fifth Monday");
  });

  it("repeats yearly, in a month, by weekday of the year, and on a leap day", () => {
    const to = Date.parse("2034-12-31T00:00:00Z");
    expect(expand("FREQ=YEARLY;COUNT=3", { to })).toMatchSnapshot("same day");
    expect(expand("FREQ=YEARLY;BYMONTH=3,6;COUNT=4", { to })).toMatchSnapshot("two months");
    expect(expand("FREQ=YEARLY;BYDAY=20MO;COUNT=3", { to })).toMatchSnapshot("20th Monday");
    expect(expand("FREQ=YEARLY;BYDAY=MO;BYMONTHDAY=1;COUNT=3", { to })).toMatchSnapshot("a Monday the 1st");
    expect(expand("FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=3", { to })).toMatchSnapshot("Thanksgiving");
    expect(expand("FREQ=YEARLY;COUNT=3", { start: Date.UTC(2024, 1, 29, 9), to })).toMatchSnapshot("leap day");
    expect(expand("FREQ=YEARLY;INTERVAL=3;COUNT=3", { to: Date.parse("2040-12-31T00:00:00Z") })).toMatchSnapshot("every third year");
  });

  it("keeps the wall-clock time across a change of clocks, in the seed's zone", () => {
    const start = Date.parse("2026-03-05T09:00:00-05:00");
    expect(expand("FREQ=DAILY;COUNT=8", { start, tz: "America/New_York" })).toMatchSnapshot("New York in March");
    expect(expand("FREQ=DAILY;COUNT=5", { start: Date.parse("2026-10-24T09:00:00+02:00"), tz: "Europe/Berlin", from: Date.parse("2026-10-20T00:00:00Z"), to: Date.parse("2026-11-10T00:00:00Z") })).toMatchSnapshot("Berlin in October");
    expect(expand("FREQ=WEEKLY;BYDAY=SU;COUNT=3", { start: Date.parse("2026-03-01T00:30:00+11:00"), tz: "Australia/Sydney", from: Date.parse("2026-02-01T00:00:00Z"), to: Date.parse("2026-04-30T00:00:00Z") })).toMatchSnapshot("Sydney");
  });

  it("anchors all-day events in UTC, so a birthday never moves a day", () => {
    expect(expand("FREQ=YEARLY", { start: Date.UTC(2020, 5, 15), allDay: true, tz: "Pacific/Auckland", from: Date.parse("2026-01-01T00:00:00Z"), to: Date.parse("2028-01-01T00:00:00Z") })).toMatchSnapshot();
  });

  it("leaves out skipped dates, and honours the window and the limit", () => {
    expect(expand("FREQ=DAILY;COUNT=5", { exdates: ["2026-01-07"] })).toMatchSnapshot("exdate");
    expect(expand("FREQ=DAILY", { from: Date.parse("2026-02-10T00:00:00Z"), to: Date.parse("2026-02-12T00:00:00Z") })).toMatchSnapshot("window");
    expect(expand("FREQ=DAILY;COUNT=100", { from: Date.parse("2026-02-10T00:00:00Z"), to: Date.parse("2026-02-12T00:00:00Z") })).toMatchSnapshot("window with a count");
    expect(expand("FREQ=DAILY", { limit: 3 })).toMatchSnapshot("limit");
    expect(expand("FREQ=DAILY", { limit: 0 })).toMatchSnapshot("limit of zero is one");
    expect(expand("FREQ=DAILY", { start: Date.UTC(2015, 0, 1, 9), from: Date.parse("2026-01-01T00:00:00Z"), to: Date.parse("2026-01-03T00:00:00Z") })).toMatchSnapshot("long ago");
    expect(expand("FREQ=WEEKLY;BYDAY=MO,TH", { start: Date.UTC(2015, 0, 5, 9), from: Date.parse("2026-01-01T00:00:00Z"), to: Date.parse("2026-01-20T00:00:00Z") })).toMatchSnapshot("weekly long ago");
    expect(expand("FREQ=MONTHLY;BYDAY=1MO", { start: Date.UTC(2015, 0, 5, 9), from: Date.parse("2026-01-01T00:00:00Z"), to: Date.parse("2026-04-20T00:00:00Z") })).toMatchSnapshot("monthly long ago");
    expect(expand("FREQ=YEARLY", { start: Date.UTC(2005, 0, 5, 9), from: Date.parse("2026-01-01T00:00:00Z"), to: Date.parse("2027-04-20T00:00:00Z") })).toMatchSnapshot("yearly long ago");
  });

  it("counts from the seed even when the window starts later", () => {
    expect(expand("FREQ=DAILY;COUNT=5", { from: Date.parse("2026-01-08T00:00:00Z") })).toMatchSnapshot();
  });

  it("always includes the seed as the first occurrence, even when the rule would not", () => {
    expect(expand("FREQ=WEEKLY;BYDAY=TU,TH;COUNT=3")).toMatchSnapshot();
  });

  it("gives just the seed for a rule it cannot read, and nothing for an impossible window", () => {
    expect(expand("nonsense")).toMatchSnapshot("bad rule");
    expect(expand("FREQ=SECONDLY")).toMatchSnapshot("unsupported frequency");
    expect(expand("")).toMatchSnapshot("empty");
    expect(expand("RRULE:FREQ=DAILY;COUNT=2")).toMatchSnapshot("with the prefix");
    expect(expand("FREQ=DAILY", { from: Date.parse("2027-01-01T00:00:00Z"), to: Date.parse("2026-01-01T00:00:00Z") })).toMatchSnapshot("reversed window");
    expect(expand("FREQ=DAILY", { start: Number.NaN })).toMatchSnapshot("no start");
    expect(expand("FREQ=DAILY;INTERVAL=99999;COUNT=3")).toMatchSnapshot("huge interval");
    expect(expand("FREQ=DAILY;BYMONTHDAY=40;COUNT=3")).toMatchSnapshot("impossible day");
    expect(expand("FREQ=DAILY;COUNT=2", { tz: "Not/AZone" })).toMatchSnapshot("unknown zone");
  });
});
