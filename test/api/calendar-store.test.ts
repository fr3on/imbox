import { beforeAll, describe, expect, it } from "vitest";
import { call, json, signIn, testEnv } from "../api-harness";

// The calendar's data layer (src/api/calendar/store.ts) driven through its routes, against a real PostgreSQL: settings, creating events (timed, all-day,
// clamped input), the window query with repeats, overrides, exceptions and hidden rows, the three scopes of an edit and a delete, answers, to-dos,
// duplicates and the .ics export. Written before the file was split into modules, so a move that changes what any of this does shows up here.

const db = () => testEnv.DB;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Ids are random and times are now: number the ids by first appearance and zero the stamps, so a snapshot says what happened and nothing else. */
function steady(v: unknown): unknown {
  const seen = new Map<string, string>();
  const text = JSON.stringify(v).replace(UUID, (id) => {
    if (!seen.has(id)) seen.set(id, `<id${seen.size + 1}>`);
    return seen.get(id) as string;
  });
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, k === "created_at" || k === "updated_at" || k === "last_synced_at" ? 0 : walk(val)]));
    return x;
  };
  return walk(JSON.parse(text));
}

const T = (d: string) => Date.parse(d);
const H = 3_600_000;
const DAY = 24 * H;
// Monday 5 October 2026, 09:00 UTC.
const MON9 = T("2026-10-05T09:00:00Z");

interface Who {
  token: string;
  user: string;
  cal: string;
  get: (p: string) => Promise<Response>;
  post: (p: string, b?: unknown) => Promise<Response>;
  patch: (p: string, b?: unknown) => Promise<Response>;
  put: (p: string, b?: unknown) => Promise<Response>;
  del: (p: string) => Promise<Response>;
}

async function who(user: string, calendars = 1): Promise<Who> {
  const token = await signIn(user);
  const ids: string[] = [];
  for (let i = 0; i < calendars; i++) ids.push((await json(await call("POST", "/api/calendar/sources", { token, body: { name: `Cal ${i + 1}` } }))).id);
  return {
    token,
    user,
    cal: ids[0],
    get: (p) => call("GET", p, { token }),
    post: (p, b) => call("POST", p, { token, body: b ?? {} }),
    patch: (p, b) => call("PATCH", p, { token, body: b ?? {} }),
    put: (p, b) => call("PUT", p, { token, body: b ?? {} }),
    del: (p) => call("DELETE", p, { token }),
  };
}

const create = async (w: Who, body: Record<string, unknown>) => json(await w.post("/api/calendar/events", { calendar_id: w.cal, ...body }));
const range = async (w: Who, from: string, to: string, q = "") => (await json(await w.get(`/api/calendar/events?from=${from}&to=${to}${q}`))).events as Record<string, any>[];
/** One line per drawn event: the day it starts on in UTC, the time, and what it is called; a repeat's id carries its date. */
const lines = (events: Record<string, any>[]) => events.map((e) => `${new Date(e.starts_at).toISOString().slice(0, 16)}${e.all_day ? " (all day)" : ""} ${e.title}${e.occurrence_date ? ` [${e.occurrence_date}]` : ""}${e.done ? " done" : ""}`);
const rows = async (w: Who) =>
  steady((await db().prepare(`SELECT title, starts_at, ends_at, rrule, exdates, master_id, occurrence_date, rsvp, done_at IS NOT NULL AS done FROM events WHERE user_id = ? ORDER BY starts_at, title, occurrence_date`).bind(w.user).all()).results);

beforeAll(async () => {
  await call("GET", "/api/calendar/settings", { token: await signIn("cs-warm") });
});

