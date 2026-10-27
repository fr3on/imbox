import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, seedThread, testEnv } from "../api-harness";
import { seedWorld, type World } from "../api-world";

// Every action a thread can take, through the route a browser uses (POST /api/threads/:id/actions, and the bulk and empty-trash routes that run the same
// code). Each case pins the answer, the rows left behind and the calls made to Gmail, so the code behind them can be reorganised without changing any.

const T0 = 1_790_000_000_000;
let w: World;
let gmailThread: string;
let gmailMsg: string;
let fetchMock: ReturnType<typeof vi.fn>;
const db = () => testEnv.DB;

const norm = (v: unknown): unknown => {
  if (typeof v === "string") return v.replace(/\bt-\d+\b/g, "<t>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
  if (typeof v === "number") return v > 1.7e12 && v < 1.85e12 ? "<now>" : v;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};
const as = (method: string, path: string, body?: unknown) => call(method, path, { token: w.token, ...(body === undefined ? {} : { body }) });
const act = (id: string, body: Record<string, unknown>) => as("POST", `/api/threads/${id}/actions`, body);

/** The rows an action can change, for the threads given. */
async function rows(ids: string[]) {
  const q = async (sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all()).results;
  const inList = `(${ids.map(() => "?").join(",")})`;
  return norm({
    threads: await q(`SELECT subject, bucket, seen, unread, reply_later, reply_later_at IS NOT NULL AS rl_at, set_aside, set_aside_at IS NOT NULL AS sa_at, bubble_up_at, bubbled, custom_subject, note, message_count, last_message_at, first_message_at, participants_json, has_attachments, merged_into IS NOT NULL AS merged FROM threads WHERE id IN ${inList} ORDER BY gmail_thread_id`, ...ids),
    messages: await q(`SELECT gmail_message_id, unread FROM messages WHERE thread_id IN ${inList} ORDER BY gmail_message_id`, ...ids),
    labels: await q(`SELECT l.name FROM thread_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.thread_id IN ${inList} ORDER BY l.name`, ...ids),
    collections: await q(`SELECT c.name FROM collection_threads ct JOIN collections c ON c.id = ct.collection_id WHERE ct.thread_id IN ${inList} ORDER BY c.name`, ...ids),
    clips: await q(`SELECT text FROM clips WHERE thread_id IN ${inList}`, ...ids),
    contacts: await q(`SELECT email, bundled FROM contacts WHERE account_id = ? ORDER BY email`, w.imap),
    gmail: fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? "GET"} ${String(c[0]).replace(/^.*\/gmail\/v1\/users\/me\//, "")}`),
  });
}
async function result(res: Response) {
  const body = await res.json().catch(() => null);
  return norm({ status: res.status, body: body && typeof body === "object" && "id" in body ? { id: "<thread>", subject: (body as any).subject, bucket: (body as any).bucket, seen: (body as any).seen, unread: (body as any).unread } : body });
}

beforeAll(async () => {
  w = await seedWorld("ua");
  await db().prepare(`UPDATE accounts SET access_token = 'tok', refresh_token = 'rtok', token_expires_at = ?, scopes = 'https://www.googleapis.com/auth/gmail.modify' WHERE id = ?`).bind(Date.now() + 3_600_000, w.gmail).run();
  const g = await seedThread(w.gmail, { subject: "On Gmail", bucket: "imbox", from: "gm@example.org" });
  gmailThread = g.thread;
  gmailMsg = g.message;
  await seedThread(w.imap, { subject: "Second", bucket: "imbox", from: "two@example.org" });
});
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = async (id: string, body: Record<string, unknown>, also: string[] = []) => ({ answer: await result(await act(id, body)), rows: await rows([id, ...also]) });

describe("reading and unreading", () => {
  it("marks unread, read and seen", async () => {
    expect(await run(w.thread, { action: "mark_unread" })).toMatchSnapshot("unread");
    expect(await run(w.thread, { action: "mark_read" })).toMatchSnapshot("read");
    await act(w.thread, { action: "mark_unread" });
    expect(await run(w.thread, { action: "seen" })).toMatchSnapshot("seen");
  });
});

describe("Reply Later and Set Aside", () => {
  it("each turns on and off, and turning one on turns the other off", async () => {
    expect(await run(w.thread, { action: "reply_later" })).toMatchSnapshot("reply later on");
    expect(await run(w.thread, { action: "set_aside" })).toMatchSnapshot("set aside on, reply later off");
    expect(await run(w.thread, { action: "reply_later", on: true })).toMatchSnapshot("reply later again");
    expect(await run(w.thread, { action: "reply_later", on: false })).toMatchSnapshot("reply later off");
    expect(await run(w.thread, { action: "set_aside", on: false })).toMatchSnapshot("set aside off");
  });
});

describe("bubbling up", () => {
  it("sets a time in the future, clears it, and refuses a past or odd time", async () => {
    expect(await run(w.thread, { action: "bubble_up", at: 4_102_444_800_000 })).toMatchSnapshot("future");
    expect(await run(w.thread, { action: "bubble_up", at: null })).toMatchSnapshot("cleared");
    expect(await run(w.thread, { action: "bubble_up", at: 1000 })).toMatchSnapshot("past");
    expect(await run(w.thread, { action: "bubble_up", at: "soon" })).toMatchSnapshot("not a number");
  });
});

describe("moving", () => {
  it("moves to each place, and refuses another", async () => {
    for (const bucket of ["feed", "paper_trail", "screened_out", "screener", "imbox"]) expect(await run(w.thread, { action: "move", bucket })).toMatchSnapshot(bucket);
    expect(await run(w.thread, { action: "move", bucket: "everything" })).toMatchSnapshot("invalid");
    expect(await run(w.thread, { action: "move" })).toMatchSnapshot("none");
  });

  it("trashing clears Reply Later and Set Aside, and tells Gmail; moving back out tells Gmail too", async () => {
    await act(gmailThread, { action: "reply_later" });
    expect(await run(gmailThread, { action: "move", bucket: "trash" })).toMatchSnapshot("trash");
    expect(await run(gmailThread, { action: "move", bucket: "imbox" })).toMatchSnapshot("untrash");
    expect(await run(gmailThread, { action: "move", bucket: "feed" })).toMatchSnapshot("no call");
  });

  it("does not call Gmail for a mailbox that is not Gmail", async () => {
    expect(await run(w.thread, { action: "move", bucket: "trash" })).toMatchSnapshot();
  });
});

describe("naming and noting", () => {
  it("renames, trims, clears and cuts a long name", async () => {
    expect(await run(w.thread, { action: "rename", subject: "  Plan B  " })).toMatchSnapshot("set");
    expect(await run(w.thread, { action: "rename", subject: "   " })).toMatchSnapshot("blank");
    expect(await run(w.thread, { action: "rename", subject: "x".repeat(600) })).toMatchSnapshot("long");
    expect(await run(w.thread, { action: "rename", subject: 5 })).toMatchSnapshot("not text");
    expect(await run(w.thread, { action: "rename", subject: null })).toMatchSnapshot("null");
  });

  it("keeps a note, cut at its limit, and clears it", async () => {
    expect(await run(w.thread, { action: "note", note: "call back" })).toMatchSnapshot("set");
    await act(w.thread, { action: "note", note: "n".repeat(10_500) });
    const long = (await db().prepare(`SELECT length(note) AS n FROM threads WHERE id = ?`).bind(w.thread).first<{ n: number }>())!.n;
    expect(long).toMatchSnapshot("length");
    expect(await run(w.thread, { action: "note", note: 7 })).toMatchSnapshot("not text");
  });
});

describe("merging", () => {
  it("folds other threads of the same mailbox into this one, and counts them", async () => {
    const a = await seedThread(w.imap, { subject: "Merge A", from: "a@example.org" });
    const b = await seedThread(w.imap, { subject: "Merge B", from: "b@example.org" });
    await db().prepare(`UPDATE threads SET has_attachments = 1, last_message_at = ?, first_message_at = ?, message_count = 3 WHERE id = ?`).bind(T0 + 9000, 5, a.thread).run();
    await db().prepare(`UPDATE threads SET message_count = 4 WHERE id = ?`).bind(b.thread).run();
    await db().prepare(`UPDATE threads SET merged_into = ? WHERE id = ?`).bind(b.thread, a.thread).run();
    await db().prepare(`UPDATE threads SET merged_into = NULL WHERE id = ?`).bind(a.thread).run();
    await db().prepare(`INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, seen, unread, first_message_at, last_message_at, participants_json, message_count, merged_into, created_at, updated_at) VALUES ('child', ?, 'gchild', 'Child', '', 'imbox', 0, 0, 1, 1, '[]', 1, ?, 1, 1)`).bind(w.imap, b.thread).run();
    expect(await run(w.thread, { action: "merge", thread_ids: [a.thread, b.thread, w.thread] }, [a.thread, b.thread, "child"])).toMatchSnapshot();
  });

  it("keeps the attachment flag of the thread it merges into", async () => {
    const a = await seedThread(w.imap, { subject: "Plain", from: "plain@example.org" });
    await db().prepare(`UPDATE threads SET has_attachments = 1 WHERE id = ?`).bind(w.thread).run();
    expect(await run(w.thread, { action: "merge", thread_ids: [a.thread] }, [a.thread])).toMatchSnapshot();
  });

  it("refuses an empty list, a list of itself, and threads that are not found or on another mailbox", async () => {
    const other = await seedThread(w.gmail, { subject: "Other mailbox" });
    expect(await run(w.thread, { action: "merge", thread_ids: [] })).toMatchSnapshot("empty");
    expect(await run(w.thread, { action: "merge", thread_ids: [w.thread] })).toMatchSnapshot("self");
    expect(await run(w.thread, { action: "merge", thread_ids: ["nope"] })).toMatchSnapshot("missing");
    expect(await run(w.thread, { action: "merge", thread_ids: [other.thread] }, [other.thread])).toMatchSnapshot("other mailbox");
  });
});

describe("labels and collections", () => {
  it("adds and removes labels, ignoring a label that is not the user's", async () => {
    expect(await run(w.thread, { action: "labels", add: [w.label, "nope"] })).toMatchSnapshot("add");
    expect(await run(w.thread, { action: "labels", add: [w.label] })).toMatchSnapshot("add again");
    expect(await run(w.thread, { action: "labels", remove: [w.label] })).toMatchSnapshot("remove");
    expect(await run(w.thread, { action: "labels" })).toMatchSnapshot("nothing");
  });

  it("adds and removes collections", async () => {
    expect(await run(w.thread, { action: "collections", add: [w.collection, "nope"] })).toMatchSnapshot("add");
    expect(await run(w.thread, { action: "collections", remove: [w.collection] })).toMatchSnapshot("remove");
  });
});

describe("bundling", () => {
  it("bundles and unbundles the sender, and starts a contact when there is none", async () => {
    expect(await run(w.thread, { action: "bundle" })).toMatchSnapshot("bundle");
    expect(await run(w.thread, { action: "bundle", on: false })).toMatchSnapshot("unbundle");
    const fresh = await seedThread(w.imap, { subject: "New sender", bucket: "paper_trail", from: "fresh@example.org" });
    expect(await run(fresh.thread, { action: "bundle" })).toMatchSnapshot("new contact");
  });
});

describe("deleting", () => {
  it("removes the thread, what hangs off it and the threads merged into it, and trashes them at Gmail", async () => {
    await db().prepare(`INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, seen, unread, first_message_at, last_message_at, participants_json, message_count, merged_into, created_at, updated_at) VALUES ('kid', ?, 'gkid', 'Kid', '', 'imbox', 0, 0, 1, 1, '[]', 1, ?, 1, 1)`).bind(w.gmail, gmailThread).run();
    await db().prepare(`INSERT INTO clips (id, account_id, thread_id, message_id, text, created_at) VALUES ('cl', ?, ?, NULL, 'kept', 1)`).bind(w.gmail, gmailThread).run();
    const answer = await result(await act(gmailThread, { action: "delete" }));
    expect({ answer, rows: await rows([gmailThread, "kid"]) }).toMatchSnapshot();
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM messages WHERE id = ?`).bind(gmailMsg).first<{ n: number }>())!.n).toBe(0);
  });
});

describe("refusals", () => {
  it("answers an unknown action, a missing thread and another user's thread", async () => {
    expect(await run(w.thread, { action: "dance" })).toMatchSnapshot("unknown");
    for (const action of [["move"], { toString: "move" }, "constructor", "__proto__", 5, null]) expect((await act(w.thread, { action, bucket: "feed" })).status).toBe(400);
    expect(await result(await act("nope", { action: "mark_read" }))).toMatchSnapshot("missing");
    expect(await result(await call("POST", `/api/threads/${w.thread}/actions`, { token: null, body: { action: "mark_read" } }))).toMatchSnapshot("signed out");
  });
});

describe("many threads at once", () => {
  it("applies one action to each thread, counts those it did, and skips what is not the user's", async () => {
    const ids = [w.thread, gmailThread, "nope"];
    const res = await as("POST", "/api/threads/bulk", { action: "move", bucket: "feed", thread_ids: ids });
    expect({ status: res.status, body: await res.json(), rows: await rows([w.thread, gmailThread]) }).toMatchSnapshot("move");
    expect(await result(await as("POST", "/api/threads/bulk", { action: "mark_read", thread_ids: [] }))).toMatchSnapshot("none");
    expect(await result(await as("POST", "/api/threads/bulk", { action: "merge", thread_ids: ids }))).toMatchSnapshot("merge refused");
  });

  it("empties the trash for good, and only the trash", async () => {
    await act(w.thread, { action: "move", bucket: "trash" });
    await act(gmailThread, { action: "move", bucket: "trash" });
    const res = await as("POST", "/api/threads/empty-trash", {});
    expect({ status: res.status, body: await res.json(), left: (await db().prepare(`SELECT COUNT(*) AS n FROM threads WHERE bucket = 'trash'`).first())!.n, kept: (await db().prepare(`SELECT COUNT(*) AS n FROM threads`).first())!.n }).toMatchSnapshot();
  });
});
