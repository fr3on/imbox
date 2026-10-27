import { beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, seedAccount, signIn, testEnv } from "../api-harness";

// What the calendar's data layer does about Google (src/api/calendar/store.ts): a write on a Google calendar is mirrored there; a refusal puts an edit back and
// says why; a failed mirror never loses a create; a series Google already expanded is deleted as a whole or from one occurrence on. Google itself is a
// stand-in here. Written before the file was split into modules.

const remote = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  rsvp: vi.fn(),
}));
vi.mock("../../src/api/calendar/google", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createRemoteEvent: remote.create,
  updateRemoteEvent: remote.update,
  deleteRemoteEvent: remote.del,
  setRemoteRsvp: remote.rsvp,
}));

const db = () => testEnv.DB;
const T = (d: string) => Date.parse(d);
const H = 3_600_000;
const MON9 = T("2026-10-05T09:00:00Z");

beforeEach(() => {
  remote.create.mockReset().mockResolvedValue({ remote_id: "g-new", etag: "etag-1" });
  remote.update.mockReset().mockResolvedValue({ etag: "etag-2" });
  remote.del.mockReset().mockResolvedValue(undefined);
  remote.rsvp.mockReset().mockResolvedValue(undefined);
});

let n = 0;
async function google(opts: { writable?: boolean } = {}) {
  const user = `cg${++n}`;
  const token = await signIn(user);
  const acc = `acc-${user}`;
  await seedAccount(acc, `${user}@gmail.test`, { user, provider: "gmail" });
  const cal = crypto.randomUUID();
  await db()
    .prepare(`INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at) VALUES (?, ?, ?, 'google', 'primary', NULL, 'Gmail calendar', '', '#4285f4', '', 1, ?, 1, 0, 'idle', 1, 1)`)
    .bind(cal, user, acc, opts.writable === false ? 0 : 1)
    .run();
  const as = (method: string) => (path: string, body?: unknown) => call(method, path, { token, body: body ?? {} });
  return { user, acc, cal, token, get: (p: string) => call("GET", p, { token }), post: as("POST"), patch: as("PATCH"), del: (p: string) => call("DELETE", p, { token }) };
}
type G = Awaited<ReturnType<typeof google>>;

/** A row as Google's sync would have left it, which is what a mirrored edit meets. */
async function row(g: G, o: { id?: string; title?: string; starts_at?: number; remote_id?: string | null; ical_uid?: string | null; rrule?: string | null }): Promise<string> {
  const id = o.id ?? crypto.randomUUID();
  const s = o.starts_at ?? MON9;
  await db()
    .prepare(`INSERT INTO events (id, user_id, calendar_id, remote_id, ical_uid, kind, title, description, location, emoji, all_day, starts_at, ends_at, start_date, end_date, timezone, rrule, exdates, master_id, occurrence_date, status, busy, countdown, circled, organizer_email, organizer_name, attendees_json, rsvp, conference_url, url, reminders_json, thread_id, message_id, done_at, etag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'event', ?, '', '', '', 0, ?, ?, NULL, NULL, 'UTC', ?, '', NULL, NULL, 'confirmed', 1, 0, 0, '', '', '[]', '', '', '', '[]', NULL, NULL, NULL, NULL, 1, 1)`)
    .bind(id, g.user, g.cal, o.remote_id ?? null, o.ical_uid ?? null, o.title ?? "Event", s, s + H, o.rrule ?? null)
    .run();
  return id;
}
const ids = async (g: G) => ((await db().prepare(`SELECT title FROM events WHERE user_id = ? ORDER BY starts_at`).bind(g.user).all()).results as { title: string }[]).map((r) => r.title);
const logs = async (g: G) => ((await db().prepare(`SELECT level, message FROM sync_log WHERE account_id = ? ORDER BY id`).bind(g.acc).all()).results as { level: string; message: string }[]).map((r) => `${r.level}: ${r.message}`);

