import "./render";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import * as web from "@/api";

// The web app's API module, pinned before it was split into one file per area: everything it exports, how it builds query keys, how its request
// function treats answers and errors, and how the thread caches are patched. Imports elsewhere say `from "../api"`, so this is the module's contract.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("what the module exports", () => {
  it("is the same list of values", () => {
    expect(Object.keys(web).sort()).toMatchSnapshot();
  });
});

describe("query keys", () => {
  it("are built the same way", () => {
    const k = web.keys;
    expect({
      static: Object.fromEntries(Object.entries(k).filter(([, v]) => typeof v !== "function")),
      threads: [k.threads("imbox"), k.threads("feed", "q", "L1", "x")],
      feed: [k.feed(), k.feed("library")],
      thread: [k.thread("t1"), k.thread("t1", true)],
      contacts: k.contacts("ann"),
      contact: k.contact("c1"),
      collection: k.collection("col1"),
      search: [k.search("a"), k.search("a", "recent", true, true)],
      cal: [k.calRange("2026-10-01", "2026-10-31"), k.calDay("2026-10-03")],
    }).toMatchSnapshot();
  });

  it("invalidate the mail caches, and the calendar ones by their common prefix", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    web.invalidateMail(qc);
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0])).toEqual(["imbox", "threads", "feed", "thread", "counts", "screener", "screened-out", "search", "collection", "contact", "clips"]);
    spy.mockClear();
    web.invalidateCalendar(qc);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([{ queryKey: ["cal"] }]);
  });
});

function stubFetch(res: { status?: number; body?: string }) {
  const calls: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    const status = res.status ?? 200;
    return { ok: status < 400, status, statusText: "ST", text: async () => res.body ?? "{}" };
  });
  return calls;
}

describe("the request function", () => {
  it("sends the scope, the browser's time zone and cookies, a JSON body only when there is one, and the query string helper skips empty values", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "Africa/Cairo" } as Intl.ResolvedDateTimeFormatOptions);
    const calls = stubFetch({ body: '{"ok":true}' });
    expect(await web.api.get("/api/x")).toEqual({ ok: true });
    web.storeAccountId("acc-1");
    await web.api.post("/api/y", { a: 1 });
    await web.api.del("/api/z");
    expect(calls.map((c) => [c.init.method, c.path, c.init.headers, c.init.body, c.init.credentials])).toMatchSnapshot();
    expect(web.qs({ a: 1, b: "", c: undefined, d: null, e: "x y" })).toBe("?a=1&e=x+y");
    expect(web.qs({})).toBe("");
  });

  it("remembers the scope, with a fallback when storage is unavailable", () => {
    expect(web.getScope()).toBe("all");
    web.storeAccountId("acc-2");
    expect(web.getAccountId()).toBe("acc-2");
    expect(web.getScope()).toBe("acc-2");
    web.storeAccountId(null);
    expect(web.getAccountId()).toBeNull();
  });

  it("says what went wrong: the route's own sentence, a known code in words, an unknown code spaced out, an error page as a short line", async () => {
    stubFetch({ status: 400, body: '{"error":"x","message":"Use a longer password."}' });
    await expect(web.api.get("/a")).rejects.toMatchObject({ status: 400, message: "Use a longer password." });
    stubFetch({ status: 401, body: '{"error":"invalid_credentials"}' });
    const loc = { pathname: "/settings", search: "?tab=ai", href: "" };
    vi.stubGlobal("location", loc);
    await expect(web.api.get("/a")).rejects.toMatchObject({ status: 401, message: "Please log in" });
    expect(loc.href).toBe("/login?next=%2Fsettings%3Ftab%3Dai");
    stubFetch({ status: 403, body: '{"error":"forbidden"}' });
    await expect(web.api.get("/a")).rejects.toMatchObject({ message: "You don't have permission to do that." });
    stubFetch({ status: 404, body: '{"error":"some_new_code"}' });
    await expect(web.api.get("/a")).rejects.toMatchObject({ message: "some new code" });
    stubFetch({ status: 502, body: "<!doctype html><html>Bad gateway</html>" });
    await expect(web.api.get("/a")).rejects.toMatchObject({ status: 502, message: "The server is too busy right now. Try again in a moment." });
    stubFetch({ status: 418, body: "<html>teapot</html>" });
    await expect(web.api.get("/a")).rejects.toMatchObject({ message: "The request didn't go through (418)." });
    stubFetch({ status: 500, body: "plain text" });
    await expect(web.api.get("/a")).rejects.toMatchObject({ message: "plain text" });
  });

  it("is an Error that carries the status", () => {
    const e = new web.ApiError(409, "Clash");
    expect(e).toBeInstanceOf(Error);
    expect([e.status, e.message]).toEqual([409, "Clash"]);
  });
});

type Row = Record<string, unknown>;
const thread = (id: string, o: Row = {}) => ({ id, bucket: "imbox", seen: false, unread: true, reply_later: false, set_aside: false, last_message_at: Number(id.slice(1)) * 1000, subject: id, ...o });

describe("patching the thread caches before the server answers", () => {
  const seed = () => {
    const qc = new QueryClient();
    qc.setQueryData(web.keys.imbox, { new_threads: [thread("t1"), thread("t2")], seen_threads: [thread("t3", { seen: true, unread: false })], reply_later: [thread("t4", { reply_later: true })], set_aside: [] });
    qc.setQueryData(["threads", "all", "", "", ""], { pages: [{ threads: [thread("t1"), thread("t5")], next_page: null }], pageParams: [0] });
    qc.setQueryData(["feed", "feed", "new"], { pages: [{ threads: [thread("t6", { bucket: "feed" })], next_page: null }], pageParams: [0] });
    qc.setQueryData(web.keys.thread("t1"), { id: "t1", seen: false, unread: true, messages: [{ id: "m1", unread: true }, { id: "m2", unread: false }] });
    qc.setQueryData(web.keys.counts, { imbox_new: 5, feed_new: 2, paper_trail_new: 1 });
    return qc;
  };
  const dump = (qc: QueryClient) => qc.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]).sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));

  it("removes threads from every list", () => {
    const qc = seed();
    web.removeThreadsFromLists(qc, ["t1", "t4", "t6"]);
    expect(dump(qc)).toMatchSnapshot();
  });

  it("marks threads read, moving them between the Imbox sections and counting the change", () => {
    const qc = seed();
    web.markThreadsSeen(qc, ["t1", "t6"], true);
    expect(dump(qc)).toMatchSnapshot();
  });

  it("marks threads unread", () => {
    const qc = seed();
    web.markThreadsSeen(qc, ["t3"], false);
    expect(dump(qc)).toMatchSnapshot();
  });
});

describe("live updates", () => {
  it("does not claim the server keeps mail fresh before the stream has said so", () => {
    expect(web.serverKeepsMailFresh()).toBe(false);
  });
});

describe("whenLiveKnown", () => {
  it("waits for the event stream, and gives up after the time it was given", async () => {
    vi.useFakeTimers();
    let done = false;
    void web.whenLiveKnown(2000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

describe("streamSilent", () => {
  it("is true only once the stream has said nothing for longer than the limit", () => {
    expect(web.streamSilent(100_000, 30_000)).toBe(false);
    expect(web.streamSilent(110_000, 30_000)).toBe(true);
    expect(web.streamSilent(110_000, 30_000, 100_000)).toBe(false);
    expect(web.STREAM_SILENCE_MS).toBe(75_000);
  });
});
