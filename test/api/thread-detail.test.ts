import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount, seedMessage } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * Opening a thread: what the page is given (messages in order, merged threads, files, labels, collections, clips, pictures, whether the sender is bundled),
 * and what opening does (marks it read, says which messages were new). Pinned before the queries behind it were run together.
 */

const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
let token: string;
const gmailCalls: { url: string; body: any }[] = [];

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("u1");
  await signIn("u2");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    gmailCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response("{}", { status: 200 });
  });
  await seedAccount("a1", "one@test.local", { user: "u1" });
  await seedAccount("a2", "two@test.local", { user: "u2" });
  await seedAccount("g1", "gm@test.local", { user: "u1", provider: "gmail" });
  await db().prepare(`UPDATE accounts SET access_token = 'tok', token_expires_at = ? WHERE id = 'g1'`).bind(Date.now() + 3_600_000).run();

  // A thread with one message read and written by me, two unread from others, and a thread merged into it.
  await seedMessage("a1", { id: "m1", threadId: "t1", subject: "Plan", date: 1000, fromMe: true, unread: false, from: "one@test.local" });
  await seedMessage("a1", { id: "m2", threadId: "t1", subject: "Plan", date: 3000, from: "alice@x.test", fromName: "Alice" });
  await seedMessage("a1", { id: "m3", threadId: "t1", subject: "Plan", date: 4000, from: "bob@x.test", fromName: "Bob" });
  await seedMessage("a1", { id: "m4", threadId: "t-merged", subject: "Plan again", date: 2000, from: "alice@x.test", fromName: "Alice", unread: false });
  await db().prepare(`UPDATE threads SET merged_into = 't1' WHERE id = 't-merged'`).run();
  await db().prepare(`UPDATE threads SET last_from_email = 'alice@x.test', participants_json = ? WHERE id = 't1'`).bind(JSON.stringify([{ email: "alice@x.test", name: "Alice" }, { email: "bob@x.test", name: "Bob" }])).run();
  await db().prepare(`INSERT INTO attachments (id, account_id, message_id, thread_id, gmail_attachment_id, filename, mime_type, size, created_at) VALUES ('at1', 'a1', 'm2', 't1', 'ga1', 'plan.pdf', 'application/pdf', 10, 1)`).run();
  await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES ('l1', 'a1', 'Work', 1)`).run();
  await db().prepare(`INSERT INTO thread_labels (thread_id, label_id) VALUES ('t1', 'l1')`).run();
  await db().prepare(`INSERT INTO collections (id, account_id, name, created_at, updated_at) VALUES ('co1', 'a1', 'Q4', 1, 1)`).run();
  await db().prepare(`INSERT INTO collection_threads (collection_id, thread_id, added_at) VALUES ('co1', 't1', 1)`).run();
  await db().prepare(`INSERT INTO clips (id, account_id, thread_id, message_id, text, created_at) VALUES ('cl1', 'a1', 't1', 'm2', 'a clip', 1)`).run();
  await db().prepare(`INSERT INTO contacts (id, account_id, email, name, avatar_url, bundled, first_seen_at, last_seen_at) VALUES ('c-alice', 'a1', 'alice@x.test', 'Alice', 'https://pics.test/alice.png', 1, 1, 1)`).run();
  await db().prepare(`INSERT INTO address_book (account_id, email, name, avatar_url, updated_at) VALUES ('a1', 'bob@x.test', 'Bob', 'https://pics.test/bob.png', 1)`).run();

  // A thread in an account of Gmail, one message unread.
  await seedMessage("g1", { id: "gm1", threadId: "gt1", subject: "From Gmail", date: 5000, from: "carol@x.test" });
  await seedMessage("g1", { id: "gm2", threadId: "gt1", subject: "From Gmail", date: 6000, from: "carol@x.test", unread: false });
  // A thread nobody has read, and one in someone else's account.
  await seedMessage("a1", { id: "n1", threadId: "t-new", subject: "Brand new", date: 7000, from: "dave@x.test" });
  await seedMessage("a2", { id: "o1", threadId: "t-other", subject: "Theirs", date: 8000 });
});

afterAll(() => vi.unstubAllGlobals());

const open = async (id: string, peek = false) => {
  const res = await call("GET", `/api/threads/${id}${peek ? "?peek=1" : ""}`, { token });
  return { status: res.status, body: await json(res) };
};

describe("what the page is given", () => {
  it("the messages of the thread and of the threads merged into it, oldest first, each with its own files", async () => {
    const { status, body } = await open("t1", true);
    expect(status).toBe(200);
    expect(body.messages.map((m: any) => m.id)).toEqual(["m1", "m4", "m2", "m3"]);
    expect(body.messages.find((m: any) => m.id === "m2").attachments.map((a: any) => a.filename)).toEqual(["plan.pdf"]);
    expect(body.messages.find((m: any) => m.id === "m3").attachments).toEqual([]);
    expect(body.merged_threads).toEqual([{ id: "t-merged", subject: "Plan again" }]);
  });

  it("labels, collections, clips, and whether the sender is bundled", async () => {
    const { body } = await open("t1", true);
    expect(body.labels.map((l: any) => l.name)).toEqual(["Work"]);
    expect(body.collections).toEqual([{ id: "co1", name: "Q4" }]);
    expect(body.clips.map((k: any) => k.text)).toEqual(["a clip"]);
    expect(body.sender_bundled).toBe(true);
    expect((await open("t-new", true)).body.sender_bundled).toBe(false);
  });

  it("pictures: a sender who is a contact, one who is only in the address book, and the people on the thread", async () => {
    const { body } = await open("t1", true);
    expect(body.messages.find((m: any) => m.id === "m2").from.avatar_url).toBe("https://pics.test/alice.png");
    expect(body.messages.find((m: any) => m.id === "m3").from.avatar_url).toBe("https://pics.test/bob.png");
    expect(body.last_from.avatar_url).toBe("https://pics.test/alice.png");
    expect(body.participants.map((p: any) => p.avatar_url)).toEqual(["https://pics.test/alice.png", "https://pics.test/bob.png"]);
  });

  it("a hint to move a Feed thread to the Imbox is on the thread, until it is dismissed or the thread has a new message", async () => {
    await seedMessage("a1", { id: "h1", threadId: "t-hint", subject: "Newsletter", date: 9100, from: "news@x.test" });
    await db().prepare(`UPDATE threads SET bucket = 'feed', last_message_at = 9100 WHERE id = 't-hint'`).run();
    await db().prepare(`INSERT INTO imbox_hints (thread_id, user_id, verdict, reason, source, dismissed, last_message_at, created_at) VALUES ('t-hint', 'u1', 'move', 'You wrote to them', 'rules', 0, 9100, 1)`).run();
    expect((await open("t-hint", true)).body.imbox_hint).toEqual({ reason: "You wrote to them", source: "rules" });
    expect((await open("t1", true)).body.imbox_hint ?? null).toBeNull();
    await db().prepare(`UPDATE imbox_hints SET dismissed = 1 WHERE thread_id = 't-hint'`).run();
    expect((await open("t-hint", true)).body.imbox_hint ?? null).toBeNull();
  });

  it("is not given for another person's thread, or one that is not there", async () => {
    expect((await open("t-other")).status).toBe(404);
    expect((await open("nope")).status).toBe(404);
  });
});

describe("opening a thread", () => {
  it("a peek changes nothing, and says which messages are new since the last read", async () => {
    const before = await q(`SELECT seen, unread FROM threads WHERE id = 't1'`);
    const { body } = await open("t1", true);
    expect(await q(`SELECT seen, unread FROM threads WHERE id = 't1'`)).toEqual(before);
    expect(body.was_seen).toBe(true);
    expect(body.new_message_ids).toEqual(["m2", "m3"]);
    expect(body.messages.filter((m: any) => m.unread).map((m: any) => m.id)).toEqual(["m2", "m3"]);
  });

  it("opening marks the thread and its messages read, and answers with what was new", async () => {
    const readBefore = (await q<{ x: string }>(`SELECT xmin::text AS x FROM messages WHERE id = 'm1'`))[0].x;
    const { body } = await open("t1");
    expect(body.seen).toBe(true);
    expect(body.unread).toBe(false);
    expect(body.was_seen).toBe(true);
    expect(body.new_message_ids).toEqual(["m2", "m3"]);
    expect(body.messages.every((m: any) => !m.unread)).toBe(true);
    expect(await q(`SELECT seen, unread FROM threads WHERE id = 't1'`)).toEqual([{ seen: 1, unread: 0 }]);
    expect(await q(`SELECT id FROM messages WHERE thread_id = 't1' AND unread = 1`)).toEqual([]);
    // A message that was already read is not written again.
    expect((await q<{ x: string }>(`SELECT xmin::text AS x FROM messages WHERE id = 'm1'`))[0].x).toBe(readBefore);
  });

  it("opening it again changes nothing", async () => {
    await open("t1");
    const updated = await q(`SELECT updated_at FROM threads WHERE id = 't1'`);
    resetStatements();
    const { body } = await open("t1");
    expect(body.seen).toBe(true);
    expect(await q(`SELECT updated_at FROM threads WHERE id = 't1'`)).toEqual(updated);
    expect(sent.sql.filter((s) => /^UPDATE (threads|messages)/.test(s))).toEqual([]);
  });

  it("a thread never read has nothing to catch up on: it is simply new", async () => {
    const { body } = await open("t-new");
    expect(body.was_seen).toBe(false);
    expect(body.new_message_ids).toEqual([]);
    expect(await q(`SELECT seen, unread FROM threads WHERE id = 't-new'`)).toEqual([{ seen: 1, unread: 0 }]);
  });

  it("in a Gmail account, the messages that were unread are marked read at Gmail, and only those", async () => {
    gmailCalls.length = 0;
    const { body } = await open("gt1");
    expect(body.messages.every((m: any) => !m.unread)).toBe(true);
    const batch = gmailCalls.filter((c) => c.url.includes("messages/batchModify"));
    expect(batch.length).toBe(1);
    expect(batch[0].body).toEqual({ ids: ["g-gm1"], removeLabelIds: ["UNREAD"] });
  });

  it("an account that is not Gmail's is not asked", async () => {
    gmailCalls.length = 0;
    await seedMessage("a1", { id: "x1", threadId: "t-x", subject: "Imap", date: 9000 });
    await open("t-x");
    expect(gmailCalls).toEqual([]);
  });
});

describe("how it asks", () => {
  it("does not ask which messages are unread when it has just read them", async () => {
    await seedMessage("a1", { id: "y1", threadId: "t-y", subject: "Again", date: 9500 });
    resetStatements();
    await open("t-y");
    expect(sent.sql.filter((s) => /SELECT gmail_message_id FROM messages/.test(s))).toEqual([]);
  });
});

describe.skipIf(!process.env.TIME_THREAD)("timing (TIME_THREAD=1 TEST_DB_LATENCY_MS=5)", () => {
  it("opens a thread", async () => {
    await open("t1", true);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) await open("t1", true);
    console.log(`TIMING peek ${((performance.now() - t0) / 10).toFixed(1)} ms each`);
    resetStatements();
    await open("t1", true);
    console.log(`TIMING statements ${sent.statements}, round trips ${sent.roundTrips}`);
  });
});
