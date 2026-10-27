import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incrementalSync } from "../../src/api/sync";
import type { AccountRow } from "../../src/api/db";
import { signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";

// Gmail's incremental sync: read what changed since the cursor, fetch and store new mail, apply deletions and label changes, move the cursor only as far as
// it really read. Only the batch fetch is replaced (it is a multipart parser of its own); every other Gmail call goes through the real client on a stubbed fetch.
vi.mock("../../src/api/google", async (orig) => {
  const actual = await orig<typeof import("../../src/api/google")>();
  return { ...actual, gmailBatchGet: vi.fn(async () => []) };
});
import { gmailBatchGet } from "../../src/api/google";
const batch = gmailBatchGet as unknown as ReturnType<typeof vi.fn>;

const T0 = 1_790_000_000_000;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const db = () => testEnv.DB;
let fetchMock: ReturnType<typeof vi.fn>;

const gmailMessage = (id: string, thread: string, labelIds: string[] = ["INBOX", "UNREAD"], from = "sam@example.org") => ({
  id, threadId: thread, labelIds, snippet: `snippet ${id}`, internalDate: String(T0 + Number(id.replace(/\D/g, "") || 0)), sizeEstimate: 100,
  payload: { mimeType: "text/plain", body: { data: "SGVsbG8", size: 5 }, headers: [{ name: "From", value: `Sam <${from}>` }, { name: "To", value: "me@gmail.test" }, { name: "Subject", value: `Subject ${thread}` }, { name: "Date", value: "Tue, 01 Oct 2030 09:00:00 +0000" }] },
});
const added = (n: number, thread = `t${n}`, labelIds = ["INBOX"]) => ({ id: String(n), messagesAdded: [{ message: { id: `m${n}`, threadId: thread, labelIds } }] });
const historyOnce = (history: unknown[], historyId = "900") => fetchMock.mockImplementation(async (url: string) => (String(url).includes("/profile") ? json({ historyId: "777" }) : json({ history, historyId })));
/** Gmail answers a fetch of full messages with the messages it was asked for. */
const serve = (labels: Record<string, string[]> = {}) =>
  batch.mockImplementation(async (_e: unknown, _a: unknown, ids: string[]) => ids.map((id) => gmailMessage(id, `t${id.slice(1)}`, labels[id] ?? ["INBOX", "UNREAD"])));

async function account(history_id: string | null = "100"): Promise<AccountRow> {
  await db().prepare(`UPDATE accounts SET history_id = ? WHERE id = 'g1'`).bind(history_id).run();
  return (await db().prepare(`SELECT * FROM accounts WHERE id = 'g1'`).first<AccountRow>())!;
}
const reload = async () => (await db().prepare(`SELECT * FROM accounts WHERE id = 'g1'`).first<AccountRow>())!;
const calls = () => fetchMock.mock.calls.map((c) => String(c[0]).replace(/^.*\/gmail\/v1\/users\/me\//, "").replace(/pageToken=\w+/, "pageToken=<p>"));
const norm = (v: unknown): unknown => {
  if (typeof v === "string") return v.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
  if (typeof v === "number") return v > 1.7e12 && v < 1.85e12 && !(v >= T0 && v < T0 + 1e9) ? "<now>" : v;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};
async function state() {
  const rows = async (sql: string) => (await db().prepare(sql).all()).results;
  return norm({
    history_id: (await reload()).history_id,
    threads: await rows(`SELECT gmail_thread_id, bucket, seen, unread, message_count FROM threads ORDER BY gmail_thread_id`),
    messages: await rows(`SELECT gmail_message_id, unread FROM messages ORDER BY gmail_message_id`),
    log: await rows(`SELECT level, message FROM sync_log WHERE message NOT ILIKE 'Applied migration%' ORDER BY id`),
  });
}

beforeEach(async () => {
  await signIn("ug");
  await seedAccount("g1", "me@gmail.test", { user: "ug", provider: "gmail" });
  await db().prepare(`UPDATE accounts SET access_token = 'tok', refresh_token = 'rtok', token_expires_at = ?, scopes = 'https://www.googleapis.com/auth/gmail.modify' WHERE id = 'g1'`).bind(Date.now() + 3_600_000).run();
  batch.mockReset();
  serve();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the cursor", () => {
  it("starts at the mailbox's current point when there is none", async () => {
    fetchMock.mockImplementation(async () => json({ historyId: "777" }));
    const r = await incrementalSync(testEnv, await account(null));
    expect(r).toEqual({ added: 0 });
    expect(await state()).toMatchSnapshot();
    expect(calls()).toMatchSnapshot("calls");
  });

  it("moves to where the mailbox now is when it read everything", async () => {
    historyOnce([added(101), added(102)], "200");
    expect(await incrementalSync(testEnv, await account())).toEqual({ added: 2 });
    expect(await state()).toMatchSnapshot();
    expect(calls()).toMatchSnapshot("calls");
  });

  it("leaves the cursor alone when nothing happened, and logs nothing", async () => {
    historyOnce([], "100");
    await incrementalSync(testEnv, await account());
    expect(await state()).toMatchSnapshot();
  });

  it("resumes after the last record read when the page cap stops it, not at the mailbox's current id", async () => {
    let page = 0;
    fetchMock.mockImplementation(async () => json({ history: [added(100 + ++page)], nextPageToken: `p${page}`, historyId: "99999" }));
    await incrementalSync(testEnv, await account());
    expect(calls().filter((c) => c.startsWith("history?"))).toHaveLength(5);
    expect((await reload()).history_id).toBe("105");
    fetchMock.mockReset();
    historyOnce([added(106)], "99999");
    await incrementalSync(testEnv, await reload());
    expect(calls().find((c) => c.startsWith("history?"))).toContain("startHistoryId=105");
    expect((await reload()).history_id).toBe("99999");
  });

  it("stops at a record boundary when there is more new mail than one pass takes, and loses none of the rest", async () => {
    historyOnce(Array.from({ length: 400 }, (_, i) => added(101 + i)), "9000");
    await incrementalSync(testEnv, await account());
    const fetched = batch.mock.calls.flatMap((c) => c[2] as string[]);
    expect(fetched).toHaveLength(300);
    expect(fetched[299]).toBe("m400");
    expect((await reload()).history_id).toBe("400");
  });

  it("fetches and stores in pieces of fifty", async () => {
    historyOnce(Array.from({ length: 120 }, (_, i) => added(101 + i)));
    expect(await incrementalSync(testEnv, await account())).toEqual({ added: 120 });
    expect(batch.mock.calls.map((c) => (c[2] as string[]).length)).toEqual([50, 50, 20]);
  });
});

describe("what changed", () => {
  it("skips spam, and forgets a message that was deleted in the same pass", async () => {
    historyOnce([
      { id: "101", messagesAdded: [{ message: { id: "m101", threadId: "t101", labelIds: ["SPAM"] } }] },
      added(102), added(103),
      { id: "104", messagesDeleted: [{ message: { id: "m103", threadId: "t103" } }] },
    ]);
    await incrementalSync(testEnv, await account());
    expect(batch.mock.calls.flatMap((c) => c[2] as string[])).toEqual(["m102"]);
    expect(await state()).toMatchSnapshot();
  });

  it("removes a deleted message, recounts its thread, and drops a thread left empty", async () => {
    historyOnce([added(101, "tx"), added(102, "tx"), added(103, "ty")]);
    serve();
    batch.mockImplementation(async (_e: unknown, _a: unknown, ids: string[]) => ids.map((id) => gmailMessage(id, id === "m103" ? "ty" : "tx")));
    await incrementalSync(testEnv, await account());
    historyOnce([{ id: "110", messagesDeleted: [{ message: { id: "m102", threadId: "tx" } }, { message: { id: "m103", threadId: "ty" } }] }], "910");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot();
  });

  it("applies UNREAD added and removed, and reopens the Imbox flag when the last unread message is read", async () => {
    historyOnce([added(101, "tu"), added(102, "tu")]);
    batch.mockImplementation(async (_e: unknown, _a: unknown, ids: string[]) => ids.map((id) => gmailMessage(id, "tu")));
    await incrementalSync(testEnv, await account());
    historyOnce([{ id: "110", labelsRemoved: [{ message: { id: "m101", threadId: "tu" }, labelIds: ["UNREAD"] }] }], "910");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot("one read");
    historyOnce([{ id: "120", labelsRemoved: [{ message: { id: "m102", threadId: "tu" }, labelIds: ["UNREAD"] }] }], "920");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot("all read");
    historyOnce([{ id: "130", labelsAdded: [{ message: { id: "m101", threadId: "tu" }, labelIds: ["UNREAD"] }] }], "930");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot("unread again");
  });

  it("trashes a thread, and takes it out of the trash into the place its sender's status gives", async () => {
    for (const [status, sender] of [["pending", "p@example.org"], ["imbox", "i@example.org"], ["feed", "f@example.org"], ["screened_out", "s@example.org"]] as const) {
      await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes) VALUES (?, 'g1', ?, '', ?, 1, 1, 1, 1, '')`).bind(`c-${status}`, sender, status).run();
    }
    historyOnce(["pending", "imbox", "feed", "screened_out"].map((s, i) => added(101 + i, `th-${s}`)));
    batch.mockImplementation(async (_e: unknown, _a: unknown, ids: string[]) => ids.map((id) => gmailMessage(id, ["th-pending", "th-imbox", "th-feed", "th-screened_out"][Number(id.slice(1)) - 101], ["INBOX", "UNREAD"], ["p", "i", "f", "s"][Number(id.slice(1)) - 101] + "@example.org")));
    await incrementalSync(testEnv, await account());
    historyOnce([101, 102, 103, 104].map((n) => ({ id: String(200 + n), labelsAdded: [{ message: { id: `m${n}`, threadId: "x" }, labelIds: ["TRASH"] }] })), "910");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot("trashed");
    historyOnce([101, 102, 103, 104].map((n) => ({ id: String(300 + n), labelsRemoved: [{ message: { id: `m${n}`, threadId: "x" }, labelIds: ["TRASH"] }] })), "920");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot("restored");
  });

  it("lets the later of two label changes on one message win", async () => {
    historyOnce([added(101, "tl")]);
    batch.mockImplementation(async (_e: unknown, _a: unknown, ids: string[]) => ids.map((id) => gmailMessage(id, "tl")));
    await incrementalSync(testEnv, await account());
    historyOnce([
      { id: "110", labelsRemoved: [{ message: { id: "m101", threadId: "tl" }, labelIds: ["UNREAD"] }] },
      { id: "111", labelsAdded: [{ message: { id: "m101", threadId: "tl" }, labelIds: ["UNREAD"] }] },
    ], "910");
    await incrementalSync(testEnv, await reload());
    expect(await state()).toMatchSnapshot();
  });
});

describe("when the history has expired", () => {
  it("lists the last week again, stores it, and takes a new cursor", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/history?")) return json({ error: { message: "gone" } }, 404);
      if (u.includes("/messages?")) return json({ messages: [{ id: "m201" }, { id: "m202" }] });
      return json({ historyId: "777" });
    });
    expect(await incrementalSync(testEnv, await account())).toEqual({ added: 2 });
    expect(await state()).toMatchSnapshot();
    expect(calls()).toMatchSnapshot("calls");
  });

  it("passes any other error on", async () => {
    fetchMock.mockImplementation(async () => json({ error: { message: "boom" } }, 500));
    await expect(incrementalSync(testEnv, await account())).rejects.toThrow();
  });
});
