import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, nid, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * The Screener's list (GET /api/screener) and the short list for the extension (GET /api/screener/waiting): who is waiting, one card for a sender however many
 * mailboxes they wrote to, their newest few threads, the guess at where they belong from their latest message, and the contact made for someone who has none.
 * Pinned before the queries behind it were joined.
 */

const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
let token: string;
const T0 = Date.now();

async function waiting(account: string, from: string, subject: string, at: number, name = "") {
  const { thread, message } = await seedThread(account, { subject, from });
  await db().prepare(`UPDATE threads SET bucket = 'screener', last_message_at = ?, first_message_at = ?, last_from_name = ? WHERE id = ?`).bind(at, at, name, thread).run();
  await db().prepare(`UPDATE messages SET date = ?, from_email = ? WHERE id = ?`).bind(at, from, message).run();
  return { thread, message };
}
const contact = (account: string, email: string, status = "pending") =>
  db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, 1)`).bind(nid("c"), account, email, email.split("@")[0], status).run();

let ids: Record<string, string> = {};

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("u1");
  await signIn("u2");
  await seedAccount("a1", "one@test.local", { user: "u1" });
  await seedAccount("a2", "two@test.local", { user: "u1" });
  await seedAccount("a-other", "other@test.local", { user: "u2" });

  // Alice wrote to both mailboxes: three threads in a1, one in a2, the newest in a2.
  const a1 = await waiting("a1", "alice@x.test", "Alice one", T0 - 5000, "Alice");
  await waiting("a1", "alice@x.test", "Alice two", T0 - 4000, "Alice");
  await waiting("a1", "alice@x.test", "Alice three", T0 - 3000, "Alice");
  const a2 = await waiting("a2", "alice@x.test", "Alice four", T0 - 1000, "Alice");
  await contact("a1", "alice@x.test");
  await contact("a2", "alice@x.test", "imbox");
  // A newsletter: its latest message carries list headers, an earlier one does not.
  const n1 = await waiting("a1", "news@x.test", "News one", T0 - 9000, "News");
  const n2 = await waiting("a1", "news@x.test", "News two", T0 - 2000, "News");
  await db().prepare(`UPDATE messages SET list_unsubscribe = '<mailto:u@x.test>' WHERE id = ?`).bind(n2.message).run();
  await contact("a1", "news@x.test");
  // A sender whose mail looks like a receipt.
  const r1 = await waiting("a2", "billing@x.test", "Your invoice 42", T0 - 7000, "Billing");
  await contact("a2", "billing@x.test");
  // Someone with no contact row at all, and a sender whose only waiting thread is bubbled up for later, one that is merged, and one of another person's.
  const nc = await waiting("a1", "Stranger@X.test", "Hello", T0 - 8000, "Stranger");
  const bubbled = await waiting("a1", "later@x.test", "Later", T0 - 500);
  await db().prepare(`UPDATE threads SET bubble_up_at = ? WHERE id = ?`).bind(T0 + 86_400_000, bubbled.thread).run();
  await contact("a1", "later@x.test");
  const merged = await waiting("a1", "merged@x.test", "Merged", T0 - 400);
  await db().prepare(`UPDATE threads SET merged_into = ? WHERE id = ?`).bind(a1.thread, merged.thread).run();
  await waiting("a-other", "theirs@x.test", "Theirs", T0 - 100);
  // A message of mine in the thread of a sender is not what they sent.
  await db().prepare(`INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, subject, date, snippet, text_body, html_body, is_from_me, unread, message_id_header, created_at, list_unsubscribe)
    VALUES (?, 'a1', ?, ?, 'one@test.local', '', '[]', 'Re', ?, '', '', '', 1, 0, ?, 1, '<mailto:me@x.test>')`).bind(nid("m"), r1.thread.replace("a2", "a2"), nid("g"), T0, nid("h")).run().catch(() => {});
  ids = { a1: a1.thread, a2: a2.thread, n1: n1.thread, n2: n2.thread, r1: r1.thread, nc: nc.thread };
});

const get = async (path: string) => {
  const res = await call("GET", path, { token });
  expect(res.status).toBe(200);
  return json(res);
};

describe("who is waiting", () => {
  it("one card for each sender, newest first, with the number of threads they have waiting", async () => {
    const out = await get("/api/screener");
    expect(out.total).toBe(4);
    expect(out.senders.map((s: any) => s.contact.email.toLowerCase())).toEqual(["alice@x.test", "news@x.test", "billing@x.test", "stranger@x.test"]);
    expect(out.senders.map((s: any) => s.thread_count)).toEqual([4, 2, 1, 1]);
    expect(out.ai_pending).toBe(0);
  });

  it("a sender's newest few threads, newest first, from every mailbox", async () => {
    const out = await get("/api/screener");
    const alice = out.senders[0];
    expect(alice.threads.map((t: any) => t.subject)).toEqual(["Alice four", "Alice three", "Alice two", "Alice one"]);
    expect(alice.threads.map((t: any) => t.account_id)).toEqual(["a2", "a1", "a1", "a1"]);
    expect(out.senders[1].threads.map((t: any) => t.subject)).toEqual(["News two", "News one"]);
  });

  it("leaves out a thread bubbled up for later, a merged one, and another person's", async () => {
    const out = await get("/api/screener");
    const all = out.senders.flatMap((s: any) => s.threads.map((t: any) => t.subject));
    expect(all).not.toContain("Later");
    expect(all).not.toContain("Merged");
    expect(all).not.toContain("Theirs");
  });

  it("the contact of a sender who is in several mailboxes is the one that is still pending", async () => {
    const alice = (await get("/api/screener")).senders[0];
    expect(alice.contact.account_id).toBe("a1");
    expect(alice.contact.screen_status).toBe("pending");
  });

  it("makes a contact for someone who has none, in the mailbox of their newest thread, and shows them", async () => {
    expect(await q(`SELECT 1 FROM contacts WHERE account_id = 'a1' AND lower(email) = 'stranger@x.test'`)).toEqual([]);
    const out = await get("/api/screener");
    const s = out.senders.find((x: any) => x.contact.email.toLowerCase() === "stranger@x.test");
    expect(s.contact.screen_status).toBe("pending");
    expect(s.contact.id).toBeTruthy();
    expect((await q<any>(`SELECT screen_status, message_count FROM contacts WHERE account_id = 'a1' AND lower(email) = 'stranger@x.test'`))[0]).toEqual({ screen_status: "pending", message_count: 1 });
    // Asked again, no second one is made.
    await get("/api/screener");
    expect((await q<any>(`SELECT count(*) AS n FROM contacts WHERE lower(email) = 'stranger@x.test'`))[0].n).toBe(1);
  });

  it("a page of senders: the limit, and the total still says how many wait", async () => {
    const out = await get("/api/screener?limit=2");
    expect(out.senders.length).toBe(2);
    expect(out.total).toBe(4);
  });
});

describe("the guess at where a sender belongs, from their latest message", () => {
  it("list headers on the latest message say Feed; a receipt says Paper Trail; the rest the Imbox", async () => {
    const by = Object.fromEntries((await get("/api/screener")).senders.map((s: any) => [s.contact.email.toLowerCase(), s.suggestion]));
    expect(by).toEqual({ "alice@x.test": "imbox", "news@x.test": "feed", "billing@x.test": "paper_trail", "stranger@x.test": "imbox" });
  });

  it("a sender who has headers only on an earlier message is not a newsletter", async () => {
    await db().prepare(`UPDATE messages SET list_unsubscribe = '' WHERE id IN (SELECT id FROM messages WHERE thread_id = ?)`).bind(ids.n2).run();
    await db().prepare(`UPDATE messages SET list_unsubscribe = '<mailto:old@x.test>' WHERE thread_id = ?`).bind(ids.n1).run();
    const news = (await get("/api/screener")).senders.find((s: any) => s.contact.email === "news@x.test");
    expect(news.suggestion).toBe("imbox");
  });

  it("the latest message is taken across the sender's threads in every mailbox, and a message of mine does not count", async () => {
    // Alice's newest message is in a2 and carries list headers; a message of mine with headers is newer still and is not hers.
    await db().prepare(`UPDATE messages SET list_id = '<list.x.test>' WHERE thread_id = ?`).bind(ids.a2).run();
    expect((await get("/api/screener")).senders[0].suggestion).toBe("feed");
    await db().prepare(`UPDATE messages SET list_id = '' WHERE thread_id = ?`).bind(ids.a2).run();
    await db().prepare(`UPDATE messages SET list_id = '<list.x.test>', is_from_me = 1 WHERE thread_id = ?`).bind(ids.a2).run();
    expect((await get("/api/screener")).senders[0].suggestion).toBe("imbox");
  });
});

describe("the Screener's numbers on the Imbox and in the counts", () => {
  it("the counts say how many senders are waiting, not threads, each once however they write their address", async () => {
    expect((await get("/api/counts")).screener).toBe(4);
    await waiting("a1", "ALICE@X.TEST", "Shouting", T0 - 100, "Alice");
    expect((await get("/api/counts")).screener).toBe(4);
  });

  it("the Imbox says how many senders wait and shows the newest, merged across mailboxes and across spellings of the address", async () => {
    const out = await get("/api/imbox");
    expect(out.screener_count).toBe(4);
    expect(out.screener_senders.map((s: any) => [s.email.toLowerCase(), s.thread_count, s.account_id])).toEqual([
      ["alice@x.test", 4, "a2"],
      ["news@x.test", 2, "a1"],
      ["billing@x.test", 1, "a2"],
      ["stranger@x.test", 1, "a1"],
    ]);
    await waiting("a1", "ALICE@X.TEST", "Shouting", T0 - 100, "Alice");
    const again = await get("/api/imbox");
    expect(again.screener_count).toBe(4);
    expect(again.screener_senders.map((s: any) => [s.email.toLowerCase(), s.thread_count])[0]).toEqual(["alice@x.test", 5]);
  });

  it("nobody waiting is zero and an empty list", async () => {
    await db().prepare(`UPDATE threads SET bucket = 'imbox' WHERE bucket = 'screener'`).run();
    const out = await get("/api/imbox");
    expect(out.screener_count).toBe(0);
    expect(out.screener_senders).toEqual([]);
    expect((await get("/api/counts")).screener).toBe(0);
  });
});

describe("a long backlog", () => {
  it("each sender's latest message counts however the lookups are cut into pieces", async () => {
    // 130 senders with 5 threads each, in turn, so every sender's threads lie in both halves of a long list of threads.
    const first: Record<number, string> = {};
    const last: Record<number, string> = {};
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 130; i++) {
        const { thread, message } = await waiting(i % 2 ? "a1" : "a2", `long${i}@y.test`, `Long ${i}.${j}`, T0 + 1_000_000 - (j * 200 + i), `Long ${i}`);
        if (j === 0) first[i] = message;
        if (j === 4) last[i] = message;
        void thread;
      }
      if (j === 0) for (let i = 0; i < 130; i++) await contact(i % 2 ? "a1" : "a2", `long${i}@y.test`);
    }
    // Sender 7 has the headers on their oldest message only; sender 8 on their newest only.
    await db().prepare(`UPDATE messages SET list_id = '<l.y.test>' WHERE id = ?`).bind(last[7]).run();
    await db().prepare(`UPDATE messages SET list_id = '<l.y.test>' WHERE id = ?`).bind(first[8]).run();
    const out = await get("/api/screener?limit=130");
    const by = Object.fromEntries(out.senders.map((s: any) => [s.contact.email, s]));
    expect(out.senders.length).toBe(130);
    expect(out.total).toBeGreaterThan(130);
    expect(by["long7@y.test"].suggestion).toBe("imbox");
    expect(by["long8@y.test"].suggestion).toBe("feed");
    expect(by["long7@y.test"].threads.length).toBe(5);
    expect(by["long7@y.test"].thread_count).toBe(5);
  });
});

describe("the short list for the extension", () => {
  it("the next senders waiting, with how many threads each has, and a contact to decide on", async () => {
    const out = await get("/api/screener/waiting?limit=3");
    expect(out.total).toBe(4);
    expect(out.senders.map((s: any) => [s.email.toLowerCase(), s.threads])).toEqual([["alice@x.test", 4], ["news@x.test", 2], ["billing@x.test", 1]]);
    expect(out.senders.every((s: any) => s.contact_id)).toBe(true);
  });
});

describe("how many statements it takes", () => {
  it("a few, whatever the number of senders", async () => {
    for (let i = 0; i < 160; i++) {
      await waiting(i % 2 ? "a1" : "a2", `bulk${i}@x.test`, `Bulk ${i}`, T0 - 20_000 - i, `Bulk ${i}`);
      await contact(i % 2 ? "a1" : "a2", `bulk${i}@x.test`);
    }
    resetStatements();
    const out = await get("/api/screener?limit=200");
    expect(out.senders.length).toBe(164);
    expect(sent.statements, sent.sql.map((x) => x.replace(/\s+/g, " ").slice(0, 60)).join("\n")).toBeLessThanOrEqual(16);
  });
});

describe.skipIf(!process.env.TIME_SCREENER)("timing (TIME_SCREENER=1 TEST_DB_LATENCY_MS=5)", () => {
  it("the Screener and the Imbox", async () => {
    for (let i = 0; i < 150; i++) {
      await waiting(i % 2 ? "a1" : "a2", `timed${i}@x.test`, `Timed ${i}`, T0 - 30_000 - i, `Timed ${i}`);
      await contact(i % 2 ? "a1" : "a2", `timed${i}@x.test`);
    }
    for (const path of ["/api/screener", "/api/imbox", "/api/counts"]) {
      await get(path);
      resetStatements();
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) await get(path);
      console.log(`TIMING ${path}: ${((performance.now() - t0) / 5).toFixed(0)} ms each, ${(sent.statements / 5).toFixed(0)} statements`);
    }
  });
});
