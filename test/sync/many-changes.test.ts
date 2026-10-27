import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incrementalSync } from "../../src/api/sync";
import type { AccountRow } from "../../src/api/db";
import { signIn, testEnv } from "../api-harness";
import { resetStatements, sent } from "../support/pgenv";
import { seedAccount } from "../agent-fixtures";

// Many changes at once in Gmail's incremental sync: a hundred messages read in another app, trashed and brought back, or deleted, which are a few statements and
// not a few for each message. The same stubs as incremental.test.ts.
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


// How many statements a change took is checked after the test has checked what it did, so a test that fails says which of the two went wrong.
let counts: [number, number][] = [];
const within = (max: number) => counts.push([sent.statements, max]);
beforeEach(() => {
  counts = [];
});
afterEach(() => {
  for (const [n, max] of counts) expect(n, "statements").toBeLessThan(max);
});

const N = 120;
/** N messages in N/2 threads, two to a thread, stored by a first pass. */
async function fill() {
  historyOnce(Array.from({ length: N }, (_, i) => added(1000 + i, `tm${i % (N / 2)}`)), "200");
  batch.mockImplementation(async (_e: unknown, _a: unknown, ids: string[]) => ids.map((id) => gmailMessage(id, `tm${(Number(id.slice(1)) - 1000) % (N / 2)}`)));
  await incrementalSync(testEnv, await account());
  resetStatements();
}
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => 1000 + from + i);
const rec = (n: number, kind: "labelsAdded" | "labelsRemoved", label: string) => ({ id: String(5000 + n), [kind]: [{ message: { id: `m${n}`, threadId: "x" }, labelIds: [label] }] });
const q = async <T>(sql: string) => (await db().prepare(sql).all<T>()).results;

describe("a hundred changes at once", () => {
  it("marking messages read and unread: the messages, the threads that have none left unread, and a few statements", async () => {
    await fill();
    // Everything in threads 0..29 (messages 0..29 and 60..89) is read in another app.
    const read = [...ids(0, 30), ...ids(60, 90)];
    historyOnce(read.map((n) => rec(n, "labelsRemoved", "UNREAD")), "910");
    await incrementalSync(testEnv, await reload());
    within(24);
    expect((await q<any>(`SELECT count(*) AS n FROM messages WHERE unread = 0`))[0].n).toBe(60);
    expect(await q(`SELECT gmail_thread_id, seen, unread FROM threads WHERE gmail_thread_id IN ('tm0', 'tm29') ORDER BY gmail_thread_id`)).toEqual([
      { gmail_thread_id: "tm0", seen: 1, unread: 0 },
      { gmail_thread_id: "tm29", seen: 1, unread: 0 },
    ]);
    // A thread with only one of its two read is still unread.
    historyOnce(ids(30, 31).map((n) => rec(n, "labelsRemoved", "UNREAD")), "920");
    await incrementalSync(testEnv, await reload());
    expect(await q(`SELECT unread FROM threads WHERE gmail_thread_id = 'tm30'`)).toEqual([{ unread: 1 }]);
    // And unread again.
    resetStatements();
    historyOnce(read.map((n) => rec(n, "labelsAdded", "UNREAD")), "930");
    await incrementalSync(testEnv, await reload());
    within(24);
    expect((await q<any>(`SELECT count(*) AS n FROM messages WHERE unread = 1`))[0].n).toBe(N - 1);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE unread = 1`))[0].n).toBe(N / 2);
  });

  it("trashing threads, and taking them out of the trash into the place their sender's status gives", async () => {
    await fill();
    await db().prepare(`UPDATE contacts SET screen_status = 'feed', screened_at = 1 WHERE email = 'sam@example.org'`).run();
    const some = ids(0, 40);
    resetStatements();
    historyOnce(some.map((n) => rec(n, "labelsAdded", "TRASH")), "910");
    await incrementalSync(testEnv, await reload());
    within(20);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE bucket = 'trash'`))[0].n).toBe(40);
    resetStatements();
    historyOnce(some.map((n) => rec(n, "labelsRemoved", "TRASH")), "920");
    await incrementalSync(testEnv, await reload());
    within(20);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE bucket = 'trash'`))[0].n).toBe(0);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE bucket = 'feed'`))[0].n).toBe(40);
  });

  it("deleting messages: they go, their threads are recounted, a thread left with none goes, and a few statements", async () => {
    await fill();
    // Both messages of threads 0..19, and one message of threads 20..39.
    const gone = [...ids(0, 20), ...ids(60, 80), ...ids(20, 40)];
    historyOnce([{ id: "910", messagesDeleted: gone.map((n) => ({ message: { id: `m${n}`, threadId: "x" } })) }], "910");
    await incrementalSync(testEnv, await reload());
    within(18);
    expect((await q<any>(`SELECT count(*) AS n FROM messages`))[0].n).toBe(N - gone.length);
    expect((await q<any>(`SELECT count(*) AS n FROM threads`))[0].n).toBe(N / 2 - 20);
    expect(await q(`SELECT gmail_thread_id, message_count FROM threads WHERE gmail_thread_id IN ('tm20', 'tm45') ORDER BY gmail_thread_id`)).toEqual([
      { gmail_thread_id: "tm20", message_count: 1 },
      { gmail_thread_id: "tm45", message_count: 2 },
    ]);
  });
});
