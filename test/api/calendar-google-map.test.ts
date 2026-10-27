import { describe, expect, it } from "vitest";
import { dayMs, eventBody, mapEvent, shiftDate } from "../../src/api/calendar/google";
import type { CalendarRow, EventRow } from "../../src/api/calendar/types";

const mockCal: CalendarRow = {
  id: "cal-123",
  user_id: "user-456",
  account_id: "acc-789",
  source: "google",
  remote_id: "primary",
  url: null,
  name: "Work Calendar",
  description: "Main calendar",
  color: "#4285f4",
  timezone: "America/New_York",
  visible: 1,
  writable: 1,
  is_default: 1,
  position: 0,
  sync_status: "idle",
  sync_error: null,
  sync_token: "tok-1",
  etag: null,
  last_synced_at: 1000,
  full_synced_at: 1000,
  created_at: 1000,
  updated_at: 1000,
};

describe("Google calendar date helpers", () => {
  it("converts YYYY-MM-DD to epoch ms and shifts dates cleanly", () => {
    const ms = dayMs("2026-10-05");
    expect(ms).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(shiftDate("2026-10-05", 1)).toBe("2026-10-06");
    expect(shiftDate("2026-10-05", -1)).toBe("2026-10-04");
    expect(shiftDate("2026-10-01", -1)).toBe("2026-09-30");
  });
});

describe("mapEvent: Google event to inbox row", () => {
  it("maps an all-day event with exclusive end date to inclusive row", () => {
    const row = mapEvent(mockCal, {
      id: "g-all-day",
      summary: "Annual Offsite",
      start: { date: "2026-10-05" },
      end: { date: "2026-10-08" },
      transparency: "transparent",
      status: "confirmed",
    });

    expect(row.title).toBe("Annual Offsite");
    expect(row.all_day).toBe(1);
    expect(row.start_date).toBe("2026-10-05");
    expect(row.end_date).toBe("2026-10-07"); // inclusive last day
    expect(row.starts_at).toBe(Date.parse("2026-10-05T00:00:00Z"));
    expect(row.ends_at).toBe(Date.parse("2026-10-08T00:00:00Z"));
    expect(row.busy).toBe(0);
    expect(row.status).toBe("confirmed");
  });

  it("maps a single-day all-day event where end date is omitted or equal", () => {
    const row = mapEvent(mockCal, {
      id: "g-single-day",
      summary: "Holiday",
      start: { date: "2026-12-25" },
      end: { date: "2026-12-25" },
    });

    expect(row.start_date).toBe("2026-12-25");
    expect(row.end_date).toBe("2026-12-25");
    expect(row.starts_at).toBe(Date.parse("2026-12-25T00:00:00Z"));
    expect(row.ends_at).toBe(Date.parse("2026-12-26T00:00:00Z"));
  });

  it("maps a timed event with attendees, rsvp, conference link, and reminders", () => {
    const row = mapEvent(mockCal, {
      id: "g-meeting",
      summary: "Sprint Planning",
      description: "Q4 planning",
      location: "Room 101",
      start: { dateTime: "2026-10-05T14:00:00Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-10-05T15:00:00Z", timeZone: "America/New_York" },
      organizer: { email: "Boss@Example.com", displayName: "The Boss" },
      attendees: [
        { email: "Me@Example.com", displayName: "Me", responseStatus: "accepted", self: true },
        { email: "Colleague@Example.com", displayName: "Colleague", responseStatus: "tentative", optional: true },
      ],
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
      },
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 15 }, { method: "email", minutes: 60 }],
      },
      transparency: "opaque",
      status: "tentative",
      htmlLink: "https://calendar.google.com/event?eid=123",
      etag: '"etag-999"',
    });

    expect(row.all_day).toBe(0);
    expect(row.start_date).toBeNull();
    expect(row.end_date).toBeNull();
    expect(row.starts_at).toBe(Date.parse("2026-10-05T14:00:00Z"));
    expect(row.ends_at).toBe(Date.parse("2026-10-05T15:00:00Z"));
    expect(row.timezone).toBe("America/New_York");
    expect(row.busy).toBe(1);
    expect(row.status).toBe("tentative");
    expect(row.organizer_email).toBe("boss@example.com");
    expect(row.organizer_name).toBe("The Boss");
    expect(row.rsvp).toBe("accepted");
    expect(row.conference_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(row.url).toBe("https://calendar.google.com/event?eid=123");
    expect(row.etag).toBe('"etag-999"');

    const attendees = JSON.parse(row.attendees_json);
    expect(attendees).toEqual([
      { email: "me@example.com", name: "Me", rsvp: "accepted", optional: false, organizer: false },
      { email: "colleague@example.com", name: "Colleague", rsvp: "tentative", optional: true, organizer: false },
    ]);

    const reminders = JSON.parse(row.reminders_json);
    expect(reminders).toEqual([{ minutes: 15 }, { minutes: 60 }]);
  });
});