describe("creating on a Google calendar", () => {
  it("sends it to Google and keeps the id and tag Google answers with", async () => {
    const g = await google();
    const e = await json(await g.post("/api/calendar/events", { calendar_id: g.cal, title: "Dinner", starts_at: MON9 }));
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect(remote.create.mock.calls[0][3]).toMatchObject({ title: "Dinner", starts_at: MON9 });
    expect(e).toMatchObject({ title: "Dinner", source: "google", writable: true });
    expect(await db().prepare(`SELECT remote_id, etag FROM events WHERE id = ?`).bind(e.id).first()).toEqual({ remote_id: "g-new", etag: "etag-1" });
  });
  it("keeps the event, and writes down what went wrong, when Google cannot be reached", async () => {
    const g = await google();
    remote.create.mockRejectedValue(new Error("network down"));
    const r = await g.post("/api/calendar/events", { calendar_id: g.cal, title: "Offline", starts_at: MON9 });
    expect(r.status).toBe(200);
    expect(await ids(g)).toEqual(["Offline"]);
    expect(await db().prepare(`SELECT remote_id FROM events WHERE user_id = ?`).bind(g.user).first()).toEqual({ remote_id: null });
    expect(await logs(g)).toEqual(["error: calendar create (Gmail calendar): network down"]);
  });
  it("is refused on a Google calendar that cannot be written to, and never reaches Google", async () => {
    const g = await google({ writable: false });
    const r = await g.post("/api/calendar/events", { calendar_id: g.cal, title: "No", starts_at: MON9 });
    expect([r.status, (await json(r)).error]).toEqual([403, "read_only"]);
    expect(remote.create).not.toHaveBeenCalled();
  });
});

describe("editing on a Google calendar", () => {
  it("sends the change and keeps Google's new tag", async () => {
    const g = await google();
    const id = await row(g, { title: "Before", remote_id: "g-1" });
    const e = await json(await g.patch(`/api/calendar/events/${id}`, { title: "After" }));
    expect(e.title).toBe("After");
    expect(remote.update).toHaveBeenCalledTimes(1);
    expect(remote.update.mock.calls[0][3]).toMatchObject({ id, title: "After", remote_id: "g-1" });
    expect(await db().prepare(`SELECT title, etag FROM events WHERE id = ?`).bind(id).first()).toEqual({ title: "After", etag: "etag-2" });
  });
  const refusals: [string, string, string][] = [
    ["a kind of event it will not move", '400 {"error":{"errors":[{"reason":"eventTypeRestriction","message":"Event type cannot be changed"}]}}', "Google won't move this kind of event — birthdays, holidays and working-location entries are fixed where they are."],
    ["a calendar it will not let you write to", '403 {"error":{"errors":[{"reason":"forbiddenForServiceAccounts"}]}}', "That calendar is read-only, so the change couldn't be saved to Google."],
    ["a change it explains", '400 {"error":{"errors":[{"reason":"invalid","message":"The specified time range is empty."}]}}', "Google wouldn't accept this change: The specified time range is empty."],
    ["something it does not explain", "socket hang up", "Couldn't save this change to Google, so it has been put back."],
  ];
  for (const [what, raised, said] of refusals) {
    it(`puts the edit back and says why, when Google refuses ${what}`, async () => {
      const g = await google();
      const id = await row(g, { title: "Keep me", remote_id: "g-1" });
      remote.update.mockRejectedValue(new Error(raised));
      const r = await g.patch(`/api/calendar/events/${id}`, { title: "Changed" });
      expect([r.status, (await json(r)).message]).toEqual([502, said]);
      expect(await ids(g)).toEqual(["Keep me"]);
      expect((await logs(g))[0]).toMatch(/^error: calendar update \(Gmail calendar\): /);
    });
  }
  it("sends an answer to Google too", async () => {
    const g = await google();
    const id = await row(g, { remote_id: "g-1" });
    const e = await json(await g.post(`/api/calendar/events/${id}/rsvp`, { rsvp: "accepted" }));
    expect(e.rsvp).toBe("accepted");
    expect(remote.rsvp).toHaveBeenCalledTimes(1);
    expect(remote.rsvp.mock.calls[0].slice(3)).toEqual(["g-1", "accepted"]);
  });
});