describe("settings", () => {
  it("start from the defaults, and clamp what is sent", async () => {
    const w = await who("cs-set");
    expect(steady(await json(await w.get("/api/calendar/settings")))).toMatchSnapshot();
    const r = await json(await w.put("/api/calendar/settings", { week_start: 9, night_start: -3, night_end: 99, timezone: "  Europe/London  ", collapse_night: false, show_declined: true, cover_art: true }));
    expect(r).toMatchObject({ week_start: 6, night_start: 0, night_end: 23, time_format: "12", default_view: "week", timezone: "Europe/London", collapse_night: false, show_declined: true, cover_art: true });
    expect(await json(await w.put("/api/calendar/settings", { time_format: "24", default_view: "month" }))).toMatchObject({ time_format: "24", default_view: "month", week_start: 6, timezone: "Europe/London" });
    expect(await json(await w.get("/api/calendar/settings"))).toMatchObject({ time_format: "24", default_view: "month" });
  });
  it("refuse a clock or a view they do not know, and keep the view when the route allows one the store does not", async () => {
    const w = await who("cs-set2");
    const bad = await w.put("/api/calendar/settings", { time_format: "13" });
    expect([bad.status, (await json(bad)).error]).toEqual([400, "bad_time_format"]);
    const view = await w.put("/api/calendar/settings", { default_view: "decade" });
    expect([view.status, (await json(view)).error]).toEqual([400, "bad_view"]);
    await w.put("/api/calendar/settings", { default_view: "year" });
    expect((await json(await w.put("/api/calendar/settings", { default_view: "agenda" }))).default_view).toBe("year");
  });
});

describe("creating an event", () => {
  it("a timed event with only a start gets an hour, the calendar's timezone and the defaults", async () => {
    const w = await who("cs-c1");
    const e = await create(w, { title: "Standup", starts_at: MON9 });
    expect(e).toMatchObject({ title: "Standup", starts_at: MON9, ends_at: MON9 + H, all_day: false, kind: "event", status: "confirmed", busy: true, timezone: "UTC", recurring: false, writable: true });
    expect(steady(e)).toMatchSnapshot();
  });
  it("clamps long text and ignores unknown kinds and statuses", async () => {
    const w = await who("cs-c2");
    const e = await create(w, { title: "x".repeat(600), location: "y".repeat(600), emoji: "e".repeat(40), kind: "party", status: "maybe", starts_at: MON9, ends_at: MON9 + H });
    expect([e.title.length, e.location.length, e.emoji.length, e.kind, e.status]).toEqual([500, 500, 16, "event", "confirmed"]);
  });
  it("pins an all-day event to UTC midnights and never lets it end before it starts", async () => {
    const w = await who("cs-c3");
    const a = await create(w, { title: "Offsite", all_day: true, start_date: "2026-10-05", end_date: "2026-10-03" });
    expect(a).toMatchObject({ all_day: true, start_date: "2026-10-05", end_date: "2026-10-05", starts_at: T("2026-10-05T00:00:00Z"), ends_at: T("2026-10-05T00:00:00Z") });
    const b = await create(w, { title: "Trip", all_day: true, start_date: "2026-10-05", end_date: "2026-10-08" });
    expect(b).toMatchObject({ start_date: "2026-10-05", end_date: "2026-10-08", ends_at: T("2026-10-08T00:00:00Z") });
    // Given only a start instant, the end falls back to midnight of that day, which is before a start at nine: so it is refused.
    const c = await w.post("/api/calendar/events", { calendar_id: w.cal, title: "From an instant", all_day: true, starts_at: MON9 });
    expect([c.status, (await json(c)).error]).toEqual([400, "bad_time"]);
    const d = await create(w, { title: "From midnight", all_day: true, starts_at: T("2026-10-05T00:00:00Z") });
    expect(d).toMatchObject({ start_date: "2026-10-05", end_date: "2026-10-05" });
  });
  it("tidies guests and reminders", async () => {
    const w = await who("cs-c4");
    const e = await create(w, {
      title: "Review",
      starts_at: MON9,
      attendees: [{ email: " Alex@Studio.Test ", name: "Alex" }, { email: "nope" }, { email: "b@studio.test", optional: true }, { name: "no address" }],
      reminders: [{ minutes: -5 }, { minutes: 99_999 }, { minutes: 30 }, { minutes: "soon" }],
    });
    expect(e.attendees).toEqual([{ email: "alex@studio.test", name: "Alex" }, { email: "b@studio.test", optional: true }]);
    expect(e.reminders).toEqual([{ minutes: 0 }, { minutes: 40_320 }, { minutes: 30 }]);
  });
  it("refuses an end before the start, a calendar that is not there, and having no calendar at all", async () => {
    const w = await who("cs-c5");
    const bad = await w.post("/api/calendar/events", { calendar_id: w.cal, title: "Backwards", starts_at: MON9, ends_at: MON9 - H });
    expect([bad.status, (await json(bad)).error]).toEqual([400, "bad_time"]);
    expect((await w.post("/api/calendar/events", { calendar_id: "nope", title: "Lost", starts_at: MON9 })).status).toBe(404);
    const bare = await who("cs-c6", 0);
    const none = await bare.post("/api/calendar/events", { title: "Nowhere", starts_at: MON9 });
    expect([none.status, (await json(none)).error]).toEqual([400, "no_calendar"]);
  });
  it("goes on the first writable calendar when none is asked for", async () => {
    const w = await who("cs-c7", 2);
    const e = await json(await w.post("/api/calendar/events", { title: "Anywhere", starts_at: MON9 }));
    expect(e.calendar_name).toBe("Cal 1");
  });
  it("is refused on a subscribed (read-only) calendar", async () => {
    const w = await who("cs-c8");
    const ics = crypto.randomUUID();
    await db().prepare(`INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at) VALUES (?, ?, NULL, 'ics', NULL, 'https://x.test/a.ics', 'Holidays', '', '#111111', '', 1, 0, 0, 9, 'idle', ?, ?)`).bind(ics, w.user, 1, 1).run();
    const r = await w.post("/api/calendar/events", { calendar_id: ics, title: "Nope", starts_at: MON9 });
    expect([r.status, (await json(r)).error]).toEqual([403, "read_only"]);
  });
});

