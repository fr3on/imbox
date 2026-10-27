import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, nid, seedThread, signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { seedWorld, type World } from "../api-world";
import { resetStatements, sent } from "../support/pgenv";

/**
 * One action applied to many threads (POST /api/threads/bulk, and empty-trash): what each leaves behind, what it tells Gmail, and what it leaves alone
 * (another person's threads, ids that are not there). Pinned before bulk stopped running the single-thread code once for each thread.
 */

let w: World;
let fetchMock: ReturnType<typeof vi.fn>;
const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
const as = (method: string, path: string, body?: unknown) => call(method, path, { token: w.token, ...(body === undefined ? {} : { body }) });
const gmailCalls = () => fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? "GET"} ${String(c[0]).replace(/^.*\/gmail\/v1\/users\/me\//, "")}`).sort();

// Two threads in the mailbox that is not Gmail, one in the Gmail one, another person's, and a thread that is not there.
let A1: string;
let A2: string;
let G1: string;
let F1: string;
const ids = () => [A1, A2, G1, F1, "not-there", A1];
const bulk = async (body: Record<string, unknown>, list: string[] = ids()) => {
  const res = await as("POST", "/api/threads/bulk", { thread_ids: list, ...body });
  return { status: res.status, body: await res.json() };
};
const state = async (list: string[]) =>
  q<any>(
    `SELECT id, bucket, seen, unread, reply_later, reply_later_at IS NOT NULL AS rl_at, set_aside, set_aside_at IS NOT NULL AS sa_at, bubble_up_at, bubbled, custom_subject, updated_at
     FROM threads WHERE id IN (${list.map(() => "?").join(",")}) ORDER BY id`,
    ...list
  );
const by = (rows: any[], id: string) => rows.find((r) => r.id === id);

beforeAll(async () => {
  w = await seedWorld("ua");
  await db().prepare(`UPDATE accounts SET access_token = 'tok', refresh_token = 'rtok', token_expires_at = ?, scopes = 'https://www.googleapis.com/auth/gmail.modify' WHERE id = ?`).bind(Date.now() + 3_600_000, w.gmail).run();
  await signIn("ub");
  await seedAccount("a-foreign", "foreign@test.local", { user: "ub" });
  A1 = (await seedThread(w.imap, { subject: "A one", from: "a1@example.org" })).thread;
  A2 = (await seedThread(w.imap, { subject: "A two", from: "a2@example.org" })).thread;
  G1 = (await seedThread(w.gmail, { subject: "G one", from: "g1@example.org" })).thread;
  F1 = (await seedThread("a-foreign", { subject: "Theirs", from: "f1@example.org" })).thread;
  await db().prepare(`UPDATE threads SET updated_at = 1 WHERE id IN (?, ?, ?, ?)`).bind(A1, A2, G1, F1).run();
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

describe("reading and unreading many", () => {
  it("seen: marks the threads and their messages read, and drops a bubble", async () => {
    await db().prepare(`UPDATE threads SET bubbled = 1 WHERE id = ?`).bind(A1).run();
    const r = await bulk({ action: "seen" });
    expect(r).toEqual({ status: 200, body: { ok: true, count: 3 } });
    const s = await state([A1, A2, G1, F1]);
    for (const id of [A1, A2, G1]) expect(by(s, id)).toMatchObject({ seen: 1, unread: 0, bubbled: 0 });
    expect(by(s, A1).updated_at).toBeGreaterThan(1);
    expect(await q(`SELECT thread_id FROM messages WHERE thread_id IN (?, ?, ?) AND unread = 1`, A1, A2, G1)).toEqual([]);
    // Another person's thread is left exactly as it was.
    expect(by(s, F1)).toMatchObject({ seen: 0, unread: 1, updated_at: 1 });
    expect((await q<any>(`SELECT unread FROM messages WHERE thread_id = ?`, F1))[0].unread).toBe(1);
  });

  it("mark_read and mark_unread", async () => {
    expect(await bulk({ action: "mark_read" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    let s = await state([A1, A2, G1]);
    for (const x of s) expect(x).toMatchObject({ seen: 1, unread: 0 });
    expect(await q(`SELECT 1 FROM messages WHERE thread_id IN (?, ?, ?) AND unread = 1`, A1, A2, G1)).toEqual([]);
    expect(await bulk({ action: "mark_unread" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    s = await state([A1, A2, G1, F1]);
    for (const id of [A1, A2, G1]) expect(by(s, id)).toMatchObject({ seen: 0, unread: 1 });
    expect(by(s, F1).updated_at).toBe(1);
  });
});

describe("reply later and set aside, for many", () => {
  it("each turns on, and turning one on turns the other off; off clears its own", async () => {
    await db().prepare(`UPDATE threads SET set_aside = 1, set_aside_at = 5 WHERE id IN (?, ?)`).bind(A1, G1).run();
    expect(await bulk({ action: "reply_later" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    let s = await state([A1, A2, G1, F1]);
    for (const id of [A1, A2, G1]) expect(by(s, id)).toMatchObject({ reply_later: 1, rl_at: true, set_aside: 0 });
    expect(by(s, F1)).toMatchObject({ reply_later: 0, updated_at: 1 });
    expect(await bulk({ action: "reply_later", on: false })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    s = await state([A1, A2, G1]);
    for (const x of s) expect(x).toMatchObject({ reply_later: 0, rl_at: false });
    expect(await bulk({ action: "set_aside" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    s = await state([A1, A2, G1]);
    for (const x of s) expect(x).toMatchObject({ set_aside: 1, sa_at: true, reply_later: 0 });
    expect(await bulk({ action: "set_aside", on: false })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    for (const x of await state([A1, A2, G1])) expect(x).toMatchObject({ set_aside: 0, sa_at: false });
  });

  it("turning one on in a thread that has the other leaves a thread that has neither alone", async () => {
    await db().prepare(`UPDATE threads SET set_aside = 1, set_aside_at = 5 WHERE id = ?`).bind(A1).run();
    await bulk({ action: "reply_later", on: false });
    expect(by(await state([A1]), A1)).toMatchObject({ set_aside: 1, reply_later: 0 });
  });
});

describe("bubbling up many", () => {
  it("sets a time in the future and clears a bubble; a past or odd time does nothing, and counts none", async () => {
    const at = Date.now() + 86_400_000;
    expect(await bulk({ action: "bubble_up", at })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    let s = await state([A1, A2, G1, F1]);
    for (const id of [A1, A2, G1]) expect(by(s, id)).toMatchObject({ bubble_up_at: at, bubbled: 0 });
    expect(by(s, F1).bubble_up_at).toBeNull();
    expect(await bulk({ action: "bubble_up", at: 5 })).toEqual({ status: 200, body: { ok: true, count: 0 } });
    expect(await bulk({ action: "bubble_up", at: "tomorrow" })).toEqual({ status: 200, body: { ok: true, count: 0 } });
    expect(by(await state([A1]), A1).bubble_up_at).toBe(at);
    expect(await bulk({ action: "bubble_up", at: null })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    s = await state([A1, A2, G1]);
    for (const x of s) expect(x.bubble_up_at).toBeNull();
  });
});

describe("moving many", () => {
  it("moves to a place, counts the ones it moved, and refuses a place that is not one", async () => {
    expect(await bulk({ action: "move", bucket: "feed" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    const s = await state([A1, A2, G1, F1]);
    for (const id of [A1, A2, G1]) expect(by(s, id).bucket).toBe("feed");
    expect(by(s, F1).bucket).toBe("imbox");
    expect(gmailCalls()).toEqual([]);
    expect(await bulk({ action: "move", bucket: "nowhere" })).toEqual({ status: 200, body: { ok: true, count: 0 } });
    expect(await bulk({ action: "move" })).toEqual({ status: 200, body: { ok: true, count: 0 } });
    expect(by(await state([A1]), A1).bucket).toBe("feed");
  });

  it("trashing clears Reply Later and Set Aside, and trashes at Gmail only the threads in a Gmail mailbox; moving back out untrashes them", async () => {
    await db().prepare(`UPDATE threads SET reply_later = 1, reply_later_at = 5 WHERE id IN (?, ?)`).bind(A1, G1).run();
    await db().prepare(`UPDATE threads SET set_aside = 1, set_aside_at = 5 WHERE id = ?`).bind(A2).run();
    expect(await bulk({ action: "move", bucket: "trash" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    await new Promise((r) => setTimeout(r, 20));
    for (const x of await state([A1, A2, G1])) expect(x).toMatchObject({ bucket: "trash", reply_later: 0, set_aside: 0 });
    const gid = (await q<any>(`SELECT gmail_thread_id FROM threads WHERE id = ?`, G1))[0].gmail_thread_id;
    expect(gmailCalls()).toEqual([`POST threads/${gid}/trash`]);
    fetchMock.mockClear();
    expect(await bulk({ action: "move", bucket: "imbox" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(gmailCalls()).toEqual([`POST threads/${gid}/untrash`]);
    for (const x of await state([A1, A2, G1])) expect(x.bucket).toBe("imbox");
  });
});

describe("labels and collections, for many", () => {
  it("adds and removes a label on each thread, ignoring a label that is not the user's", async () => {
    const mine = nid("l");
    const theirs = nid("l");
    await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES (?, ?, 'Mine', 1), (?, 'a-foreign', 'Theirs', 1)`).bind(mine, w.imap, theirs).run();
    expect(await bulk({ action: "labels", add: [mine, theirs] })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    expect(await q<any>(`SELECT thread_id, label_id FROM thread_labels WHERE label_id IN (?, ?) ORDER BY thread_id`, mine, theirs)).toEqual([A1, A2, G1].sort().map((t) => ({ thread_id: t, label_id: mine })));
    // Adding again changes nothing; removing takes it from each.
    await bulk({ action: "labels", add: [mine] });
    expect((await q<any>(`SELECT count(*) AS n FROM thread_labels WHERE label_id = ?`, mine))[0].n).toBe(3);
    expect(await bulk({ action: "labels", remove: [mine] })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    expect(await q(`SELECT 1 FROM thread_labels WHERE label_id = ?`, mine)).toEqual([]);
  });

  it("adds and removes a collection on each thread, and stamps the collection", async () => {
    const col = nid("co");
    await db().prepare(`INSERT INTO collections (id, account_id, name, created_at, updated_at) VALUES (?, ?, 'Q4', 1, 1)`).bind(col, w.imap).run();
    expect(await bulk({ action: "collections", add: [col] })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    expect((await q<any>(`SELECT count(*) AS n FROM collection_threads WHERE collection_id = ?`, col))[0].n).toBe(3);
    expect((await q<any>(`SELECT updated_at FROM collections WHERE id = ?`, col))[0].updated_at).toBeGreaterThan(1);
    expect(await bulk({ action: "collections", remove: [col] })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    expect(await q(`SELECT 1 FROM collection_threads WHERE collection_id = ?`, col)).toEqual([]);
  });
});

describe("deleting many", () => {
  it("removes each thread and what hangs off it, and the threads merged into it, and trashes the Gmail ones at Gmail", async () => {
    const merged = (await seedThread(w.gmail, { subject: "Merged in", from: "m@example.org" })).thread;
    await db().prepare(`UPDATE threads SET merged_into = ? WHERE id = ?`).bind(G1, merged).run();
    const lab = nid("l");
    await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES (?, ?, 'L', 1)`).bind(lab, w.imap).run();
    await db().prepare(`INSERT INTO thread_labels (thread_id, label_id) VALUES (?, ?)`).bind(A1, lab).run();
    await db().prepare(`INSERT INTO clips (id, account_id, thread_id, message_id, text, created_at) VALUES (?, ?, ?, 'm', 'c', 1)`).bind(nid("cl"), w.imap, A2).run();
    expect(await bulk({ action: "delete" })).toEqual({ status: 200, body: { ok: true, count: 3 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await q(`SELECT id FROM threads WHERE id IN (?, ?, ?, ?)`, A1, A2, G1, merged)).toEqual([]);
    expect(await q(`SELECT 1 FROM messages WHERE thread_id IN (?, ?, ?, ?)`, A1, A2, G1, merged)).toEqual([]);
    expect(await q(`SELECT 1 FROM thread_labels WHERE thread_id = ?`, A1)).toEqual([]);
    expect(await q(`SELECT 1 FROM clips WHERE thread_id = ?`, A2)).toEqual([]);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE id = ?`, F1))[0].n).toBe(1);
    const calls = gmailCalls();
    expect(calls.length).toBe(2);
    expect(calls.every((c) => /^POST threads\/.+\/trash$/.test(c))).toBe(true);
  });

  it("empties the trash of the person's mailboxes in rounds, leaving the rest", async () => {
    const trashed = [];
    for (let i = 0; i < 5; i++) trashed.push((await seedThread(i % 2 ? w.gmail : w.imap, { subject: `Gone ${i}`, from: "x@example.org" })).thread);
    await db().prepare(`UPDATE threads SET bucket = 'trash' WHERE id IN (${trashed.map(() => "?").join(",")})`).bind(...trashed).run();
    await db().prepare(`UPDATE threads SET bucket = 'trash' WHERE id = ?`).bind(F1).run();
    const res = await as("POST", "/api/threads/empty-trash", {});
    await new Promise((r) => setTimeout(r, 20));
    expect(await res.json()).toEqual({ ok: true, deleted: 5 });
    expect(await q(`SELECT id FROM threads WHERE id IN (${trashed.map(() => "?").join(",")})`, ...trashed)).toEqual([]);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE id IN (?, ?, ?)`, A1, A2, G1))[0].n).toBe(3);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE id = ?`, F1))[0].n).toBe(1);
    expect(gmailCalls().length).toBe(2);
  });
});

describe("what bulk refuses", () => {
  it("no threads, merge, an unknown action, and more than the limit of ids", async () => {
    expect(await bulk({ action: "seen" }, [])).toEqual({ status: 400, body: { error: "no_threads" } });
    expect(await bulk({ action: "merge" })).toEqual({ status: 400, body: { error: "use_thread_action" } });
    expect(await bulk({ action: "explode" })).toEqual({ status: 200, body: { ok: true, count: 0 } });
    const many = Array.from({ length: 250 }, (_, i) => `x${i}`);
    const r = await bulk({ action: "seen" }, [A1, ...many]);
    expect(r.body.count).toBe(1);
  });

  it("bundle still goes thread by thread: it bundles each sender", async () => {
    const r = await bulk({ action: "bundle" }, [A1, A2]);
    expect(r).toEqual({ status: 200, body: { ok: true, count: 2 } });
    expect((await q<any>(`SELECT email FROM contacts WHERE account_id = ? AND bundled = 1 ORDER BY email`, w.imap)).map((c) => c.email)).toEqual(["a1@example.org", "a2@example.org"]);
  });
});

describe("how many threads at once is asked", () => {
  it("is a few statements, not several for each thread", async () => {
    const list: string[] = [];
    for (let i = 0; i < 40; i++) list.push((await seedThread(w.imap, { subject: `Many ${i}`, from: `many${i}@example.org` })).thread);
    for (const body of [{ action: "seen" }, { action: "reply_later" }, { action: "set_aside" }, { action: "move", bucket: "feed" }, { action: "mark_unread" }]) {
      resetStatements();
      const r = await bulk(body, list);
      expect(r.body.count, JSON.stringify(body)).toBe(40);
      expect(sent.statements, JSON.stringify(body)).toBeLessThan(14);
    }
  });
});

describe.skipIf(!process.env.TIME_BULK)("timing (TIME_BULK=1 TEST_DB_LATENCY_MS=5)", () => {
  it("many threads at once", async () => {
    const list: string[] = [];
    for (let i = 0; i < 100; i++) list.push((await seedThread(w.imap, { subject: `Time ${i}`, from: `time${i}@example.org` })).thread);
    for (const body of [{ action: "seen" }, { action: "reply_later" }, { action: "move", bucket: "trash" }, { action: "delete" }]) {
      resetStatements();
      const t0 = performance.now();
      const r = await bulk(body, list);
      console.log(`TIMING ${JSON.stringify(body)}: count ${r.body.count}, ${sent.statements} statements, ${(performance.now() - t0).toFixed(0)} ms`);
    }
  });
});