describe("eventBody: inbox row to Google API payload", () => {
  it("formats all-day event with exclusive end date", () => {
    const row: EventRow = {
      id: "e-1",
      user_id: "u-1",
      calendar_id: "c-1",
      remote_id: "g-1",
      ical_uid: null,
      kind: "event",
      title: "Conference",
      description: "Tech conf",
      location: "Moscone Center",
      emoji: "",
      all_day: 1,
      starts_at: Date.parse("2026-11-10T00:00:00Z"),
      ends_at: Date.parse("2026-11-13T00:00:00Z"),
      start_date: "2026-11-10",
      end_date: "2026-11-12",
      timezone: "",
      rrule: "FREQ=YEARLY",
      exdates: "",
      master_id: null,
      occurrence_date: null,
      status: "confirmed",
      busy: 1,
      countdown: 0,
      circled: 0,
      organizer_email: "",
      organizer_name: "",
      attendees_json: JSON.stringify([{ email: "guest@example.com", name: "Guest", optional: true, rsvp: "accepted" }]),
      rsvp: "accepted",
      conference_url: "",
      url: "",
      reminders_json: JSON.stringify([{ minutes: 30 }]),
      thread_id: null,
      message_id: null,
      done_at: null,
      etag: "tag",
      created_at: 1000,
      updated_at: 1000,
    };

    const body = eventBody(row);
    expect(body.summary).toBe("Conference");
    expect(body.start).toEqual({ date: "2026-11-10" });
    expect(body.end).toEqual({ date: "2026-11-13" }); // shifted +1 from end_date
    expect(body.recurrence).toEqual(["RRULE:FREQ=YEARLY"]);
    expect(body.transparency).toBe("opaque");
    expect(body.reminders).toEqual({
      useDefault: false,
      overrides: [{ method: "popup", minutes: 30 }],
    });
    expect(body.attendees).toEqual([
      { email: "guest@example.com", displayName: "Guest", optional: true, responseStatus: "accepted" },
    ]);
  });

  it("formats timed event with ISO timestamps and timezone", () => {
    const row: EventRow = {
      id: "e-2",
      user_id: "u-1",
      calendar_id: "c-1",
      remote_id: "g-2",
      ical_uid: null,
      kind: "event",
      title: "1-on-1",
      description: "",
      location: "",
      emoji: "",
      all_day: 0,
      starts_at: Date.parse("2026-10-05T10:00:00Z"),
      ends_at: Date.parse("2026-10-05T10:30:00Z"),
      start_date: null,
      end_date: null,
      timezone: "America/Chicago",
      rrule: null,
      exdates: "",
      master_id: null,
      occurrence_date: null,
      status: "cancelled", // converted to confirmed on export unless active
      busy: 0,
      countdown: 0,
      circled: 0,
      organizer_email: "",
      organizer_name: "",
      attendees_json: "[]",
      rsvp: "",
      conference_url: "",
      url: "",
      reminders_json: "[]",
      thread_id: null,
      message_id: null,
      done_at: null,
      etag: null,
      created_at: 1000,
      updated_at: 1000,
    };

    const body = eventBody(row);
    expect(body.summary).toBe("1-on-1");
    expect(body.transparency).toBe("transparent");
    expect(body.status).toBe("confirmed");
    expect(body.start).toEqual({
      dateTime: "2026-10-05T10:00:00.000Z",
      timeZone: "America/Chicago",
    });
    expect(body.end).toEqual({
      dateTime: "2026-10-05T10:30:00.000Z",
      timeZone: "America/Chicago",
    });
  });
});