describe("deleting on a Google calendar", () => {
  it("tells Google, when the event has an id there, and does not when it has none", async () => {
    const g = await google();
    const onGoogle = await row(g, { title: "On Google", remote_id: "g-1", starts_at: MON9 });
    const local = await row(g, { title: "Only here", starts_at: MON9 + H });
    await g.del(`/api/calendar/events/${onGoogle}`);
    await g.del(`/api/calendar/events/${local}`);
    expect(remote.del.mock.calls.map((c) => c[3])).toEqual(["g-1"]);
    expect(await ids(g)).toEqual([]);
  });
  it("a failure to tell Google does not bring the event back, and is written down", async () => {
    const g = await google();
    const id = await row(g, { remote_id: "g-1" });
    remote.del.mockRejectedValue(new Error("boom"));
    expect((await g.del(`/api/calendar/events/${id}`)).status).toBe(200);
    expect(await ids(g)).toEqual([]);
    expect(await logs(g)).toEqual(["error: calendar delete (Gmail calendar): boom"]);
  });
});

describe("a series Google already expanded", () => {
  async function weekly(g: G) {
    const out: string[] = [];
    for (let i = 0; i < 4; i++) {
      out.push(await row(g, { title: `Week ${i + 1}`, starts_at: MON9 + i * 7 * 24 * H, remote_id: `abc_${["20261005", "20261012", "20261019", "20261026"][i]}T090000Z`, ical_uid: "abc@google.com" }));
    }
    await row(g, { title: "Other thing", starts_at: MON9 + 2 * H, remote_id: "zzz", ical_uid: "zzz@google.com" });
    return out;
  }
  it("is drawn as repeating, with no rule of its own", async () => {
    const g = await google();
    const [first] = await weekly(g);
    const e = (await json(await g.get("/api/calendar/events?from=2026-10-05&to=2026-10-05"))).events.find((x: { id: string }) => x.id === first);
    expect(e).toMatchObject({ recurring: true, series: true, rrule: null });
  });
  it("all events removes every occurrence with one call to Google, and nothing else", async () => {
    const g = await google();
    const [, second] = await weekly(g);
    await g.del(`/api/calendar/events/${second}?scope=all`);
    expect(await ids(g)).toEqual(["Other thing"]);
    expect(remote.del.mock.calls.map((c) => c[3])).toEqual(["abc"]);
  });
  it("this and following removes this occurrence and the later ones, cancelling each at Google", async () => {
    const g = await google();
    const [, second] = await weekly(g);
    await g.del(`/api/calendar/events/${second}?scope=following`);
    expect(await ids(g)).toEqual(["Week 1", "Other thing"]);
    expect(remote.del.mock.calls.map((c) => c[3])).toEqual(["abc_20261012T090000Z", "abc_20261019T090000Z", "abc_20261026T090000Z"]);
  });
  it("this event removes only that occurrence", async () => {
    const g = await google();
    const [, second] = await weekly(g);
    await g.del(`/api/calendar/events/${second}?scope=this`);
    expect(await ids(g)).toEqual(["Week 1", "Other thing", "Week 3", "Week 4"]);
    expect(remote.del.mock.calls.map((c) => c[3])).toEqual(["abc_20261012T090000Z"]);
  });
  it("finds the siblings by the id prefix when a row has no uid", async () => {
    const g = await google();
    for (let i = 0; i < 3; i++) await row(g, { title: `Loose ${i + 1}`, starts_at: MON9 + i * 7 * 24 * H, remote_id: `loose_2026${["1005", "1012", "1019"][i]}T090000Z`, ical_uid: null });
    const first = ((await db().prepare(`SELECT id FROM events WHERE user_id = ? AND title = 'Loose 1'`).bind(g.user).first()) as { id: string }).id;
    await g.del(`/api/calendar/events/${first}?scope=all`);
    expect(await ids(g)).toEqual([]);
    expect(remote.del.mock.calls.map((c) => c[3])).toEqual(["loose"]);
  });
});
