import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * The pictures on the Imbox: every section (new, seen, reply later, set aside) and the Screener's senders take theirs from the contacts, and from the
 * address book for a person who is not a contact yet. Pinned before the lookups for the sections were joined into one.
 */

const db = () => testEnv.DB;
let token: string;

async function thread(account: string, subject: string, from: string, set: string) {
  const { thread } = await seedThread(account, { subject, from });
  await db().prepare(`UPDATE threads SET ${set} WHERE id = ?`).bind(thread).run();
  return thread;
}
const contact = (account: string, email: string, avatar: string) =>
  db()
    .prepare(`INSERT INTO contacts (id, account_id, email, name, avatar_url, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 1, 1)`)
    .bind(`c-${account}-${email}`, account, email, email, avatar)
    .run();

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("u1");
  await seedAccount("a1", "one@test.local", { user: "u1" });
  await seedAccount("a2", "two@test.local", { user: "u1" });
  await thread("a1", "new", "new@x.test", "seen = 0");
  await thread("a2", "seen", "seen@x.test", "seen = 1");
  await thread("a1", "later", "later@x.test", "reply_later = 1, reply_later_at = 5");
  await thread("a2", "aside", "aside@x.test", "set_aside = 1, set_aside_at = 5");
  await thread("a1", "stranger", "stranger@x.test", "bucket = 'screener'");
  await thread("a2", "book", "book@x.test", "seen = 0");
  await contact("a1", "new@x.test", "https://pics.test/new.png");
  await contact("a2", "seen@x.test", "https://pics.test/seen.png");
  await contact("a1", "later@x.test", "https://pics.test/later.png");
  await contact("a2", "aside@x.test", "https://pics.test/aside.png");
  await contact("a1", "stranger@x.test", "https://pics.test/stranger.png");
  await db().prepare(`INSERT INTO address_book (account_id, email, name, avatar_url, updated_at) VALUES ('a1', 'book@x.test', 'Book', 'https://pics.test/book.png', 1)`).run();
});

describe("the Imbox's pictures", () => {
  it("fills every section from the contacts, and the Screener's senders too", async () => {
    const res = await call("GET", "/api/imbox", { token });
    expect(res.status).toBe(200);
    const out = await json(res);
    const pic = (list: any[], subject: string) => list.find((t) => t.subject === subject)?.last_from.avatar_url;
    expect(pic(out.new_threads, "new")).toBe("https://pics.test/new.png");
    expect(pic(out.seen_threads, "seen")).toBe("https://pics.test/seen.png");
    expect(pic(out.reply_later, "later")).toBe("https://pics.test/later.png");
    expect(pic(out.set_aside, "aside")).toBe("https://pics.test/aside.png");
    expect(out.screener_senders.find((s: any) => s.email === "stranger@x.test")?.avatar_url).toBe("https://pics.test/stranger.png");
  });

  it("falls back to the address book for a person who is not a contact", async () => {
    const out = await json(await call("GET", "/api/imbox", { token }));
    expect(out.new_threads.find((t: any) => t.subject === "book")?.last_from.avatar_url).toBe("https://pics.test/book.png");
  });

  it("asks for the pictures of all the sections together: two statements for each account, however many sections there are", async () => {
    resetStatements();
    await call("GET", "/api/imbox", { token });
    const lookups = sent.sql.filter((q) => /avatar_url/.test(q) && /FROM (contacts|address_book)/.test(q));
    expect(lookups.length).toBeLessThanOrEqual(4);
  });
});
