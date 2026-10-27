import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, seedThread, testEnv } from "../api-harness";
import { seedWorld, type World } from "../api-world";
import { capTerms, MAX_SEARCH_TERMS, MAX_EXCLUDED_TERMS, MAX_QUERY, PAGE } from "../../src/api/routes/mail";

let w: World;
const as = (method: string, path: string, body?: unknown) => call(method, path, { token: w.token, ...(body === undefined ? {} : { body }) });
const act = (id: string, body: Record<string, unknown>) => as("POST", `/api/threads/${id}/actions`, body);
const row = async (id: string) => (await testEnv.DB.prepare(`SELECT * FROM threads WHERE id = ?`).bind(id).first<Record<string, unknown>>())!;

beforeEach(async () => {
  w = await seedWorld("ua");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Imbox", () => {
  it("shows new mail, counts it, and moves it out of new once opened", async () => {
    expect((await json(await as("GET", "/api/counts"))).imbox_new).toBe(1);
    expect((await json(await as("GET", "/api/imbox"))).new_threads.map((t: { id: string }) => t.id)).toEqual([w.thread]);
    expect((await as("GET", `/api/threads/${w.thread}`)).status).toBe(200);
    expect((await json(await as("GET", "/api/counts"))).imbox_new).toBe(0);
  });

  it("lists threads by place, and pages them", async () => {
    await seedThread(w.imap, { subject: "A feed", bucket: "feed" });
    await seedThread(w.imap, { subject: "Gone", bucket: "trash" });
    expect((await json(await as("GET", "/api/threads?bucket=feed"))).threads.map((t: { subject: string }) => t.subject)).toEqual(["A feed"]);
    expect(JSON.stringify(await json(await as("GET", "/api/threads")))).not.toContain("Gone");
    for (let i = 0; i < 60; i++) await seedThread(w.imap, { subject: `Bulk ${i}` });
    const page0 = await json(await as("GET", "/api/threads?bucket=imbox"));
    expect(page0.threads).toHaveLength(50);
    expect(page0.next_page).toBe(1);
  });
});

describe("what you can do with a thread", () => {
  it("marks it unread and read", async () => {
    await act(w.thread, { action: "mark_read" });
    expect((await row(w.thread)).unread).toBe(0);
    await act(w.thread, { action: "mark_unread" });
    expect((await row(w.thread)).unread).toBe(1);
  });

  it("moves it to another place, and to the trash", async () => {
    await act(w.thread, { action: "move", bucket: "feed" });
    expect((await row(w.thread)).bucket).toBe("feed");
    await act(w.thread, { action: "move", bucket: "trash" });
    expect((await row(w.thread)).bucket).toBe("trash");
  });

  it("sets it aside and brings it back, and keeps a note", async () => {
    await act(w.thread, { action: "set_aside", on: true });
    expect((await row(w.thread)).set_aside).toBe(1);
    await act(w.thread, { action: "set_aside", on: false });
    expect((await row(w.thread)).set_aside).toBe(0);
    await act(w.thread, { action: "note", note: "call back" });
    expect((await row(w.thread)).note).toBe("call back");
  });

  it("refuses an action it does not know", async () => {
    expect((await act(w.thread, { action: "explode" })).status).toBeGreaterThanOrEqual(400);
  });
});

describe("the Screener", () => {
  it("letting a sender in moves their threads to the Imbox; screening out moves them away", async () => {
    const t = await seedThread(w.imap, { subject: "Cold email", bucket: "screener", from: "stranger@example.net" });
    await testEnv.DB.prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, message_count, notes) VALUES ('cs1', ?, 'stranger@example.net', 'S', 'pending', 1, 1, 1, '')`).bind(w.imap).run();
    expect((await as("POST", "/api/screener/decide", { contact_id: "cs1", decision: "imbox" })).status).toBeLessThan(400);
    expect((await row(t.thread)).bucket).toBe("imbox");
    expect((await as("POST", "/api/screener/decide", { contact_id: "cs1", decision: "screened_out" })).status).toBeLessThan(400);
    expect((await row(t.thread)).bucket).toBe("screened_out");
  });
});

describe("search term caps and query limits", () => {
  it("caps terms to 6 and excluded to 4", () => {
    expect(MAX_SEARCH_TERMS).toBe(6);
    expect(MAX_EXCLUDED_TERMS).toBe(4);
    expect(MAX_QUERY).toBe(300);
    expect(PAGE).toBe(50);

    const capped = capTerms({
      terms: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
      excluded: ["not1", "not2", "not3", "not4", "not5"],
      from: "alice@example.com",
      to: "bob@example.com",
      bucket: "",
      unread: null,
      hasAttachment: false,
      filename: "invoice.pdf",
      mailbox: "inbox",
      before: null,
      after: null,
    });
    expect(capped.terms).toHaveLength(6);
    expect(capped.terms).toEqual(["one", "two", "three", "four", "five", "six"]);
    expect(capped.excluded).toHaveLength(4);
    expect(capped.excluded).toEqual(["not1", "not2", "not3", "not4"]);
  });
});

describe("the bubble-up filter in VISIBLE", () => {
  it("hides threads whose bubble_up_at is in the future from normal views", async () => {
    const future = Date.now() + 3_600_000;
    const t = await seedThread(w.imap, { subject: "Future reminder", bucket: "imbox" });
    await testEnv.DB.prepare(`UPDATE threads SET bubble_up_at = ? WHERE id = ?`).bind(future, t.thread).run();

    const imbox = await json(await as("GET", "/api/imbox"));
    const ids = imbox.new_threads.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(t.thread);

    const bubbled = await json(await as("GET", "/api/threads?bucket=bubble_up"));
    expect(bubbled.threads.map((x: { id: string }) => x.id)).toContain(t.thread);
  });
});

describe("route precedence in Hono", () => {
  it("routes /threads/bulk to the bulk handler, not :id = bulk", async () => {
    const res = await as("POST", "/api/threads/bulk", { thread_ids: [w.thread], action: "mark_read" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
  });

  it("routes /threads/empty-trash to the empty-trash handler, not :id = empty-trash", async () => {
    const res = await as("POST", "/api/threads/empty-trash");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(typeof body.deleted).toBe("number");
  });
});
