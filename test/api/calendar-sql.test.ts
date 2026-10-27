import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, seedAccount, signIn, testEnv, wipeAll } from "../api-harness";
import { resetStatements, sent } from "../support/pgenv";
import { syncCaldavCalendar } from "../../src/api/calendar/caldav";
import { importIcs, refreshIcsCalendar, upsertIcsEvents } from "../../src/api/calendar/sources";
import { parseIcs } from "../../src/api/calendar/ical";
import { rangeFor } from "../../src/api/calendar/store";
import { deleteCalendar } from "../../src/api/calendar/sources";
import { syncGoogleCalendar } from "../../src/api/calendar/google";
import type { AccountRow } from "../../src/api/db";
import type { CalendarRow } from "../../src/api/calendar/types";

/**
 * What the calendar writes when mail or a feed brings events in, and what the calendar page reads. Pinned before the per-event statements were joined: every
 * event of a feed was its own statement, so a refresh of a holiday calendar with a thousand events was a thousand round trips every hour.
 */

vi.mock("../../src/api/imapbox", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  configFor: vi.fn(async () => ({ imap: { host: "dav.example.org", username: "me", password: "pw" }, smtp: {} })),
}));

const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
const H = 3_600_000;
const BASE = Date.UTC(2026, 9, 5, 9, 0, 0);

