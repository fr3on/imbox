import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, nid, seedThread, signIn, testEnv, wipeAll, migrate } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * Bundles: what the Imbox and Updates show of a bundle (its newest thread, how many threads and messages, the name and picture), the bundle page, and
 * what marking it seen, reopening it and dissolving it do. Pinned before the lookups behind them were joined.
 */

const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
let token: string;
let fetchMock: ReturnType<typeof vi.fn>;
const as = (method: string, path: string) => call(method, path, { token });
const T0 = Date.now() - 86_400_000;
const gmailCalls = () => fetchMock.mock.calls.map((c) => ({ url: String(c[0]).replace(/^.*\/gmail\/v1\/users\/me\//, ""), body: JSON.parse(String((c[1] as RequestInit).body)) }));

/** A thread in a bundle, with `n` messages (older first), the newest from the sender. */
async function inBundle(account: string, bundle: string, from: string, subject: string, at: number, o: { bucket?: string; messages?: number; set?: string } = {}) {
  const { thread } = await seedThread(account, { subject, from, bucket: o.bucket ?? "imbox" });
  await db().prepare(`UPDATE threads SET bundle_id = ?, last_message_at = ?, first_message_at = ?, last_from_name = ?, message_count = ?${o.set ? `, ${o.set}` : ""} WHERE id = ?`).bind(bundle, at, at - 1000, from.split("@")[0], o.messages ?? 1, thread).run();
  await db().prepare(`UPDATE messages SET date = ? WHERE thread_id = ?`).bind(at, thread).run();
  return thread;
}
const bundle = (id: string, account: string, contact: string, email: string, status = "open") =>
  db().prepare(`INSERT INTO bundles (id, account_id, contact_id, email, status, thread_count, message_count, first_message_at, last_message_at, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, 1, 1, 1)`).bind(id, account, contact, email, status).run();


beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("ub1");
  await signIn("ub2");
  await seedAccount("b1", "one@test.local", { user: "ub1" });
  await seedAccount("b-gm", "gm@test.local", { user: "ub1", provider: "gmail" });
  await seedAccount("b-other", "other@test.local", { user: "ub2" });
  await db().prepare(`UPDATE accounts SET access_token = 'tok', refresh_token = 'rtok', token_expires_at = ?, scopes = 'https://www.googleapis.com/auth/gmail.modify' WHERE id = 'b-gm'`).bind(Date.now() + 3_600_000).run();
  const c = (id: string, account: string, email: string, name: string, avatar: string) =>
    db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, avatar_url, bundled) VALUES (?, ?, ?, ?, 'imbox', 1, 1, ?, 1)`).bind(id, account, email, name, avatar).run();
  await c("c-news", "b1", "news@x.test", "The News", "https://pics.test/news.png");
  await c("c-bill", "b1", "bills@x.test", "", "");
  await c("c-gm", "b-gm", "gm@x.test", "Gmail Sender", "");
  await bundle("bd-news", "b1", "c-news", "news@x.test");
  await bundle("bd-bill", "b1", "c-bill", "bills@x.test");
  await bundle("bd-gm", "b-gm", "c-gm", "gm@x.test");
  await bundle("bd-empty", "b1", "c-news", "empty@x.test");
  // The news bundle: three visible threads in the Imbox (the newest has two messages), one merged, one in Reply Later, one bubbled up for later, one set aside.
  await inBundle("b1", "bd-news", "news@x.test", "News one", T0 + 1000, { messages: 2 });
  await inBundle("b1", "bd-news", "news@x.test", "News two", T0 + 3000);
  await inBundle("b1", "bd-news", "news@x.test", "News three", T0 + 2000);
  await inBundle("b1", "bd-news", "news@x.test", "Merged", T0 + 9000, { set: "merged_into = 'x'" });
  await inBundle("b1", "bd-news", "news@x.test", "Later", T0 + 9100, { set: "reply_later = 1" });
  await inBundle("b1", "bd-news", "news@x.test", "Bubbled", T0 + 9200, { set: `bubble_up_at = ${Date.now() + 86_400_000}` });
  await inBundle("b1", "bd-news", "news@x.test", "Aside", T0 + 9300, { set: "set_aside = 1" });
  // The bills bundle lives in Paper Trail; a contact with no name or picture.
  await inBundle("b1", "bd-bill", "bills@x.test", "Invoice 1", T0 + 500, { bucket: "paper_trail" });
  await inBundle("b1", "bd-bill", "bills@x.test", "Invoice 2", T0 + 600, { bucket: "paper_trail" });
  // A Gmail bundle with one message from the sender and one of mine.
  const g = await inBundle("b-gm", "bd-gm", "gm@x.test", "Gmail one", T0 + 700);
  await db().prepare(`INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, subject, date, snippet, text_body, html_body, is_from_me, unread, message_id_header, created_at) VALUES (?, 'b-gm', ?, 'gid-mine', 'gm@test.local', '', '[]', 're', ?, '', '', '', 1, 1, ?, 1)`).bind(nid("m"), g, T0 + 800, nid("h")).run();
  // A thread of an empty bundle that is not in the Imbox, so the bundle is not shown.
  await inBundle("b1", "bd-empty", "empty@x.test", "Trash", T0 + 100, { bucket: "trash" });
});
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a bundle in the Imbox and in Updates", () => {
  it("shows the newest visible thread, how many threads and messages (a thread bubbled up for later still counts; one in Reply Later or set aside does not), and the name and picture of the sender", async () => {
    const out = await json(await as("GET", "/api/imbox"));
    const by = Object.fromEntries(out.bundles.map((b: any) => [b.id, b]));
    expect(Object.keys(by).sort()).toEqual(["bd-gm", "bd-news"]);
    expect(by["bd-news"]).toMatchObject({ email: "news@x.test", name: "The News", avatar_url: "https://pics.test/news.png", status: "open", thread_count: 4, message_count: 5 });
    expect(by["bd-news"].latest.subject).toBe("News two");
    expect(by["bd-gm"]).toMatchObject({ name: "Gmail Sender", thread_count: 1 });
  });

  it("Paper Trail has its own bundles, and a sender with no name is shown by their latest thread's name or address", async () => {
    const out = await json(await as("GET", "/api/threads?bucket=paper_trail"));
    expect(out.bundles.map((b: any) => b.id)).toEqual(["bd-bill"]);
    expect(out.bundles[0]).toMatchObject({ thread_count: 2, name: "bills", avatar_url: "" });
    expect(out.bundles[0].latest.subject).toBe("Invoice 2");
    // The threads of a bundle are not listed on their own.
    expect(out.threads.map((t: any) => t.subject)).toEqual([]);
  });

  it("newest bundle first", async () => {
    const out = await json(await as("GET", "/api/imbox"));
    await db().prepare(`UPDATE bundles SET last_message_at = 5 WHERE id = 'bd-news'`).run();
    await db().prepare(`UPDATE bundles SET last_message_at = 9 WHERE id = 'bd-gm'`).run();
    const again = await json(await as("GET", "/api/imbox"));
    expect(out.bundles.length).toBe(2);
    expect(again.bundles.map((b: any) => b.id)).toEqual(["bd-gm", "bd-news"]);
  });
});

describe("the bundle page", () => {
  it("every thread in the batch, newest first, each with its latest message, and the bundle's summary", async () => {
    const out = await json(await as("GET", "/api/bundles/bd-news"));
    expect(out.bundle).toMatchObject({ id: "bd-news", name: "The News", thread_count: 4, message_count: 5 });
    // The page shows every thread of the batch that is not merged, including the ones the Imbox leaves out.
    const subjects = ["Aside", "Bubbled", "Later", "News two", "News three", "News one"];
    expect(out.threads.map((t: any) => t.subject)).toEqual(subjects);
    expect(out.threads.map((t: any) => t.latest_message?.subject)).toEqual(subjects);
  });

  it("a bundle in Paper Trail, and one that is not the user's or not there", async () => {
    expect((await json(await as("GET", "/api/bundles/bd-bill"))).bundle).toMatchObject({ id: "bd-bill", thread_count: 2 });
    await db().prepare(`INSERT INTO bundles (id, account_id, contact_id, email, status, thread_count, message_count, first_message_at, last_message_at, created_at) VALUES ('bd-theirs', 'b-other', 'x', 'y@x.test', 'open', 0, 0, 1, 1, 1)`).run();
    expect((await as("GET", "/api/bundles/bd-theirs")).status).toBe(404);
    expect((await as("GET", "/api/bundles/nope")).status).toBe(404);
  });

  it("a bundle with no thread in the Imbox still opens, from its own row, with its threads wherever they are", async () => {
    const out = await json(await as("GET", "/api/bundles/bd-empty"));
    expect(out.threads.map((t: any) => [t.subject, t.bucket])).toEqual([["Trash", "trash"]]);
    expect(out.bundle).toMatchObject({ id: "bd-empty", email: "empty@x.test" });
  });
});

describe("marking seen, reopening, dissolving", () => {
  it("seen closes the batch: the threads and their messages are read, and Gmail is told for the messages that are the sender's", async () => {
    const res = await as("POST", "/api/bundles/bd-gm/seen");
    expect(await res.json()).toEqual({ ok: true, status: "seen" });
    await new Promise((r) => setTimeout(r, 30));
    expect((await q<any>(`SELECT status FROM bundles WHERE id = 'bd-gm'`))[0].status).toBe("seen");
    expect(await q(`SELECT 1 FROM threads WHERE bundle_id = 'bd-gm' AND (seen = 0 OR unread = 1)`)).toEqual([]);
    expect(await q(`SELECT 1 FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE bundle_id = 'bd-gm') AND unread = 1`)).toEqual([]);
    const calls = gmailCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("messages/batchModify");
    expect(calls[0].body.removeLabelIds).toEqual(["UNREAD"]);
    expect(calls[0].body.ids.length).toBe(1);
  });

  it("seen on a mailbox that is not Gmail's tells nobody", async () => {
    await as("POST", "/api/bundles/bd-news/seen");
    await new Promise((r) => setTimeout(r, 30));
    expect(gmailCalls()).toEqual([]);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE bundle_id = 'bd-news' AND seen = 1`))[0].n).toBe(7);
  });

  it("unseen reopens it, and folds in the sender's other open bundle", async () => {
    await as("POST", "/api/bundles/bd-news/seen");
    await bundle("bd-news-2", "b1", "c-news", "news@x.test");
    const extra = await inBundle("b1", "bd-news-2", "news@x.test", "Newer", T0 + 5000);
    const res = await as("POST", "/api/bundles/bd-news/unseen");
    expect(await res.json()).toEqual({ ok: true, status: "open" });
    expect((await q<any>(`SELECT status, seen_at FROM bundles WHERE id = 'bd-news'`))[0]).toEqual({ status: "open", seen_at: null });
    expect(await q(`SELECT id FROM bundles WHERE id = 'bd-news-2'`)).toEqual([]);
    expect((await q<any>(`SELECT bundle_id FROM threads WHERE id = ?`, extra))[0].bundle_id).toBe("bd-news");
    expect(await q(`SELECT 1 FROM threads WHERE bundle_id = 'bd-news' AND seen = 1 AND id <> ?`, extra)).toEqual([]);
    const b = (await q<any>(`SELECT thread_count, message_count, last_message_at FROM bundles WHERE id = 'bd-news'`))[0];
    // Counted over every thread that is not merged, the ones in Reply Later, set aside and bubbled up too.
    expect(b).toEqual({ thread_count: 7, message_count: 8, last_message_at: T0 + 9300 });
  });

  it("dissolving sets its threads free and removes it", async () => {
    const res = await as("DELETE", "/api/bundles/bd-bill");
    expect(await res.json()).toEqual({ ok: true });
    expect(await q(`SELECT id FROM bundles WHERE id = 'bd-bill'`)).toEqual([]);
    expect((await q<any>(`SELECT count(*) AS n FROM threads WHERE bundle_id IS NULL AND subject LIKE 'Invoice%'`))[0].n).toBe(2);
    expect((await as("DELETE", "/api/bundles/bd-bill")).status).toBe(404);
  });
});

describe("how many statements", () => {
  it("the Imbox's bundles are a few statements, however many bundles there are", async () => {
    for (let i = 0; i < 30; i++) {
      await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, bundled) VALUES (?, 'b1', ?, ?, 'imbox', 1, 1, 1)`).bind(`cx${i}`, `bx${i}@x.test`, `Bx ${i}`).run();
      await bundle(`bdx${i}`, "b1", `cx${i}`, `bx${i}@x.test`);
      for (let j = 0; j < 2; j++) await inBundle("b1", `bdx${i}`, `bx${i}@x.test`, `Bx ${i}.${j}`, T0 + 20_000 + i * 10 + j);
    }
    resetStatements();
    const out = await json(await as("GET", "/api/imbox"));
    expect(out.bundles.length).toBe(32);
    expect(sent.statements).toBeLessThan(30);
  });
});
