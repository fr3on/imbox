import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, nid, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount, seedMessage } from "../agent-fixtures";
import { contactInsights } from "../../src/api/contactInsights";
import { resetStatements, sent } from "../support/pgenv";

/**
 * People: the contacts list and its search, the compose suggestions, the lookups by address, the page of one person (their threads) and what the mail says
 * about them (insights), and changing a contact. Pinned before the queries that find a person's mail were given indexes.
 */

const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
let token: string;
const as = (method: string, path: string, body?: unknown) => call(method, path, { token, ...(body === undefined ? {} : { body }) });
const get = async (path: string) => json(await as("GET", path));
const NOW = 1_790_000_000_000;
const DAY = 86_400_000;

const contact = (id: string, account: string, email: string, o: { name?: string; status?: string; seen?: number; count?: number; notes?: string; avatar?: string; bundled?: number } = {}) =>
  db()
    .prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, message_count, notes, avatar_url, bundled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, account, email, o.name ?? "", o.status ?? "imbox", 1, o.seen ?? 1, o.count ?? 1, o.notes ?? "", o.avatar ?? "", o.bundled ?? 0)
    .run();

/** A message in a thread, with who it is from and to; the thread learns its people the way ingest teaches it. */
async function mail(o: { id: string; thread: string; account?: string; from: string; to?: string[]; cc?: string[]; date: number; me?: boolean; bulk?: boolean; bucket?: string; subject?: string }) {
  const account = o.account ?? "k1";
  await seedMessage(account, { id: o.id, threadId: o.thread, subject: o.subject ?? `Subject ${o.thread}`, date: o.date, from: o.from, fromMe: o.me, to: (o.to ?? ["me@test.local"]).map((e) => ({ email: e, name: "" })), cc: (o.cc ?? []).map((e) => ({ email: e, name: "" })) });
  await db().prepare(`UPDATE messages SET list_unsubscribe = ? WHERE id = ?`).bind(o.bulk ? "<mailto:u@x.test>" : "", o.id).run();
  const people = [o.from, ...(o.to ?? ["me@test.local"]), ...(o.cc ?? [])].map((email) => ({ email, name: "" }));
  const prev = (await q<any>(`SELECT participants_json FROM threads WHERE id = ?`, o.thread))[0]?.participants_json ?? "[]";
  const merged = [...new Map([...JSON.parse(prev), ...people].map((p: any) => [p.email, p])).values()];
  await db().prepare(`UPDATE threads SET participants_json = ?, last_from_email = ?, last_message_at = GREATEST(last_message_at, ?), bucket = ? WHERE id = ?`).bind(JSON.stringify(merged), o.from, o.date, o.bucket ?? "imbox", o.thread).run();
}

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("uk1");
  await signIn("uk2");
  await seedAccount("k1", "me@test.local", { user: "uk1" });
  await seedAccount("k2", "me2@test.local", { user: "uk1" });
  await seedAccount("k-other", "other@test.local", { user: "uk2" });
  // Alice is in both mailboxes and they disagree; Bob only in one; Carol is pending; Dana's row has notes; a stranger belongs to someone else.
  await contact("c-alice-1", "k1", "alice@x.test", { name: "Alice Anders", status: "imbox", seen: 500, count: 3, notes: "met at the fair", avatar: "https://pics.test/alice.png", bundled: 1 });
  await contact("c-alice-2", "k2", "alice@x.test", { name: "", status: "feed", seen: 900, count: 2 });
  await contact("c-bob", "k1", "bob@y.test", { name: "Bob Brown", seen: 700, count: 5 });
  await contact("c-carol", "k1", "carol@z.test", { name: "Carol", status: "pending", seen: 800 });
  await contact("c-dana", "k1", "dana@w.test", { name: "Dana", seen: 100, notes: "likes ALICE's work" });
  await contact("c-theirs", "k-other", "alice@x.test", { name: "Alice of theirs", seen: 999 });
  await db().prepare(`INSERT INTO address_book (account_id, email, name, avatar_url, updated_at) VALUES ('k1', 'alina@book.test', 'Alina Book', 'https://pics.test/alina.png', 1), ('k1', 'bob@y.test', 'Bob From Book', 'https://pics.test/bobbook.png', 1), ('k2', 'zed@book.test', 'Zed', '', 1), ('k-other', 'alicia@theirs.test', 'Alicia Theirs', '', 1)`).run();
  // Mail with Alice: three threads. She wrote to me, I wrote to her and she is cc'd on one more; one thread is bulk; Bob appears in one.
  await mail({ id: "m1", thread: "ta1", from: "alice@x.test", date: NOW - 5 * DAY, subject: "Plan" });
  await mail({ id: "m2", thread: "ta2", from: "me@test.local", to: ["alice@x.test"], date: NOW - 10 * DAY, me: true, subject: "Question" });
  await mail({ id: "m3", thread: "ta3", from: "bob@y.test", to: ["me@test.local"], cc: ["alice@x.test"], date: NOW - 40 * DAY, subject: "Fyi" });
  await mail({ id: "m4", thread: "ta4", from: "alice@x.test", date: NOW - 60 * DAY, bulk: true, subject: "Newsletter" });
  await mail({ id: "m5", thread: "ta5", from: "bob@y.test", date: NOW - 2 * DAY, subject: "Only Bob" });
  await mail({ id: "m6", thread: "ta6", from: "alice@x.test", date: NOW - 400 * DAY, subject: "Old" });
  await mail({ id: "m7", thread: "ta1", from: "me@test.local", to: ["alice@x.test"], date: NOW - 4 * DAY, me: true, subject: "Plan" });
  await mail({ id: "m8", thread: "ta7", from: "alice@x.test", account: "k2", to: ["me2@test.local"], date: NOW - 20 * DAY, subject: "Other box" });
  await mail({ id: "m9", thread: "ta8", from: "alice@x.test", date: NOW - 3 * DAY, bucket: "trash", subject: "Trashed" });
  await db().prepare(`UPDATE threads SET merged_into = 'ta1' WHERE id = 'ta6'`).run();
  await db().prepare(`INSERT INTO attachments (id, account_id, message_id, thread_id, gmail_attachment_id, filename, size, created_at, is_inline) VALUES ('f1', 'k1', 'm1', 'ta1', 'g1', 'plan.pdf', 10, ?, 0), ('f2', 'k1', 'm2', 'ta2', 'g2', 'logo.png', 5, ?, 1), ('f3', 'k1', 'm3', 'ta3', 'g3', 'fyi.doc', 7, ?, 0)`).bind(NOW, NOW, NOW).run();
});