describe("the window of days", () => {
  it("draws plain and all-day events in order, all-day first on each day", async () => {
    const w = await who("cs-r1");
    await create(w, { title: "Late", starts_at: MON9 + 8 * H });
    await create(w, { title: "Early", starts_at: MON9 - 2 * H });
    await create(w, { title: "Holiday", all_day: true, start_date: "2026-10-05" });
    await create(w, { title: "Tomorrow", starts_at: MON9 + DAY });
    await create(w, { title: "Same time B", starts_at: MON9 });
    await create(w, { title: "Same time A", starts_at: MON9 });
    expect(lines(await range(w, "2026-10-05", "2026-10-06"))).toEqual([
      "2026-10-05T00:00 (all day) Holiday", "2026-10-05T07:00 Early", "2026-10-05T09:00 Same time A", "2026-10-05T09:00 Same time B", "2026-10-05T17:00 Late", "2026-10-06T09:00 Tomorrow",
    ]);
  });
  it("includes an event that starts the day before and runs into the window, and leaves out ones beyond the edge", async () => {
    const w = await who("cs-r2");
    await create(w, { title: "Overnight", starts_at: T("2026-10-04T22:00:00Z"), ends_at: T("2026-10-05T02:00:00Z") });
    await create(w, { title: "Far before", starts_at: T("2026-09-20T10:00:00Z") });
    await create(w, { title: "Far after", starts_at: T("2026-11-20T10:00:00Z") });
    expect(lines(await range(w, "2026-10-05", "2026-10-05"))).toEqual(["2026-10-04T22:00 Overnight"]);
  });
  it("hides cancelled events, hides declined ones unless asked, and hides hidden calendars unless all=1", async () => {
    const w = await who("cs-r3", 2);
    const cal2 = (await db().prepare(`SELECT id FROM calendars WHERE user_id = ? AND name = 'Cal 2'`).bind(w.user).first<{ id: string }>())!.id;
    await create(w, { title: "Kept", starts_at: MON9 });
    await create(w, { title: "Cancelled", starts_at: MON9, status: "cancelled" });
    const declined = await create(w, { title: "Declined", starts_at: MON9 });
    await w.post(`/api/calendar/events/${declined.id}/rsvp`, { rsvp: "declined" });
    await create(w, { calendar_id: cal2, title: "On the other calendar", starts_at: MON9 });
    await db().prepare(`UPDATE calendars SET visible = 0 WHERE id = ?`).bind(cal2).run();
    expect(lines(await range(w, "2026-10-05", "2026-10-05"))).toEqual(["2026-10-05T09:00 Kept"]);
    expect(lines(await range(w, "2026-10-05", "2026-10-05", "&all=1"))).toEqual(["2026-10-05T09:00 Kept", "2026-10-05T09:00 On the other calendar"]);
    await w.put("/api/calendar/settings", { show_declined: true });
    expect(lines(await range(w, "2026-10-05", "2026-10-05"))).toEqual(["2026-10-05T09:00 Declined", "2026-10-05T09:00 Kept"]);
  });
  it("expands a weekly repeat in the window, each occurrence with its own id and date", async () => {
    const w = await who("cs-r4");
    const m = await create(w, { title: "Weekly", starts_at: MON9, ends_at: MON9 + H, rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const got = await range(w, "2026-10-05", "2026-10-26");
    expect(lines(got)).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-12T09:00 Weekly [2026-10-12]", "2026-10-19T09:00 Weekly [2026-10-19]", "2026-10-26T09:00 Weekly [2026-10-26]"]);
    expect(got.map((e) => e.id)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"].map((d) => `${m.id}@${d}`));
    expect(got.every((e) => e.recurring && e.event_id === m.id && e.rrule === "FREQ=WEEKLY;BYDAY=MO")).toBe(true);
    expect(steady(got[1])).toMatchSnapshot();
  });
  it("keeps the wall-clock time of a repeat across a clock change", async () => {
    const w = await who("cs-r5");
    await w.put("/api/calendar/settings", { timezone: "Europe/London" });
    // 09:00 in London on 19 October is 08:00 UTC; the clocks go back on the 25th.
    await create(w, { title: "London weekly", starts_at: T("2026-10-19T08:00:00Z"), ends_at: T("2026-10-19T09:00:00Z"), timezone: "Europe/London", rrule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(lines(await range(w, "2026-10-19", "2026-11-02"))).toEqual(["2026-10-19T08:00 London weekly [2026-10-19]", "2026-10-26T09:00 London weekly [2026-10-26]", "2026-11-02T09:00 London weekly [2026-11-02]"]);
  });
  it("expands an all-day repeat on UTC dates and keeps its span", async () => {
    const w = await who("cs-r6");
    await create(w, { title: "Two days", all_day: true, start_date: "2026-10-05", end_date: "2026-10-06", rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const got = await range(w, "2026-10-12", "2026-10-19");
    expect(got.map((e) => [e.occurrence_date, e.start_date, e.end_date])).toEqual([["2026-10-12", "2026-10-12", "2026-10-13"], ["2026-10-19", "2026-10-19", "2026-10-20"]]);
  });
  it("stops a repeat at its end, and reads a rule it does not understand as a single occurrence", async () => {
    const w = await who("cs-r7");
    await create(w, { title: "Counted", starts_at: MON9, rrule: "FREQ=DAILY;COUNT=2" });
    await create(w, { title: "Broken", starts_at: MON9, rrule: "FREQ=SOMETIMES" });
    await create(w, { title: "Plain", starts_at: MON9 + 2 * DAY });
    expect(lines(await range(w, "2026-10-05", "2026-10-08"))).toEqual(["2026-10-05T09:00 Broken [2026-10-05]", "2026-10-05T09:00 Counted [2026-10-05]", "2026-10-06T09:00 Counted [2026-10-06]", "2026-10-07T09:00 Plain"]);
  });
  it("refuses a bad or too wide window", async () => {
    const w = await who("cs-r8");
    for (const q of ["from=2026-13-01&to=2026-10-02", "from=2026-10-05&to=2026-10-01", "from=2026-01-01&to=2027-12-31"]) {
      const r = await w.get(`/api/calendar/events?${q}`);
      expect([r.status, (await json(r)).error]).toEqual([400, q.includes("2027") ? "range_too_wide" : q.includes("13") ? "bad_date" : "bad_range"]);
    }
  });
});

const seriesOf = async (w: Who, extra: Record<string, unknown> = {}) => create(w, { title: "Weekly", starts_at: MON9, ends_at: MON9 + H, rrule: "FREQ=WEEKLY;BYDAY=MO", location: "Room 2", ...extra });

describe("editing", () => {
  it("a plain event takes the changes it is sent and keeps the rest", async () => {
    const w = await who("cs-e1");
    const e = await create(w, { title: "Before", starts_at: MON9, ends_at: MON9 + H, location: "Room 2", attendees: [{ email: "a@x.test" }] });
    const r = await json(await w.patch(`/api/calendar/events/${e.id}`, { title: "After", starts_at: MON9 + H, ends_at: MON9 + 2 * H }));
    expect(r).toMatchObject({ title: "After", starts_at: MON9 + H, ends_at: MON9 + 2 * H, location: "Room 2", attendees: [{ email: "a@x.test" }] });
    const bad = await w.patch(`/api/calendar/events/${e.id}`, { starts_at: MON9 + 5 * H });
    expect([bad.status, (await json(bad)).error]).toEqual([400, "bad_time"]);
    expect((await json(await w.patch(`/api/calendar/events/${e.id}`, { attendees: [] }))).attendees).toEqual([]);
  });
  it("one occurrence becomes its own row, takes the time it was moved to and leaves its slot empty", async () => {
    const w = await who("cs-e2");
    const m = await seriesOf(w);
    const moved = await json(await w.patch(`/api/calendar/events/${m.id}@2026-10-12`, { title: "Moved", starts_at: T("2026-10-12T14:00:00Z"), ends_at: T("2026-10-12T15:00:00Z") }));
    expect(moved).toMatchObject({ title: "Moved", rrule: null, recurring: true, occurrence_date: "2026-10-12", location: "Room 2" });
    expect(lines(await range(w, "2026-10-05", "2026-10-19"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-12T14:00 Moved [2026-10-12]", "2026-10-19T09:00 Weekly [2026-10-19]"]);
    expect(await rows(w)).toMatchSnapshot();
  });
  it("changing an occurrence again changes its row, it does not make another", async () => {
    const w = await who("cs-e3");
    const m = await seriesOf(w);
    await w.patch(`/api/calendar/events/${m.id}@2026-10-12`, { title: "First" });
    await w.patch(`/api/calendar/events/${m.id}@2026-10-12`, { title: "Second" });
    const overrides = ((await rows(w)) as { master_id: string | null }[]).filter((r) => r.master_id);
    expect(overrides).toHaveLength(1);
    expect(lines(await range(w, "2026-10-12", "2026-10-12"))).toEqual(["2026-10-12T09:00 Second [2026-10-12]"]);
  });
  it("this and following closes the old series just before and starts a new one here", async () => {
    const w = await who("cs-e4");
    const m = await seriesOf(w);
    const fresh = await json(await w.patch(`/api/calendar/events/${m.id}@2026-10-19?scope=following`, { title: "From now on", location: "Room 9" }));
    expect(fresh).toMatchObject({ title: "From now on", location: "Room 9", rrule: "FREQ=WEEKLY;BYDAY=MO", starts_at: T("2026-10-19T09:00:00Z") });
    expect(fresh.id).not.toBe(m.id);
    expect(lines(await range(w, "2026-10-05", "2026-11-02"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-12T09:00 Weekly [2026-10-12]", "2026-10-19T09:00 From now on [2026-10-19]", "2026-10-26T09:00 From now on [2026-10-26]", "2026-11-02T09:00 From now on [2026-11-02]"]);
    expect(await rows(w)).toMatchSnapshot();
  });
  it("this and following can give the new series a rule of its own", async () => {
    const w = await who("cs-e5");
    const m = await seriesOf(w);
    const fresh = await json(await w.patch(`/api/calendar/events/${m.id}@2026-10-12?scope=following`, { rrule: "FREQ=DAILY;COUNT=2" }));
    expect(fresh.rrule).toBe("FREQ=DAILY;COUNT=2");
    expect(lines(await range(w, "2026-10-05", "2026-10-20"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-12T09:00 Weekly [2026-10-12]", "2026-10-13T09:00 Weekly [2026-10-13]"]);
  });
  it("all events edits the series itself, whichever occurrence was addressed", async () => {
    const w = await who("cs-e6");
    const m = await seriesOf(w);
    const r = await json(await w.patch(`/api/calendar/events/${m.id}@2026-10-12?scope=all`, { title: "Renamed" }));
    expect(r.event_id).toBe(m.id);
    expect(lines(await range(w, "2026-10-05", "2026-10-12"))).toEqual(["2026-10-05T09:00 Renamed [2026-10-05]", "2026-10-12T09:00 Renamed [2026-10-12]"]);
  });
  it("is refused for an event that is not yours, and for a read-only calendar", async () => {
    const mine = await who("cs-e7");
    const other = await who("cs-e8");
    const e = await create(mine, { title: "Mine", starts_at: MON9 });
    expect((await other.patch(`/api/calendar/events/${e.id}`, { title: "Taken" })).status).toBe(404);
    expect((await other.del(`/api/calendar/events/${e.id}`)).status).toBe(404);
    expect((await other.post(`/api/calendar/events/${e.id}/rsvp`, { rsvp: "accepted" })).status).toBe(404);
    expect((await other.post(`/api/calendar/events/${e.id}/done`, { done: true })).status).toBe(404);
    expect((await other.post(`/api/calendar/events/${e.id}/duplicate`)).status).toBe(404);
    expect((await other.get(`/api/calendar/events/${e.id}.ics`)).status).toBe(404);
    expect((await json(await mine.get(`/api/calendar/events?from=2026-10-05&to=2026-10-05`))).events[0].title).toBe("Mine");
    await db().prepare(`UPDATE calendars SET source = 'ics' WHERE id = ?`).bind(mine.cal).run();
    const ro = await mine.patch(`/api/calendar/events/${e.id}`, { title: "Nope" });
    expect([ro.status, (await json(ro)).error]).toEqual([403, "read_only"]);
  });
});

describe("deleting", () => {
  it("a plain event goes, and so does asking again", async () => {
    const w = await who("cs-d1");
    const e = await create(w, { title: "Gone", starts_at: MON9 });
    expect((await json(await w.del(`/api/calendar/events/${e.id}`))).ok).toBe(true);
    expect(await rows(w)).toEqual([]);
    expect((await w.del(`/api/calendar/events/${e.id}`)).status).toBe(404);
  });
  it("one occurrence leaves a hole in the series and drops its own row", async () => {
    const w = await who("cs-d2");
    const m = await seriesOf(w);
    await w.patch(`/api/calendar/events/${m.id}@2026-10-19`, { title: "Edited" });
    await w.del(`/api/calendar/events/${m.id}@2026-10-12`);
    await w.del(`/api/calendar/events/${m.id}@2026-10-19`);
    expect(lines(await range(w, "2026-10-05", "2026-10-26"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-26T09:00 Weekly [2026-10-26]"]);
    expect(await rows(w)).toMatchSnapshot();
  });
  it("this and following ends the series before the occurrence", async () => {
    const w = await who("cs-d3");
    const m = await seriesOf(w);
    await w.del(`/api/calendar/events/${m.id}@2026-10-19?scope=following`);
    expect(lines(await range(w, "2026-10-05", "2026-11-09"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-12T09:00 Weekly [2026-10-12]"]);
    expect(((await rows(w)) as { rrule: string }[])[0].rrule).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019T085959Z");
  });
  it("all events removes the series, its edited occurrences and its completions", async () => {
    const w = await who("cs-d4");
    const m = await seriesOf(w, { kind: "todo" });
    await w.patch(`/api/calendar/events/${m.id}@2026-10-12`, { title: "Edited" });
    await w.post(`/api/calendar/events/${m.id}@2026-10-05/done`, { done: true });
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM event_completions WHERE event_id = ?`).bind(m.id).first<{ n: number }>())!.n).toBe(1);
    await w.del(`/api/calendar/events/${m.id}@2026-10-19?scope=all`);
    expect(await rows(w)).toEqual([]);
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM event_completions WHERE event_id = ?`).bind(m.id).first<{ n: number }>())!.n).toBe(0);
  });
});

describe("answers and to-dos", () => {
  it("records an answer, and refuses one it does not know", async () => {
    const w = await who("cs-a1");
    const e = await create(w, { title: "Invite", starts_at: MON9 });
    expect(await json(await w.post(`/api/calendar/events/${e.id}/rsvp`, { rsvp: "tentative" }))).toMatchObject({ rsvp: "tentative" });
    const bad = await w.post(`/api/calendar/events/${e.id}/rsvp`, { rsvp: "maybe" });
    expect([bad.status, (await json(bad)).error]).toEqual([400, "bad_rsvp"]);
    expect(((await rows(w)) as { rsvp: string }[])[0].rsvp).toBe("tentative");
  });
  it("an occurrence answers for the series until it has a row of its own", async () => {
    const w = await who("cs-a2");
    const m = await seriesOf(w);
    await w.post(`/api/calendar/events/${m.id}@2026-10-12/rsvp`, { rsvp: "accepted" });
    expect(((await rows(w)) as { rsvp: string }[]).map((r) => r.rsvp)).toEqual(["accepted"]);
    await w.patch(`/api/calendar/events/${m.id}@2026-10-19`, { title: "Own row" });
    await w.post(`/api/calendar/events/${m.id}@2026-10-19/rsvp`, { rsvp: "declined" });
    const after = (await rows(w)) as { title: string; rsvp: string; master_id: string | null }[];
    expect(after.map((r) => [r.title, r.master_id ? "override" : "master", r.rsvp])).toEqual([["Weekly", "master", "accepted"], ["Own row", "override", "declined"]]);
  });
  it("ticks a plain to-do off and on", async () => {
    const w = await who("cs-t1");
    const t = await create(w, { title: "Call", kind: "todo", starts_at: MON9 });
    expect(await json(await w.post(`/api/calendar/events/${t.id}/done`, { done: true }))).toMatchObject({ done: true });
    expect(((await rows(w)) as { done: boolean }[])[0].done).toBe(true);
    expect(await json(await w.post(`/api/calendar/events/${t.id}/done`, { done: false }))).toMatchObject({ done: false });
    expect((await w.post(`/api/calendar/events/${t.id}/done`, { done: true, date: "not-a-date" })).status).toBe(400);
  });
  it("ticks a repeating to-do off one day at a time", async () => {
    const w = await who("cs-t2");
    const m = await seriesOf(w, { kind: "todo", rrule: "FREQ=DAILY;COUNT=3" });
    await w.post(`/api/calendar/events/${m.id}@2026-10-06/done`, { done: true });
    await w.post(`/api/calendar/events/${m.id}/done`, { done: true, date: "2026-10-07" });
    expect(lines(await range(w, "2026-10-05", "2026-10-07"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-06T09:00 Weekly [2026-10-06] done", "2026-10-07T09:00 Weekly [2026-10-07] done"]);
    await w.post(`/api/calendar/events/${m.id}@2026-10-06/done`, { done: false });
    // The window is drawn a day wider on each side, so the neighbours come with it.
    expect(lines(await range(w, "2026-10-06", "2026-10-06"))).toEqual(["2026-10-05T09:00 Weekly [2026-10-05]", "2026-10-06T09:00 Weekly [2026-10-06]", "2026-10-07T09:00 Weekly [2026-10-07] done"]);
  });
});

describe("duplicating", () => {
  it("makes a plain copy: same times and text, no repeat, no guests, no link to a mail", async () => {
    const w = await who("cs-u1");
    const e = await create(w, { title: "Original", starts_at: MON9, ends_at: MON9 + H, location: "Room 2", emoji: "🎬", reminders: [{ minutes: 10 }], attendees: [{ email: "a@x.test" }], thread_id: "t-1", rrule: "FREQ=DAILY", countdown: true, conference_url: "https://meet.test/x" });
    const copy = await json(await w.post(`/api/calendar/events/${e.id}/duplicate`));
    expect(copy.id).not.toBe(e.id);
    expect(copy).toMatchObject({ title: "Original", starts_at: MON9, ends_at: MON9 + H, location: "Room 2", emoji: "🎬", reminders: [{ minutes: 10 }], attendees: [], thread_id: null, rrule: null, recurring: false, countdown: true, conference_url: "https://meet.test/x" });
  });
  it("copies one occurrence at its own time", async () => {
    const w = await who("cs-u2");
    const m = await seriesOf(w);
    const copy = await json(await w.post(`/api/calendar/events/${m.id}@2026-10-19/duplicate`));
    expect(copy).toMatchObject({ starts_at: T("2026-10-19T09:00:00Z"), ends_at: T("2026-10-19T10:00:00Z"), rrule: null });
  });
  it("copies an all-day occurrence onto its own dates, keeping the span", async () => {
    const w = await who("cs-u3");
    const m = await create(w, { title: "Trip", all_day: true, start_date: "2026-10-05", end_date: "2026-10-07", rrule: "FREQ=WEEKLY;BYDAY=MO" });
    const copy = await json(await w.post(`/api/calendar/events/${m.id}@2026-10-12/duplicate`));
    expect(copy).toMatchObject({ all_day: true, start_date: "2026-10-12", end_date: "2026-10-14" });
  });
});

describe("the .ics export", () => {
  const clean = (ics: string) => ics.replace(/\r\n/g, "\n").replace(/DTSTAMP:\S+/g, "DTSTAMP:<now>").replace(UUID, "<id>");
  it("exports one event with its guests and reminders", async () => {
    const w = await who("cs-i1");
    const e = await create(w, { title: "Studio / review: Q4", starts_at: MON9, ends_at: MON9 + H, location: "Room 2", description: "Bring cables", url: "https://x.test/p", attendees: [{ email: "a@x.test", name: "Alex" }], reminders: [{ minutes: 15 }] });
    const r = await w.get(`/api/calendar/events/${e.id}.ics`);
    expect([r.status, r.headers.get("content-type"), r.headers.get("content-disposition"), r.headers.get("cache-control")]).toEqual([200, "text/calendar; charset=utf-8", 'attachment; filename="Studio-review-Q4.ics"', "no-store"]);
    expect(clean(await r.text())).toMatchSnapshot();
  });
  it("exports a series with its rule, and one occurrence on its own date without it", async () => {
    const w = await who("cs-i2");
    const m = await seriesOf(w);
    const all = clean(await (await w.get(`/api/calendar/events/${m.id}.ics`)).text());
    expect(all).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    const one = clean(await (await w.get(`/api/calendar/events/${m.id}@2026-10-19.ics`)).text());
    expect(one).not.toContain("RRULE");
    expect(one).toContain("DTSTART:20261019T090000Z");
    expect(one).toContain("UID:<id>-2026-10-19@inbox");
  });
  it("exports an all-day event as dates", async () => {
    const w = await who("cs-i3");
    const e = await create(w, { title: "Offsite", all_day: true, start_date: "2026-10-05", end_date: "2026-10-06" });
    expect(clean(await (await w.get(`/api/calendar/events/${e.id}.ics`)).text())).toMatchSnapshot();
  });
});
