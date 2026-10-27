import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, } from "../api-harness";
import { seedWorld, type World } from "../api-world";
import {
  BAD_REQUEST,
  fail,
  HEX,
  int,
  MAX_SPAN_DAYS,
  ms,
  readEventInput,
  scopeFor,
  str,
  trimmed,
} from "../../src/api/routes/calendar";
import type { Context } from "hono";
import type { AppEnv } from "../../src/api/env";

describe("calendar input helpers and validation", () => {
  it("str and trimmed enforce length limits and trim whitespace", () => {
    expect(str("hello world", 5)).toBe("hello");
    expect(str(123, 5)).toBe("");
    expect(str(null, 5)).toBe("");
    expect(trimmed("   spaces   ", 4)).toBe("spac");
    expect(trimmed(undefined, 10)).toBe("");
  });

  it("int clamps finite numbers and falls back for invalid inputs", () => {
    expect(int(5, 0, 10, 0)).toBe(5);
    expect(int(-5, 0, 10, 0)).toBe(0);
    expect(int(15, 0, 10, 0)).toBe(10);
    expect(int(NaN, 0, 10, 3)).toBe(3);
    expect(int("5", 0, 10, 3)).toBe(3);
    expect(int(Infinity, 0, 10, 3)).toBe(3);
  });

  it("ms parses finite numbers and rounds them, rejecting invalid inputs", () => {
    expect(ms(12345.67)).toBe(12346);
    expect(ms(NaN)).toBeNull();
    expect(ms(Infinity)).toBeNull();
    expect(ms("12345")).toBeNull();
    expect(ms(null)).toBeNull();
  });

  it("HEX validates standard 6-digit hex color format", () => {
    expect(HEX.test("#112233")).toBe(true);
    expect(HEX.test("#abcdef")).toBe(true);
    expect(HEX.test("#ABCDEF")).toBe(true);
    expect(HEX.test("#123")).toBe(false);
    expect(HEX.test("112233")).toBe(false);
    expect(HEX.test("#11223344")).toBe(false);
    expect(HEX.test("#gggggg")).toBe(false);
  });

  it("MAX_SPAN_DAYS is 400", () => {
    expect(MAX_SPAN_DAYS).toBe(400);
  });

  it("readEventInput sanitizes and enforces schema on all event fields", () => {
    const raw = {
      calendar_id: "cal-123456",
      kind: "birthday",
      title: "  Birthday Party  ",
      description: "A".repeat(60_000),
      location: "Room 101",
      emoji: "🎂party",
      all_day: true,
      starts_at: 1000.4,
      ends_at: 2000.9,
      start_date: "2026-10-05",
      end_date: "2026-10-06",
      timezone: "America/New_York",
      rrule: "FREQ=YEARLY",
      status: "confirmed",
      busy: false,
      countdown: true,
      circled: true,
      attendees: [
        { email: "  alice@example.com  ", name: " Alice ", optional: true },
        { email: "bob@example.com" },
        { email: 123 as any },
        { name: "no-email" } as any,
      ],
      conference_url: "  https://meet.google.com/xyz  ",
      url: "  https://example.com/info  ",
      reminders: [{ minutes: -10 }, { minutes: 50_000 }, { minutes: 15 }, { minutes: "bad" } as any],
      thread_id: "t-1",
      message_id: "m-1",
    };

    const parsed = readEventInput(raw);
    expect(parsed.calendar_id).toBe("cal-123456");
    expect(parsed.kind).toBe("birthday");
    expect(parsed.title).toBe("Birthday Party");
    expect(parsed.description?.length).toBe(50_000);
    expect(parsed.location).toBe("Room 101");
    expect(parsed.emoji).toBe("🎂party");
    expect(parsed.all_day).toBe(true);
    expect(parsed.starts_at).toBe(1000);
    expect(parsed.ends_at).toBe(2001);
    expect(parsed.start_date).toBe("2026-10-05");
    expect(parsed.end_date).toBe("2026-10-06");
    expect(parsed.timezone).toBe("America/New_York");
    expect(parsed.rrule).toBe("FREQ=YEARLY");
    expect(parsed.status).toBe("confirmed");
    expect(parsed.busy).toBe(false);
    expect(parsed.countdown).toBe(true);
    expect(parsed.circled).toBe(true);
    expect(parsed.attendees).toEqual([
      { email: "alice@example.com", name: "Alice", optional: true },
      { email: "bob@example.com", name: undefined, optional: undefined },
    ]);
    expect(parsed.conference_url).toBe("https://meet.google.com/xyz");
    expect(parsed.url).toBe("https://example.com/info");
    expect(parsed.reminders).toEqual([{ minutes: 0 }, { minutes: 40320 }, { minutes: 15 }]);
    expect(parsed.thread_id).toBe("t-1");
    expect(parsed.message_id).toBe("m-1");
  });

  it("readEventInput rejects invalid kinds, statuses, dates, and nulls where allowed", () => {
    const parsed = readEventInput({
      kind: "invalid-kind" as any,
      status: "invalid-status" as any,
      start_date: "invalid-date",
      end_date: "bad-date",
      rrule: null,
      thread_id: null,
      message_id: null,
    });
    expect(parsed.kind).toBeUndefined();
    expect(parsed.status).toBeUndefined();
    expect(parsed.start_date).toBeUndefined();
    expect(parsed.end_date).toBeUndefined();
    expect(parsed.rrule).toBeNull();
    expect(parsed.thread_id).toBeNull();
    expect(parsed.message_id).toBeNull();
  });
});