describe("the list of people", () => {
  it("one entry for each person, not each mailbox, pending last, then the most recent", async () => {
    const out = await get("/api/contacts");
    expect(out.map((c: any) => c.email)).toEqual(["alice@x.test", "bob@y.test", "dana@w.test", "carol@z.test"]);
    const alice = out[0];
    expect(alice).toMatchObject({ name: "Alice Anders", notes: "met at the fair", avatar_url: "https://pics.test/alice.png", message_count: 5, mixed: true, first_seen_at: 1, last_seen_at: 900 });
    expect(alice.accounts.map((a: any) => [a.account_id, a.screen_status])).toEqual([["k2", "feed"], ["k1", "imbox"]]);
  });

  it("searching finds a person by address or name, in any case, and not by their notes", async () => {
    expect((await get("/api/contacts?q=ALICE")).map((c: any) => c.email)).toEqual(["alice@x.test"]);
    expect((await get("/api/contacts?q=brown")).map((c: any) => c.email)).toEqual(["bob@y.test"]);
    expect((await get("/api/contacts?q=y.tes")).map((c: any) => c.email)).toEqual(["bob@y.test"]);
    expect(await get("/api/contacts?q=fair")).toEqual([]);
    expect(await get("/api/contacts?q=nobody")).toEqual([]);
  });

  it("never lists another person's contacts", async () => {
    const all = JSON.stringify(await get("/api/contacts"));
    expect(all).not.toContain("of theirs");
  });
});