/** A feed of `n` events, one an hour apart from BASE, the first `recurring` of them weekly. */
const feed = (n: number, o: { title?: (i: number) => string; recurring?: number; skip?: number[] } = {}) => {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN"];
  for (let i = 0; i < n; i++) {
    if (o.skip?.includes(i)) continue;
    const s = new Date(BASE + i * H).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const e = new Date(BASE + i * H + H / 2).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    lines.push("BEGIN:VEVENT", `UID:ev-${i}@feed.test`, `DTSTART:${s}`, `DTEND:${e}`, `SUMMARY:${o.title ? o.title(i) : `Event ${i}`}`, ...(i < (o.recurring ?? 0) ? ["RRULE:FREQ=WEEKLY"] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
};

let n = 0;
async function calendar(source: "ics" | "local", writable = 1): Promise<CalendarRow> {
  const user = `cs${++n}`;
  await signIn(user);
  const id = `cal-${user}`;
  await db()
    .prepare(`INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at) VALUES (?, ?, NULL, ?, NULL, ?, 'Feed', '', '#111111', '', 1, ?, 0, 0, 'idle', 1, 1)`)
    .bind(id, user, source, source === "ics" ? "https://cal.example.org/feed.ics" : null, writable)
    .run();
  return (await q<CalendarRow>(`SELECT * FROM calendars WHERE id = ?`, id))[0];
}

let body = "";
beforeAll(async () => {
  await migrate();
  await wipeAll();
});
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/calendar" } })));
});
afterEach(() => vi.unstubAllGlobals());

const titles = async (cal: CalendarRow) => (await q<{ title: string }>(`SELECT title FROM events WHERE calendar_id = ? ORDER BY starts_at, id`, cal.id)).map((r) => r.title);

describe("a subscribed feed", () => {
  it("adds its events on the first refresh and gives every one a row", async () => {
    const cal = await calendar("ics");
    body = feed(5);
    const r = await refreshIcsCalendar(testEnv, cal);
    expect(r.changed).toBe(5);
    expect(await titles(cal)).toEqual(["Event 0", "Event 1", "Event 2", "Event 3", "Event 4"]);
    const row = (await q<any>(`SELECT * FROM events WHERE calendar_id = ? AND ical_uid = 'ev-2@feed.test'`, cal.id))[0];
    expect(row).toMatchObject({ user_id: cal.user_id, kind: "event", all_day: 0, starts_at: BASE + 2 * H, ends_at: BASE + 2 * H + H / 2, status: "confirmed", rsvp: "" });
  });

  it("changes the ones that changed, keeps their ids and the marks that are inbox's own, adds new ones and removes the ones the feed dropped", async () => {
    const cal = await calendar("ics");
    body = feed(6);
    await refreshIcsCalendar(testEnv, cal);
    const before = Object.fromEntries((await q<{ ical_uid: string; id: string }>(`SELECT ical_uid, id FROM events WHERE calendar_id = ?`, cal.id)).map((r) => [r.ical_uid, r.id]));
    await db().prepare(`UPDATE events SET circled = 1, emoji = 'x' WHERE id = ?`).bind(before["ev-1@feed.test"]).run();
    await db().prepare(`INSERT INTO event_completions (event_id, date, done_at) VALUES (?, '2026-10-05', 1)`).bind(before["ev-4@feed.test"]).run();

    body = feed(8, { title: (i) => (i === 1 ? "Renamed" : `Event ${i}`), skip: [4] });
    const r = await refreshIcsCalendar(testEnv, cal);
    expect(r.changed).toBe(8); // seven the feed lists plus the one it dropped
    const after = await q<{ ical_uid: string; id: string; title: string; circled: number; emoji: string }>(`SELECT ical_uid, id, title, circled, emoji FROM events WHERE calendar_id = ? ORDER BY starts_at`, cal.id);
    expect(after.map((e) => e.ical_uid)).toEqual(["ev-0", "ev-1", "ev-2", "ev-3", "ev-5", "ev-6", "ev-7"].map((u) => `${u}@feed.test`));
    expect(after.find((e) => e.ical_uid === "ev-1@feed.test")).toMatchObject({ id: before["ev-1@feed.test"], title: "Renamed", circled: 1, emoji: "x" });
    expect(after.find((e) => e.ical_uid === "ev-2@feed.test")!.id).toBe(before["ev-2@feed.test"]);
    expect(await q(`SELECT 1 FROM event_completions WHERE event_id = ?`, before["ev-4@feed.test"])).toHaveLength(0);
  });

  it("keeps a recurring series and the moved occurrence of it", async () => {
    const cal = await calendar("ics");
    const text = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT", "UID:series@feed.test", "DTSTART:20261005T090000Z", "DTEND:20261005T100000Z", "SUMMARY:Standup", "RRULE:FREQ=DAILY;COUNT=5", "END:VEVENT",
      "BEGIN:VEVENT", "UID:series@feed.test", "RECURRENCE-ID:20261006T090000Z", "DTSTART:20261006T130000Z", "DTEND:20261006T140000Z", "SUMMARY:Standup (late)", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    body = text;
    await refreshIcsCalendar(testEnv, cal);
    const rows = await q<{ title: string; rrule: string | null; master_id: string | null; occurrence_date: string | null; id: string }>(`SELECT id, title, rrule, master_id, occurrence_date FROM events WHERE calendar_id = ? ORDER BY title`, cal.id);
    const master = rows.find((r) => r.rrule)!;
    const moved = rows.find((r) => r.master_id)!;
    expect(master.title).toBe("Standup");
    expect(moved).toMatchObject({ title: "Standup (late)", master_id: master.id, occurrence_date: "2026-10-06" });
    body = text;
    await refreshIcsCalendar(testEnv, cal);
    expect((await q<{ id: string }>(`SELECT id FROM events WHERE calendar_id = ? AND rrule IS NOT NULL`, cal.id))[0].id).toBe(master.id);
  });

  it("is a few statements, however many events it has", async () => {
    const cal = await calendar("ics");
    body = feed(400);
    resetStatements();
    await refreshIcsCalendar(testEnv, cal);
    const first = sent.statements;
    body = feed(400, { title: (i) => `Event ${i} again` });
    resetStatements();
    await refreshIcsCalendar(testEnv, cal);
    const again = sent.statements;
    expect(await q(`SELECT 1 FROM events WHERE calendar_id = ?`, cal.id)).toHaveLength(400);
    expect(first).toBeLessThan(30);
    expect(again).toBeLessThan(30);
  });
});

describe("an uploaded file and an invitation", () => {
  it("an upload becomes ordinary rows in a few statements", async () => {
    const cal = await calendar("local");
    resetStatements();
    const r = await importIcs(testEnv, cal.user_id, cal.id, feed(300));
    expect(r.added).toBe(300);
    expect(sent.statements).toBeLessThan(20);
    const row = (await q<any>(`SELECT remote_id, ical_uid FROM events WHERE calendar_id = ? LIMIT 1`, cal.id))[0];
    expect(row.remote_id).toBeNull();
    expect(row.ical_uid).toMatch(/@feed.test$/);
  });

  it("an invitation adds its event, links it to the message, and a second one for the same meeting updates it", async () => {
    const cal = await calendar("local");
    const first = parseIcs(feed(2)).events;
    await upsertIcsEvents(testEnv, cal, first, { threadId: "th-1", messageId: "msg-1" });
    const rows = await q<{ id: string; thread_id: string; message_id: string; title: string }>(`SELECT id, thread_id, message_id, title FROM events WHERE calendar_id = ? ORDER BY starts_at`, cal.id);
    expect(rows.map((r) => [r.title, r.thread_id, r.message_id])).toEqual([["Event 0", "th-1", "msg-1"], ["Event 1", "th-1", "msg-1"]]);
    const again = parseIcs(feed(2, { title: (i) => `Moved ${i}` })).events;
    await upsertIcsEvents(testEnv, cal, again, { threadId: "th-2", messageId: "msg-2" });
    const after = await q<{ id: string; thread_id: string; title: string }>(`SELECT id, thread_id, title FROM events WHERE calendar_id = ? ORDER BY starts_at`, cal.id);
    expect(after.map((r) => [r.id, r.title, r.thread_id])).toEqual(rows.map((r, i) => [r.id, `Moved ${i}`, "th-2"]));
  });
});

describe("reading and deleting", () => {
  it("the calendar page reads a month in a handful of statements, with the series expanded and a moved occurrence in place", async () => {
    const cal = await calendar("local");
    await importIcs(testEnv, cal.user_id, cal.id, feed(30, { recurring: 3 }));
    resetStatements();
    const r = await rangeFor(testEnv, cal.user_id, "2026-10-05", "2026-10-31");
    expect(r.events.length).toBeGreaterThan(30);
    expect(sent.statements).toBeLessThan(12);
  });

  it("deleting a calendar removes its events and their completions, and nothing of another calendar", async () => {
    const a = await calendar("local");
    const b = await calendar("local");
    await importIcs(testEnv, a.user_id, a.id, feed(3));
    await importIcs(testEnv, b.user_id, b.id, feed(3));
    const ev = (await q<{ id: string }>(`SELECT id FROM events WHERE calendar_id = ?`, a.id))[0].id;
    await db().prepare(`INSERT INTO event_completions (event_id, date, done_at) VALUES (?, '2026-10-05', 1)`).bind(ev).run();
    await deleteCalendar(db(), a.id);
    expect(await q(`SELECT 1 FROM events WHERE calendar_id = ?`, a.id)).toHaveLength(0);
    expect(await q(`SELECT 1 FROM event_completions WHERE event_id = ?`, ev)).toHaveLength(0);
    expect(await q(`SELECT 1 FROM calendars WHERE id = ?`, a.id)).toHaveLength(0);
    expect(await q(`SELECT 1 FROM events WHERE calendar_id = ?`, b.id)).toHaveLength(3);
  });
});

describe("a Google calendar", () => {
  const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
  const g = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    etag: `"e-${id}"`,
    summary: `Meeting ${id}`,
    status: "confirmed",
    start: { dateTime: new Date(BASE + Number(id.replace(/\D/g, "")) * H).toISOString() },
    end: { dateTime: new Date(BASE + Number(id.replace(/\D/g, "")) * H + H / 2).toISOString() },
    ...over,
  });
  async function google() {
    const user = `cg${++n}`;
    await signIn(user);
    await seedAccount(`acc-${user}`, `${user}@gmail.test`, { user, provider: "gmail" });
    await db()
      .prepare(`UPDATE accounts SET access_token = 'tok', refresh_token = 'rtok', token_expires_at = ?, scopes = ? WHERE id = ?`)
      .bind(Date.now() + 3_600_000, CAL_SCOPE, `acc-${user}`)
      .run();
    const id = `cal-${user}`;
    await db()
      .prepare(`INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at) VALUES (?, ?, ?, 'google', 'primary', NULL, 'Gmail', '', '#4285f4', '', 1, 1, 1, 0, 'idle', 1, 1)`)
      .bind(id, user, `acc-${user}`)
      .run();
    const account = (await q<AccountRow>(`SELECT * FROM accounts WHERE id = ?`, `acc-${user}`))[0];
    const cal = async () => (await q<CalendarRow>(`SELECT * FROM calendars WHERE id = ?`, id))[0];
    return { user, id, account, cal };
  }
  const pageOf = (items: unknown[], token = "tok-1") => vi.fn(async () => new Response(JSON.stringify({ items, nextSyncToken: token }), { status: 200, headers: { "content-type": "application/json" } }));

  it("stores what Google lists in a few statements, and leaves an unchanged one alone on the next pull", async () => {
    const c = await google();
    vi.stubGlobal("fetch", pageOf(Array.from({ length: 200 }, (_, i) => g(`ev${i}`))));
    resetStatements();
    const r = await syncGoogleCalendar(testEnv, await c.cal(), c.account, { allowFull: true });
    expect(r.changed).toBe(200);
    expect(sent.statements).toBeLessThan(25);
    const rows = await q<any>(`SELECT * FROM events WHERE calendar_id = ? ORDER BY starts_at`, c.id);
    expect(rows).toHaveLength(200);
    expect(rows[3]).toMatchObject({ remote_id: "ev3", title: "Meeting ev3", etag: '"e-ev3"', user_id: c.user, kind: "event", all_day: 0, starts_at: BASE + 3 * H, rsvp: "" });

    const before = (await q<{ id: string; updated_at: number }>(`SELECT id, updated_at FROM events WHERE calendar_id = ? ORDER BY id`, c.id));
    vi.stubGlobal("fetch", pageOf(Array.from({ length: 200 }, (_, i) => g(`ev${i}`))));
    const again = await syncGoogleCalendar(testEnv, await c.cal(), c.account, { allowFull: true });
    expect(again.changed).toBe(0);
    expect(await q(`SELECT id, updated_at FROM events WHERE calendar_id = ? ORDER BY id`, c.id)).toEqual(before);
  });

  it("a poll applies a change, a new instance and a cancellation, and keeps the ids and the marks of inbox", async () => {
    const c = await google();
    vi.stubGlobal("fetch", pageOf([g("ev1"), g("ev2"), g("ev3")]));
    await syncGoogleCalendar(testEnv, await c.cal(), c.account, { allowFull: true });
    const ids = Object.fromEntries((await q<{ id: string; remote_id: string }>(`SELECT id, remote_id FROM events WHERE calendar_id = ?`, c.id)).map((r) => [r.remote_id, r.id]));
    await db().prepare(`UPDATE events SET circled = 1 WHERE id = ?`).bind(ids.ev1).run();

    vi.stubGlobal("fetch", pageOf([g("ev1", { etag: '"new"', summary: "Moved" }), g("ev2", { status: "cancelled" }), g("ev4"), g("ev9", { status: "cancelled" })], "tok-2"));
    const r = await syncGoogleCalendar(testEnv, await c.cal(), c.account);
    expect(r).toMatchObject({ changed: 2, deleted: 1 });
    const rows = await q<{ remote_id: string; id: string; title: string; circled: number }>(`SELECT remote_id, id, title, circled FROM events WHERE calendar_id = ? ORDER BY remote_id`, c.id);
    expect(rows.map((x) => x.remote_id)).toEqual(["ev1", "ev3", "ev4"]);
    expect(rows[0]).toMatchObject({ id: ids.ev1, title: "Moved", circled: 1 });
  });
});