describe("scopeFor", () => {
  const fakeCtx = (scopeParam?: string) =>
    ({
      req: {
        query: (k: string) => (k === "scope" ? scopeParam : undefined),
      },
    }) as unknown as Context<AppEnv>;

  it("returns explicit scope query parameter when valid", () => {
    expect(scopeFor(fakeCtx("this"), null)).toBe("this");
    expect(scopeFor(fakeCtx("following"), null)).toBe("following");
    expect(scopeFor(fakeCtx("all"), null)).toBe("all");
    expect(scopeFor(fakeCtx("following"), "2026-10-05")).toBe("following");
  });

  it("defaults to 'this' for occurrences and 'all' for masters when no scope query given", () => {
    expect(scopeFor(fakeCtx(), "2026-10-05")).toBe("this");
    expect(scopeFor(fakeCtx(), null)).toBe("all");
    expect(scopeFor(fakeCtx("invalid"), "2026-10-05")).toBe("this");
    expect(scopeFor(fakeCtx("invalid"), null)).toBe("all");
  });
});

describe("fail error mapping", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fakeCtx = () => {
    let status = 200;
    let body: any = null;
    return {
      c: {
        json: (b: any, s = 200) => {
          status = s;
          body = b;
          return { status, body } as unknown as Response;
        },
      } as unknown as Context<AppEnv>,
      getResult: () => ({ status, body }),
    };
  };

  it("maps read_only to 403", () => {
    const { c, getResult } = fakeCtx();
    fail(c, new Error("read_only"));
    expect(getResult()).toEqual({ status: 403, body: { error: "read_only" } });
  });

  it("maps not_found to 404", () => {
    const { c, getResult } = fakeCtx();
    fail(c, new Error("not_found"));
    expect(getResult()).toEqual({ status: 404, body: { error: "not_found" } });
  });

  it("maps BAD_REQUEST errors to 400", () => {
    for (const code of BAD_REQUEST) {
      const { c, getResult } = fakeCtx();
      fail(c, new Error(code));
      expect(getResult()).toEqual({ status: 400, body: { error: code } });
    }
  });

  it("maps internal/SQL errors to 500 hiding internal details", () => {
    const { c, getResult } = fakeCtx();
    fail(c, new Error("D1_ERROR: syntax error at or near 'SELECT'"));
    expect(getResult()).toEqual({
      status: 500,
      body: { error: "calendar_failed", message: "The calendar could not be updated." },
    });
  });

  it("maps external API errors to 502 passing through the message", () => {
    const { c, getResult } = fakeCtx();
    fail(c, new Error("Google Calendar API quota exceeded"));
    expect(getResult()).toEqual({
      status: 502,
      body: { error: "calendar_failed", message: "Google Calendar API quota exceeded" },
    });
  });
});