describe("compose suggestions", () => {
  it("contacts and the address book together, each address once, the name from the contact first", async () => {
    const out = await get("/api/contacts/suggest?q=b");
    expect(out.map((c: any) => c.email).sort()).toEqual(["alina@book.test", "bob@y.test", "zed@book.test"]);
    const bob = out.find((c: any) => c.email === "bob@y.test");
    expect(bob).toMatchObject({ name: "Bob Brown", avatar_url: "https://pics.test/bobbook.png" });
  });

  it("nothing for nothing, and only the user's own address book", async () => {
    expect(await get("/api/contacts/suggest?q=")).toEqual([]);
    expect(await get("/api/contacts/suggest?q=alici")).toEqual([]);
    expect((await get("/api/contacts/suggest?q=zed")).map((c: any) => c.email)).toEqual(["zed@book.test"]);
  });

  it("a few at most, the newest contacts first", async () => {
    for (let i = 0; i < 14; i++) await contact(nid("c"), "k1", `many${i}@s.test`, { name: `Many ${i}`, seen: 2000 + i });
    const out = await get("/api/contacts/suggest?q=many");
    expect(out.length).toBe(10);
    expect(out[0].email).toBe("many13@s.test");
  });
});

describe("looking a person up by address", () => {
  it("finds the contact, preferring the mailbox asked for, and makes a pending one when there is none", async () => {
    // Without a mailbox asked for, the user's first is preferred; asking for another gives that one.
    expect(await get("/api/contacts/by-email?email=Alice@x.test")).toEqual({ id: "c-alice-1", account_id: "k1" });
    expect(await get("/api/contacts/by-email?email=alice@x.test&account_id=k2")).toEqual({ id: "c-alice-2", account_id: "k2" });
    const made = await get("/api/contacts/by-email?email=new@q.test&name=New%20Person");
    expect(made.account_id).toBe("k1");
    expect(await q(`SELECT email, name, screen_status FROM contacts WHERE id = ?`, made.id)).toEqual([{ email: "new@q.test", name: "New Person", screen_status: "pending" }]);
    expect((await get("/api/contacts/by-email?email=new@q.test")).id).toBe(made.id);
    expect((await as("GET", "/api/contacts/by-email?email=nonsense")).status).toBe(400);
  });

  it("peek: what the hover card shows, and nothing is made", async () => {
    expect(await get("/api/contacts/peek?email=ghost@q.test")).toEqual({ known: false, email: "ghost@q.test" });
    expect(await q(`SELECT 1 FROM contacts WHERE email = 'ghost@q.test'`)).toEqual([]);
    const p = await get("/api/contacts/peek?email=alice@x.test");
    expect(p).toMatchObject({ known: true, id: "c-alice-2", name: "Alice Anders", avatar_url: "https://pics.test/alice.png", screen_status: "mixed", message_count: 5, mailboxes: 2, note: "met at the fair" });
    expect((await get("/api/contacts/peek?email=bob@y.test")).screen_status).toBe("imbox");
  });
});

describe("the page of one person", () => {
  it("the person across mailboxes, and their threads: where they are a participant or wrote, not merged, the unread first and then the newest", async () => {
    const out = await get("/api/contacts/c-alice-1");
    expect(out.contact).toMatchObject({ id: "c-alice-1", account_id: "k1", email: "alice@x.test", mixed: true });
    const subjects = out.threads.map((t: any) => t.subject);
    expect(subjects.sort()).toEqual(["Fyi", "Newsletter", "Other box", "Plan", "Question", "Trashed"]);
    expect(subjects).not.toContain("Only Bob");
    expect(subjects).not.toContain("Old");
  });

  it("the unread come before the read, and each group newest first", async () => {
    await db().prepare(`UPDATE threads SET seen = 1 WHERE id IN ('ta1', 'ta3')`).run();
    const out = await get("/api/contacts/c-alice-1");
    expect(out.threads.map((t: any) => t.seen)).toEqual([false, false, false, false, true, true]);
    const unread = out.threads.filter((t: any) => !t.seen).map((t: any) => t.last_message_at);
    expect(unread).toEqual([...unread].sort((a, b) => b - a));
  });

  it("can be narrowed to one place, and is not given for another person's contact", async () => {
    expect((await get("/api/contacts/c-alice-1?bucket=trash")).threads.map((t: any) => t.subject)).toEqual(["Trashed"]);
    expect((await as("GET", "/api/contacts/c-theirs")).status).toBe(404);
    expect((await as("GET", "/api/contacts/nope")).status).toBe(404);
  });

  it("finds a person who only ever wrote a message, even when the thread does not list them", async () => {
    await db().prepare(`UPDATE threads SET participants_json = '[]' WHERE id = 'ta4'`).run();
    expect((await get("/api/contacts/c-alice-1")).threads.map((t: any) => t.subject)).toContain("Newsletter");
  });
});