describe("a calendar on the mail server (CalDAV)", () => {
  const xml = (hrefs: Record<string, string>) =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${Object.entries(hrefs)
      .map(([href, ics]) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop></d:propstat></d:response>`)
      .join("")}</d:multistatus>`;
  const one = (uid: string, title: string, at: number) =>
    ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`, `DTEND:${new Date(at + H).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`, `SUMMARY:${title}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const server = (resources: Record<string, string>) =>
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PROPFIND") return new Response(`<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:response><d:propstat><d:prop><cs:getctag>ctag-${Object.keys(resources).length}-${Object.values(resources).join("").length}</cs:getctag></d:prop></d:propstat></d:response></d:multistatus>`, { status: 207 });
      return new Response(xml(resources), { status: 207 });
    });

  it("brings the server's events in with their addresses, keeps what the server still lists, and removes what it dropped", async () => {
    const user = `cd${++n}`;
    await signIn(user);
    await seedAccount(`acc-${user}`, `${user}@mail.test`, { user });
    const id = `cal-${user}`;
    await db()
      .prepare(`INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at) VALUES (?, ?, ?, 'caldav', 'r', 'https://dav.example.org/cal/me/', 'Mail', '', '#111111', '', 1, 1, 1, 0, 'idle', 1, 1)`)
      .bind(id, user, `acc-${user}`)
      .run();
    const cal = async () => (await q<CalendarRow>(`SELECT * FROM calendars WHERE id = ?`, id))[0];
    const res: Record<string, string> = {};
    for (let i = 0; i < 120; i++) res[`/cal/me/e${i}.ics`] = one(`d${i}@dav.test`, `Dav ${i}`, BASE + i * H);

    vi.stubGlobal("fetch", server(res));
    resetStatements();
    const r = await syncCaldavCalendar(testEnv, await cal());
    expect(r.changed).toBe(120);
    expect(sent.statements).toBeLessThan(25);
    const rows = await q<{ ical_uid: string; href: string; id: string; pushed_at: number; updated_at: number }>(`SELECT ical_uid, href, id, pushed_at, updated_at FROM events WHERE calendar_id = ? ORDER BY starts_at`, id);
    expect(rows).toHaveLength(120);
    expect(rows[7]).toMatchObject({ ical_uid: "d7@dav.test", href: "/cal/me/e7.ics" });
    expect(rows[7].pushed_at).toBeGreaterThan(rows[7].updated_at);
    const ids = Object.fromEntries(rows.map((x) => [x.ical_uid, x.id]));

    delete res["/cal/me/e5.ics"];
    res["/cal/me/e6.ics"] = one("d6@dav.test", "Dav six renamed", BASE + 6 * H);
    res["/cal/me/new.ics"] = one("new@dav.test", "Fresh", BASE + 500 * H);
    vi.stubGlobal("fetch", server(res));
    await syncCaldavCalendar(testEnv, await cal());
    const after = await q<{ ical_uid: string; id: string; title: string; href: string }>(`SELECT ical_uid, id, title, href FROM events WHERE calendar_id = ?`, id);
    expect(after).toHaveLength(120);
    expect(after.find((x) => x.ical_uid === "d5@dav.test")).toBeUndefined();
    expect(after.find((x) => x.ical_uid === "d6@dav.test")).toMatchObject({ id: ids["d6@dav.test"], title: "Dav six renamed" });
    expect(after.find((x) => x.ical_uid === "new@dav.test")).toMatchObject({ title: "Fresh", href: "/cal/me/new.ics" });
  });
});