describe("calendar HTTP routes integration", () => {
  let w: World;
  const as = (method: string, path: string, body?: unknown) =>
    call(method, path, { token: w.token, ...(body === undefined ? {} : { body }) });

  beforeEach(async () => {
    w = await seedWorld("cal");
  });

  it("validates sources creation and updates", async () => {
    // Missing name
    const badName = await as("POST", "/api/calendar/sources", { name: "", color: "#112233" });
    expect([badName.status, (await json(badName)).error]).toEqual([400, "name_required"]);

    // Bad color
    const badColor = await as("POST", "/api/calendar/sources", { name: "Test", color: "invalid" });
    expect([badColor.status, (await json(badColor)).error]).toEqual([400, "bad_color"]);

    // Success
    const ok = await as("POST", "/api/calendar/sources", { name: "Project", color: "#336699", description: "Desc" });
    expect(ok.status).toBe(200);
    const created = await json(ok);
    expect(created.name).toBe("Project");
    expect(created.color).toBe("#336699");

    // Patch bad color
    const patchBad = await as("PATCH", `/api/calendar/sources/${created.id}`, { color: "bad" });
    expect([patchBad.status, (await json(patchBad)).error]).toEqual([400, "bad_color"]);

    // Patch success
    const patchOk = await as("PATCH", `/api/calendar/sources/${created.id}`, { name: "Updated Name", visible: false });
    expect(patchOk.status).toBe(200);
    const patched = await json(patchOk);
    expect(patched.name).toBe("Updated Name");
    expect(patched.visible).toBe(false);

    // Delete calendar
    const del = await as("DELETE", `/api/calendar/sources/${created.id}`);
    expect(del.status).toBe(200);
    expect((await json(del)).ok).toBe(true);
  });

  it("validates subscribe and import sources endpoints", async () => {
    const badUrl = await as("POST", "/api/calendar/sources/subscribe", { url: "ftp://example.com/feed.ics" });
    expect([badUrl.status, (await json(badUrl)).error]).toEqual([400, "bad_url"]);

    const badImport = await as("POST", "/api/calendar/sources/import", { ics: "   " });
    expect([badImport.status, (await json(badImport)).error]).toEqual([400, "empty_body"]);
  });

  it("handles days and day covers", async () => {
    // Invalid date
    const badDate = await as("GET", "/api/calendar/days/not-a-date");
    expect([badDate.status, (await json(badDate)).error]).toEqual([400, "bad_date"]);

    // Get clean day
    const getDay = await as("GET", "/api/calendar/days/2026-10-05");
    expect(getDay.status).toBe(200);
    expect((await json(getDay)).date).toBe("2026-10-05");

    // Upload cover with bad mime
    const badMime = await call("POST", "/api/calendar/covers", {
      token: w.token,
      headers: { "content-type": "text/plain" },
      raw: "not an image",
    });
    expect([badMime.status, (await json(badMime)).error]).toEqual([400, "bad_image_type"]);

    // Upload empty cover
    const emptyCover = await call("POST", "/api/calendar/covers", {
      token: w.token,
      headers: { "content-type": "image/png" },
      raw: "",
    });
    expect([emptyCover.status, (await json(emptyCover)).error]).toEqual([400, "empty_body"]);

    // Upload valid cover
    const coverRes = await call("POST", "/api/calendar/covers", {
      token: w.token,
      headers: { "content-type": "image/png", "x-image-name": "test.png" },
      raw: "png-content-data",
    });
    expect(coverRes.status).toBe(200);
    const cover = await json(coverRes);
    expect(cover.url).toBe(`/api/calendar/covers/${cover.id}`);

    // Fetch cover image
    const fetchCover = await call("GET", `/api/calendar/covers/${cover.id}`, { token: w.token });
    expect(fetchCover.status).toBe(200);
    expect(fetchCover.headers.get("content-type")).toBe("image/png");

    // Update day with cover
    const putDay = await as("PUT", "/api/calendar/days/2026-10-05", {
      label: "Special Day",
      cover_id: cover.id,
      cover_position: "30% 70%",
    });
    expect(putDay.status).toBe(200);
    const dayData = await json(putDay);
    expect(dayData.label).toBe("Special Day");
    expect(dayData.cover_id).toBe(cover.id);
    expect(dayData.cover_position).toBe("30% 70%");

    // Delete cover clears cover from day
    const delCover = await as("DELETE", `/api/calendar/covers/${cover.id}`);
    expect(delCover.status).toBe(200);
    const dayAfter = await json(await as("GET", "/api/calendar/days/2026-10-05"));
    expect(dayAfter.cover_id).toBeNull();
    expect(dayAfter.cover_url).toBe("");
  });

  it("handles events/from-thread prefill", async () => {
    // Missing thread_id
    const badReq = await as("POST", "/api/calendar/events/from-thread", {});
    expect([badReq.status, (await json(badReq)).error]).toEqual([400, "thread_id_required"]);

    // Non-existent thread
    const notFound = await as("POST", "/api/calendar/events/from-thread", { thread_id: "nope-123" });
    expect([notFound.status, (await json(notFound)).error]).toEqual([404, "not_found"]);

    // Existing thread
    const fromThread = await as("POST", "/api/calendar/events/from-thread", { thread_id: w.thread });
    expect(fromThread.status).toBe(200);
    const prefill = await json(fromThread);
    expect(prefill.thread_id).toBe(w.thread);
    expect(prefill.title).toBe("Mail of cal");
    expect(typeof prefill.starts_at).toBe("number");
    expect(typeof prefill.ends_at).toBe("number");
    expect(prefill.ends_at).toBe(prefill.starts_at + 3_600_000);
  });
});