describe("what the mail says about a person", () => {
  const insights = (email: string, accounts = ["k1", "k2"]) => contactInsights(db(), accounts, email, NOW);

  it("what waits on you, what waits on them, the months, the conversations", async () => {
    const i = await insights("alice@x.test");
    // Waiting on you: the newest message of the thread is not mine and not bulk, oldest first (Fyi, where she was copied, and Other box). Newsletter is bulk and Trashed is
    // in the trash. Waiting on them: I wrote last, two days ago or more (Plan four days ago, Question ten).
    expect(i.waiting_on_you.map((x) => x.subject)).toEqual(["Fyi", "Other box"]);
    expect(i.waiting_on_them.map((x) => x.subject)).toEqual(["Question", "Plan"]);
    expect(i.conversations).toBe(6);
    expect(i.months.reduce((n, m) => n + m.n, 0)).toBe(7);
    expect(i.busiest?.n).toBeGreaterThan(0);
  });

  it("the files swapped: not the inline pictures, the newest first, and how many", async () => {
    const i = await insights("alice@x.test");
    expect(i.files.map((f) => f.filename).sort()).toEqual(["fyi.doc", "plan.pdf"]);
    expect(i.file_count).toBe(2);
  });

  it("only the mailboxes asked for, and nobody else's mail", async () => {
    expect((await insights("alice@x.test", ["k2"])).conversations).toBe(1);
    expect((await insights("nobody@x.test")).conversations).toBe(0);
    expect(await insights("alice@x.test", [])).toMatchObject({ conversations: 0, files: [], months: [] });
  });

  it("through the route, for a contact that is the user's", async () => {
    expect((await get("/api/contacts/c-alice-1/insights")).conversations).toBeGreaterThan(0);
    expect((await as("GET", "/api/contacts/c-theirs/insights")).status).toBe(404);
  });
});

describe("changing a person", () => {
  it("name and notes, and the decision for every mailbox, answered with the merged person", async () => {
    const out = await json(await as("PATCH", "/api/contacts/c-bob", { name: "Robert", notes: "owes lunch", screen_status: "feed", scope: "all" }));
    expect(out).toMatchObject({ id: "c-bob", name: "Robert", notes: "owes lunch", screen_status: "feed" });
    expect((await q<any>(`SELECT name, notes, screen_status FROM contacts WHERE id = 'c-bob'`))[0]).toEqual({ name: "Robert", notes: "owes lunch", screen_status: "feed" });
    expect((await as("PATCH", "/api/contacts/c-theirs", { name: "x" })).status).toBe(404);
  });

  it("bundling a sender", async () => {
    const out = await json(await as("PATCH", "/api/contacts/c-bob", { bundled: true, scope: "all" }));
    expect(out.bundled).toBe(true);
  });
});

describe("how many statements", () => {
  it("the list, the page of a person and their insights are a few each", async () => {
    for (const path of ["/api/contacts", "/api/contacts?q=ali", "/api/contacts/suggest?q=ali", "/api/contacts/c-alice-1", "/api/contacts/c-alice-1/insights"]) {
      resetStatements();
      expect((await as("GET", path)).status).toBe(200);
      expect(sent.statements, path).toBeLessThan(14);
    }
  });
});
