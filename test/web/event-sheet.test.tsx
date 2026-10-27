import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Calendar, CalEvent, CalendarSettings } from "@shared/types";
import { html, NOW } from "./render";
import { EventForm, EventSheet } from "@/calendar/EventSheet";

// The event editor drawn for the cases it has: a new timed and all-day event, a stored event with guests, a link and an email behind it, repeating events of
// each kind, a to-do, and one from a subscribed (read-only) calendar. The sheet draws into a portal that does not exist on the server, so a plain stand-in
// takes its place here; the calendar's state comes from a fixed stand-in too. First paint only: opening a menu or typing is not part of this.

const calendar = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/calendar/CalendarContext", async (orig) => ({ ...(await orig<Record<string, unknown>>()), useCalendar: () => calendar.value }));
vi.mock("@/components/ui/sheet", async () => {
  const el = (tag: string) => ({ children, ...p }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) => {
    const Tag = tag as "div";
    return <Tag className={p.className} style={p.style}>{children}</Tag>;
  };
  return { Sheet: ({ children }: { children?: React.ReactNode }) => <>{children}</>, SheetContent: el("div"), SheetHeader: el("header"), SheetTitle: el("h2"), SheetDescription: el("p") };
});

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const cal = (id: string, o: Partial<Calendar> = {}): Calendar => ({ id, account_id: null, source: "local", remote_id: null, url: null, name: id === "work" ? "Work" : id === "feed" ? "Holidays" : "Home", description: "", color: "#3b82f6", timezone: "UTC", visible: true, writable: true, is_default: id === "work", position: 0, last_synced_at: null, sync_status: "idle", ...o } as Calendar);
const CALENDARS = [cal("work"), cal("home", { color: "#10b981" }), cal("feed", { writable: false, source: "ics" as never })];
const SETTINGS: CalendarSettings = { timezone: "UTC", week_start: 1, night_start: 22, night_end: 7, collapse_night: false, time_format: "24", default_view: "week", show_declined: false, cover_art: true };
const T9 = Date.UTC(2026, 9, 3, 9, 0);

const closeEditor = vi.fn();
const setState = (settings: Partial<CalendarSettings> = {}, calendars = CALENDARS) => {
  calendar.value = { editor: null, closeEditor, calendars, settings: { ...SETTINGS, ...settings }, openEvent: vi.fn() };
};

const ev = (o: Partial<CalEvent> = {}): CalEvent =>
  ({
    id: "e1", event_id: "e1", occurrence_date: null, calendar_id: "work", calendar_name: "Work", calendar_color: "#3b82f6", source: "local", writable: true, kind: "event",
    title: "Studio review", description: "Bring the cables.", location: "Room 2", emoji: "🎬", all_day: false, starts_at: T9, ends_at: T9 + 90 * 60_000, start_date: null, end_date: null,
    timezone: "UTC", rrule: null, recurring: false, status: "confirmed", busy: true, countdown: false, circled: false, organizer: null, attendees: [], rsvp: "needsAction",
    conference_url: "", url: "", reminders: [], thread_id: null, done: false, created_at: NOW - 5 * 86_400_000, updated_at: NOW - 5 * 86_400_000, ...o,
  }) as CalEvent;

const edit = (o: Partial<CalEvent> = {}) => html(<EventForm target={{ mode: "edit", event: ev(o) }} />, "/calendar");
const create = (prefill: object) => html(<EventForm target={{ mode: "create", prefill: { starts_at: T9, ends_at: T9 + 3_600_000, ...prefill } }} />, "/calendar");

describe("a new event", () => {
  it("timed, from a time picked in the grid", () => {
    setState();
    expect(create({})).toMatchSnapshot();
  });
  it("all day", () => {
    setState();
    expect(create({ all_day: true, start_date: "2026-10-03", end_date: "2026-10-05" })).toMatchSnapshot();
  });
  it("with the clock in 12-hour time", () => {
    setState({ time_format: "12" });
    expect(create({})).toMatchSnapshot();
  });
  it("with no writable calendar to put it on", () => {
    setState({}, [CALENDARS[2]]);
    expect(create({})).toMatchSnapshot();
  });
  it("from an email, with its title, notes and a guest", () => {
    setState();
    expect(create({ title: "Lunch with Alex", description: "From a thread", thread_id: "t-1", attendees: [{ email: "alex@studio.test", name: "Alex Rivera" }] })).toMatchSnapshot();
  });
});

describe("a stored event", () => {
  it("a plain one", () => {
    setState();
    expect(edit()).toMatchSnapshot();
  });
  it("with guests, and an invitation of yours to answer", () => {
    setState();
    expect(edit({ attendees: [{ email: "maya@gmail.test", name: "Maya Chen", rsvp: "tentative" }, { email: "alex@studio.test", name: "Alex Rivera", rsvp: "accepted" }, { email: "sam@studio.test", name: "Sam", rsvp: "declined" }, { email: "lee@studio.test", name: "Lee", rsvp: "needsAction" }] as never, rsvp: "tentative" })).toMatchSnapshot();
  });
  it("with a meeting link, an email behind it, a link, reminders and extras, edited since it was added", () => {
    setState();
    expect(edit({ conference_url: "https://meet.example.test/abc-defg", thread_id: "t-1", url: "https://studio.test/plan", reminders: [{ minutes: 10 }, { minutes: 120 }, { minutes: 1440 }], countdown: true, circled: true, updated_at: NOW - 3_600_000 })).toMatchSnapshot();
  });
  it("an all-day event", () => {
    setState();
    expect(edit({ all_day: true, start_date: "2026-10-03", end_date: "2026-10-05", starts_at: Date.UTC(2026, 9, 3), ends_at: Date.UTC(2026, 9, 6) })).toMatchSnapshot();
  });
  it("a to-do, open and done", () => {
    setState();
    expect(edit({ kind: "todo" })).toMatchSnapshot();
    expect(edit({ kind: "todo", done: true })).toMatchSnapshot();
  });
});

describe("a repeating event", () => {
  it("weekly, ending after a number of times", () => {
    setState();
    expect(edit({ rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=6", recurring: true })).toMatchSnapshot();
  });
  it("daily, ending on a day", () => {
    setState();
    expect(edit({ rrule: "FREQ=DAILY;UNTIL=20261231T235900Z", recurring: true })).toMatchSnapshot();
  });
  it("on a custom rule", () => {
    setState();
    expect(edit({ rrule: "FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,TH", recurring: true })).toMatchSnapshot();
  });
  it("one occurrence of a series Google already expanded", () => {
    setState();
    expect(edit({ recurring: true, series: true, id: "e1@2026-10-10", occurrence_date: "2026-10-10" })).toMatchSnapshot();
  });
});

describe("a read-only event", () => {
  it("from a subscribed calendar", () => {
    setState();
    expect(edit({ calendar_id: "feed", calendar_name: "Holidays", writable: false, title: "Public holiday", attendees: [{ email: "x@y.test", name: "X", rsvp: "accepted" }] as never })).toMatchSnapshot();
  });
});

describe("the sheet", () => {
  it("draws nothing until there is something to edit", () => {
    setState();
    expect(html(<EventSheet />, "/calendar")).toBe("");
  });
  it("draws the form for the event being edited", () => {
    setState();
    calendar.value = { ...calendar.value, editor: { mode: "edit", event: ev() } };
    expect(html(<EventSheet />, "/calendar")).toBe(edit());
  });
});
