import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildIcs, parseIcs, type IcsEventInput } from "../../src/api/calendar/ical";

// The iCalendar writer, with the answers worked out by hand from the rules in RFC 5545 (lines are folded at 75 octets, text is escaped, an all-day event's
// DTEND is the day after its last day, a repeating event keeps its own zone), and then read back with the reader to see that nothing is lost on the way.
// The reader and the expander are pinned in ical.test.ts. Written before the file was split into modules.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 3, 12, 0, 0));
});
afterAll(() => vi.useRealTimers());

const STAMP = "20261003T120000Z";
const lines = (ics: string) => ics.split("\r\n");
/** The lines with the folding taken out again. */
const unfolded = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");
/** The lines of the only event, between BEGIN:VEVENT and END:VEVENT. */
const body = (e: IcsEventInput, opts?: Parameters<typeof buildIcs>[1]) => {
  const l = unfolded(buildIcs([e], opts));
  return l.slice(l.indexOf("BEGIN:VEVENT") + 1, l.indexOf("END:VEVENT"));
};
const MON9 = Date.UTC(2026, 9, 5, 9);

describe("the calendar wrapper", () => {
  it("is a calendar with nothing in it when there are no events", () => {
    expect(buildIcs([])).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//inbox//Calendar//EN\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n");
  });
  it("takes a name, a method and a product id, and escapes the name", () => {
    const out = lines(buildIcs([], { name: "Home, work; play", method: "REQUEST", prodId: "-//x//y//EN" }));
    expect(out).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//x//y//EN", "CALSCALE:GREGORIAN", "METHOD:REQUEST", "X-WR-CALNAME:Home\\, work\\; play", "END:VCALENDAR", ""]);
  });
  it("ends every line with CRLF, the last one too", () => {
    expect(buildIcs([{ startsAt: MON9 }]).endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(buildIcs([{ startsAt: MON9 }]).replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
});

describe("a timed event", () => {
  it("is written in UTC with the plain defaults", () => {
    expect(body({ uid: "u1", summary: "Hi", startsAt: MON9, endsAt: MON9 + 90 * 60_000 })).toEqual([
      "UID:u1", `DTSTAMP:${STAMP}`, "DTSTART:20261005T090000Z", "DTEND:20261005T103000Z", "SUMMARY:Hi", "STATUS:CONFIRMED", "SEQUENCE:0",
    ]);
  });
  it("lasts an hour when it has no end, or an end that is not after its start", () => {
    expect(body({ uid: "u", startsAt: MON9 }).filter((l) => l.startsWith("DTEND"))).toEqual(["DTEND:20261005T100000Z"]);
    expect(body({ uid: "u", startsAt: MON9, endsAt: MON9 }).filter((l) => l.startsWith("DTEND"))).toEqual(["DTEND:20261005T100000Z"]);
    expect(body({ uid: "u", startsAt: MON9, endsAt: MON9 - 1 }).filter((l) => l.startsWith("DTEND"))).toEqual(["DTEND:20261005T100000Z"]);
  });
  it("makes up an id from the moment and its place in the file, and keeps line breaks out of one it is given", () => {
    expect(body({ startsAt: MON9 })[0]).toBe(`UID:${STAMP}-5@inbox`);
    const two = lines(buildIcs([{ startsAt: MON9 }, { startsAt: MON9 }])).filter((l) => l.startsWith("UID:"));
    expect(two[0]).toBe(`UID:${STAMP}-5@inbox`);
    expect(two[1]).not.toBe(two[0]);
    expect(body({ uid: "a\r\nb", startsAt: MON9 })[0]).toBe("UID:ab");
  });
  it("is left out when it has no start at all", () => {
    expect(lines(buildIcs([{ summary: "No start", startsAt: Number.NaN }])).includes("BEGIN:VEVENT")).toBe(false);
    expect(lines(buildIcs([{ summary: "No start" }])).includes("BEGIN:VEVENT")).toBe(false);
    // An all-day event with nothing to say which day it is falls on today.
    expect(body({ uid: "u", allDay: true })).toContain("DTSTART;VALUE=DATE:20261003");
  });
  it("says which zone it is in, without writing its times in that zone", () => {
    const b = body({ uid: "u", startsAt: MON9, tzid: "Europe/London" });
    expect(b).toContain("DTSTART:20261005T090000Z");
    expect(b).toContain("X-WR-TIMEZONE:Europe/London");
    expect(body({ uid: "u", startsAt: MON9, tzid: "Mars/Base" }).some((l) => l.startsWith("X-WR-TIMEZONE"))).toBe(false);
  });
  it("is written in its own zone when it repeats, so its hour survives a clock change", () => {
    const b = body({ uid: "u", startsAt: Date.UTC(2026, 9, 19, 8), endsAt: Date.UTC(2026, 9, 19, 9), tzid: "Europe/London", rrule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(b).toContain("DTSTART;TZID=Europe/London:20261019T090000");
    expect(b).toContain("DTEND;TZID=Europe/London:20261019T100000");
    expect(b.indexOf("RRULE:FREQ=WEEKLY;BYDAY=MO")).toBeGreaterThan(b.indexOf("DTEND;TZID=Europe/London:20261019T100000"));
    const utc = body({ uid: "u", startsAt: MON9, tzid: "Mars/Base", rrule: "FREQ=DAILY" });
    expect(utc).toContain("DTSTART:20261005T090000Z");
  });
});

describe("an all-day event", () => {
  it("writes dates, and the end as the day after the last day", () => {
    const b = body({ uid: "u", allDay: true, startDate: "2026-10-05", endDate: "2026-10-07" });
    expect(b).toContain("DTSTART;VALUE=DATE:20261005");
    expect(b).toContain("DTEND;VALUE=DATE:20261008");
  });
  it("ends the next day when it has no last day, or one before its first", () => {
    expect(body({ uid: "u", allDay: true, startDate: "2026-10-05" })).toContain("DTEND;VALUE=DATE:20261006");
    expect(body({ uid: "u", allDay: true, startDate: "2026-10-05", endDate: "2026-10-01" })).toContain("DTEND;VALUE=DATE:20261006");
    expect(body({ uid: "u", allDay: true, startDate: "2026-12-31" })).toContain("DTEND;VALUE=DATE:20270101");
  });
  it("takes its first day from the start instant when it has no date", () => {
    expect(body({ uid: "u", allDay: true, startDate: "not a date", startsAt: Date.UTC(2026, 9, 5, 15) })).toContain("DTSTART;VALUE=DATE:20261005");
    expect(body({ uid: "u", allDay: true, startsAt: Date.UTC(2026, 9, 5, 23, 30) })).toContain("DTSTART;VALUE=DATE:20261005");
  });
});

describe("what goes in an event", () => {
  it("escapes text, in the order the fields come", () => {
    const b = body({ uid: "u", startsAt: MON9, summary: "a,b;c\\d\ne", description: "x\r\ny", location: "Room 2, floor 3", url: "https://x.test/a;b,c" });
    expect(b.filter((l) => /^(SUMMARY|DESCRIPTION|LOCATION|URL):/.test(l))).toEqual(["SUMMARY:a\\,b\\;c\\\\d\\ne", "DESCRIPTION:x\\ny", "LOCATION:Room 2\\, floor 3", "URL:https://x.test/a\\;b\\,c"]);
    expect(b.findIndex((l) => l.startsWith("SUMMARY"))).toBeLessThan(b.findIndex((l) => l.startsWith("DESCRIPTION")));
    expect(b.findIndex((l) => l.startsWith("LOCATION"))).toBeLessThan(b.findIndex((l) => l.startsWith("URL")));
  });
  it("leaves out text that is empty", () => {
    const b = body({ uid: "u", startsAt: MON9, summary: "", description: "", location: "", url: "" });
    expect(b.some((l) => /^(SUMMARY|DESCRIPTION|LOCATION|URL)/.test(l))).toBe(false);
  });
  it("writes a repeat rule without its prefix, spaces or line breaks", () => {
    expect(body({ uid: "u", startsAt: MON9, rrule: " RRULE:FREQ=DAILY;COUNT=3\r\n" })).toContain("RRULE:FREQ=DAILY;COUNT=3");
  });
  it("writes the status in capitals", () => {
    expect(body({ uid: "u", startsAt: MON9, status: "tentative" })).toContain("STATUS:TENTATIVE");
    expect(body({ uid: "u", startsAt: MON9, status: "cancelled" })).toContain("STATUS:CANCELLED");
  });
  it("writes the occurrences it replaces and skips, as dates for all-day and instants for timed", () => {
    expect(body({ uid: "u", startsAt: MON9, recurrenceId: Date.UTC(2026, 9, 12, 9), exdates: [Date.UTC(2026, 9, 19, 9)] })).toEqual(expect.arrayContaining(["RECURRENCE-ID:20261012T090000Z", "EXDATE:20261019T090000Z"]));
    expect(body({ uid: "u", allDay: true, startDate: "2026-10-05", recurrenceId: "2026-10-12", exdates: ["2026-10-19", "2026-10-26"] })).toEqual(expect.arrayContaining(["RECURRENCE-ID;VALUE=DATE:20261012", "EXDATE;VALUE=DATE:20261019", "EXDATE;VALUE=DATE:20261026"]));
  });
  it("writes the organiser and each guest with their role and answer, and no quotes inside a name", () => {
    const b = body({
      uid: "u", startsAt: MON9,
      organizer: { email: "ann@x.test", name: 'Ann "Boss" Lee' },
      attendees: [{ email: "a@x.test", name: "Alex" }, { email: "b@x.test", optional: true, rsvp: "accepted" }, { email: "", name: "Nobody" }, { email: "c@x.test", rsvp: "declined" }],
    });
    expect(b.filter((l) => l.startsWith("ORGANIZER"))).toEqual(['ORGANIZER;CN="Ann Boss Lee":mailto:ann@x.test']);
    expect(b.filter((l) => l.startsWith("ATTENDEE"))).toEqual([
      'ATTENDEE;CN="Alex";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:a@x.test',
      "ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:b@x.test",
      "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=DECLINED;RSVP=TRUE:mailto:c@x.test",
    ]);
    expect(body({ uid: "u", startsAt: MON9, organizer: { email: "" } }).some((l) => l.startsWith("ORGANIZER"))).toBe(false);
  });
  it("writes a reminder as an alarm, before the start, and skips what is not a number", () => {
    const b = body({ uid: "u", startsAt: MON9, summary: "Review, now", reminders: [10, 0, -5, Number.NaN, 1.6] });
    const triggers = b.filter((l) => l.startsWith("TRIGGER"));
    expect(triggers).toEqual(["TRIGGER:-PT10M", "TRIGGER:-PT0M", "TRIGGER:PT5M", "TRIGGER:-PT2M"]);
    expect(b.filter((l) => l === "BEGIN:VALARM")).toHaveLength(4);
    expect(b.filter((l) => l.startsWith("DESCRIPTION"))[0]).toBe("DESCRIPTION:Review\\, now");
    expect(body({ uid: "u", startsAt: MON9, reminders: [5] }).filter((l) => l.startsWith("DESCRIPTION"))).toEqual(["DESCRIPTION:Reminder"]);
  });
});

describe("long lines", () => {
  const octets = (s: string) => new TextEncoder().encode(s).length;
  it("are folded at 75 octets, each continuation starting with a space and holding at most 74 more", () => {
    const out = lines(buildIcs([{ uid: "u", startsAt: MON9, description: "x".repeat(200) }]));
    const folded = out.filter((l, i) => l.startsWith("DESCRIPTION:") || (i > 0 && l.startsWith(" ")));
    // 12 octets of name, then 63 of text; each continuation spends one on its space and holds 74 more; the last takes what is left of the 200.
    expect(folded.map(octets)).toEqual([75, 75, 64]);
    expect(out.every((l) => octets(l) <= 75)).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });
  it("are not cut inside a character that takes several octets", () => {
    const text = "é".repeat(100) + "日本語".repeat(30) + "😀".repeat(20);
    const out = buildIcs([{ uid: "u", startsAt: MON9, description: text }]);
    expect(lines(out).every((l) => octets(l) <= 75)).toBe(true);
    expect(out).not.toContain("�");
    expect(parseIcs(out).events[0].description).toBe(text);
  });
});

describe("what is read back", () => {
  it("is what was written, for a rich timed event", () => {
    const e: IcsEventInput = {
      uid: "round-1", summary: "Review, with; punctuation", description: "Line one\nLine two, with a comma; and a semicolon \\ backslash", location: "Room 2, floor 3", url: "https://x.test/p?a=1&b=2",
      startsAt: MON9, endsAt: MON9 + 90 * 60_000, status: "tentative", organizer: { email: "ann@x.test", name: "Ann Lee" },
      attendees: [{ email: "a@x.test", name: "Alex", rsvp: "accepted" }, { email: "b@x.test", optional: true }], reminders: [10, 1440],
    };
    const [r] = parseIcs(buildIcs([e], { name: "Mine" })).events;
    expect(r).toMatchObject({ uid: "round-1", summary: e.summary, description: e.description, location: e.location, url: e.url, allDay: false, startsAt: e.startsAt, endsAt: e.endsAt, status: "tentative", organizer: { email: "ann@x.test", name: "Ann Lee" } });
    expect(r.attendees.map((a) => [a.email, a.name, a.rsvp, a.optional])).toEqual([["a@x.test", "Alex", "accepted", false], ["b@x.test", "", "needs-action", true]]);
    expect(r.reminders).toEqual([10, 1440]);
    expect(parseIcs(buildIcs([e], { name: "Mine" })).name).toBe("Mine");
  });
  it("is the same all-day event, with its last day inclusive again", () => {
    const [r] = parseIcs(buildIcs([{ uid: "d", summary: "Trip", allDay: true, startDate: "2026-10-05", endDate: "2026-10-07" }])).events;
    expect(r).toMatchObject({ allDay: true, startDate: "2026-10-05", endDate: "2026-10-07" });
  });
  it("keeps a repeat with its zone, its skipped days and the occurrence it replaces", () => {
    const [series] = parseIcs(buildIcs([{ uid: "s", summary: "Weekly", startsAt: Date.UTC(2026, 9, 19, 8), endsAt: Date.UTC(2026, 9, 19, 9), tzid: "Europe/London", rrule: "FREQ=WEEKLY;BYDAY=MO", exdates: [Date.UTC(2026, 9, 26, 9)] }])).events;
    expect(series).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=MO", tzid: "Europe/London", startsAt: Date.UTC(2026, 9, 19, 8) });
    const [override] = parseIcs(buildIcs([{ uid: "s", summary: "Moved", startsAt: Date.UTC(2026, 10, 2, 14), recurrenceId: Date.UTC(2026, 10, 2, 9) }])).events;
    expect(override).toMatchObject({ uid: "s", recurrenceId: "2026-11-02", summary: "Moved" });
  });
  it("is many events in a calendar, in order", () => {
    const events = [1, 2, 3].map((i) => ({ uid: `e${i}`, summary: `Event ${i}`, startsAt: MON9 + i * 3_600_000 }));
    expect(parseIcs(buildIcs(events)).events.map((e) => e.summary)).toEqual(["Event 1", "Event 2", "Event 3"]);
  });
});
