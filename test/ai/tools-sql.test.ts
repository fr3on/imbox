import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runTool, type ToolContext } from "../../src/api/ai/tools";
import type { AccountRow } from "../../src/api/db";
import { migrate, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { resetStatements, sent } from "../support/pgenv";
import { seedAccount } from "../agent-fixtures";
import { gatherCandidates } from "../../src/api/ai/brief";

/**
 * Which threads and people the assistant's search tools find, pinned before their queries were made to use the indexes of migrations 0023, 0031 and 0033.
 * Each case has one thread that must be found for the reason named, and the rest are there to be left out: a trashed one, another person's, and ones
 * that match nothing.
 */

const db = () => testEnv.DB;
let accounts: AccountRow[];
const ids: Record<string, string> = {};
let ctx: ToolContext;

const run = async (name: string, input: unknown) => {
  const r = await runTool({ ...ctx, emit: () => {} }, name, input);
  return JSON.parse(r.result);
};
const found = async (input: Record<string, unknown>) => ((await run("search_mail", input)).results as { thread_id: string }[]).map((r) => r.thread_id);
const named = (...keys: string[]) => keys.map((k) => ids[k]).sort();
const sorted = (l: string[]) => [...l].sort();

async function thread(key: string, o: { subject?: string; from?: string; bucket?: string; account?: string; set?: string; body?: string; to?: string; cc?: string; fromEmail?: string }) {
  const { thread: id } = await seedThread(o.account ?? "ts-a", { subject: o.subject ?? "Nothing here", from: o.from ?? "plain@x.test", bucket: o.bucket ?? "imbox" });
  ids[key] = id;
  if (o.set) await db().prepare(`UPDATE threads SET ${o.set} WHERE id = ?`).bind(id).run();
  await db()
    .prepare(`UPDATE messages SET text_body = ?, to_json = ?, cc_json = ?, from_email = COALESCE(?, from_email) WHERE thread_id = ?`)
    .bind(o.body ?? "plain words", o.to ?? "[]", o.cc ?? "[]", o.fromEmail ?? null, id)
    .run();
  return id;
}

beforeAll(async () => {
  await migrate();
  await wipeAll();
  await signIn("tsu");
  await signIn("tsv");
  await seedAccount("ts-a", "a@test.local", { user: "tsu" });
  await seedAccount("ts-b", "b@test.local", { user: "tsu" });
  await seedAccount("ts-o", "o@test.local", { user: "tsv" });
  accounts = (await db().prepare(`SELECT * FROM accounts WHERE user_id = 'tsu' ORDER BY id`).all<AccountRow>()).results;
  ctx = { env: testEnv, user: { id: "tsu", email: "tsu@test.local", name: "Maya Chen" }, accounts, autoSend: false, emit: () => {} };

  await thread("subject", { subject: "Zeppelin schedule" });
  await thread("custom", { subject: "Plain", set: "custom_subject = 'My ZEPPELIN trip'" });
  await thread("snippet", { subject: "Plain two", set: "snippet = 'about the zeppelin'" });
  await thread("note", { subject: "Plain three", set: "note = 'zeppelin idea'" });
  await thread("participant", { subject: "Plain four", set: `participants_json = '[{"email":"zeppelin@fly.test","name":""}]'` });
  await thread("body", { subject: "Plain five", body: "we saw a Zeppelin over the lake" });
  await thread("sender", { subject: "Plain six", fromEmail: "zeppelin@lines.test" });
  await thread("second-account", { subject: "Zeppelin in the other mailbox", account: "ts-b" });
  await thread("trashed", { subject: "Zeppelin in trash", bucket: "trash" });
  await thread("theirs", { subject: "Zeppelin, not yours", account: "ts-o" });
  await thread("merged", { subject: "Zeppelin merged", set: "merged_into = 'elsewhere'" });
  await thread("nothing", { subject: "Lunch" });
  await thread("lastfrom", { subject: "Plain seven", from: "boss@lines.test" });
  await thread("to", { subject: "Plan A", to: JSON.stringify([{ email: "carol@people.test", name: "Carol" }]), cc: "[]" });
  await thread("cc", { subject: "Plan B", cc: JSON.stringify([{ email: "carol@people.test", name: "Carol" }]) });
  await thread("other-to", { subject: "Plan C", to: JSON.stringify([{ email: "dave@people.test", name: "Dave" }]) });
  await thread("feed-z", { subject: "Zeppelin news", bucket: "feed" });
  await thread("old", { subject: "Zeppelin long ago", set: "last_message_at = 1000" });
  // The people the contact tool looks in.
  await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, notes) VALUES ('ts-c1', 'ts-a', 'carol@people.test', 'Carol Danvers', 'imbox', 1, 5, 'met at the airfield'), ('ts-c2', 'ts-b', 'zed@people.test', 'Zed', 'feed', 1, 4, ''), ('ts-c3', 'ts-o', 'carol@theirs.test', 'Carol Theirs', 'imbox', 1, 6, '')`).run();
  await db().prepare(`INSERT INTO address_book (account_id, email, name, updated_at) VALUES ('ts-a', 'carla@book.test', 'Carla Book', 1), ('ts-b', 'zoe@book.test', 'Zoe Z', 1), ('ts-o', 'carla@theirs.test', 'Carla Theirs', 1)`).run();
});
beforeEach(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("search_mail", () => {
  it("finds a word in the subject, the custom subject, the snippet, the note, the people, a message body and a sender, in both mailboxes and nowhere else", async () => {
    const got = await found({ query: "zeppelin", limit: 25 });
    expect(sorted(got)).toEqual(named("subject", "custom", "snippet", "note", "participant", "body", "sender", "second-account", "feed-z", "old"));
  });

  it("matches without regard to case, and a part of a word", async () => {
    expect(sorted(await found({ query: "ZEPPEL", limit: 25 }))).toEqual(sorted(await found({ query: "zeppelin", limit: 25 })));
  });

  it("puts the newest first and keeps to the limit", async () => {
    const got = await found({ query: "zeppelin", limit: 3 });
    expect(got).toHaveLength(3);
    expect(got).not.toContain(ids.old);
    const all = await found({ query: "zeppelin", limit: 25 });
    expect(all[all.length - 1]).toBe(ids.old);
  });

  it("finds nothing for a word that is nowhere, and takes a bucket and a word together", async () => {
    expect(await found({ query: "no-such-word-anywhere" })).toEqual([]);
    expect(await found({ query: "zeppelin", bucket: "feed" })).toEqual(named("feed-z"));
    expect(await found({ query: "zeppelin", bucket: "trash" })).toEqual(named("trashed"));
  });

  it("finds mail sent to or copied to an address", async () => {
    expect(sorted(await found({ to_recipient: "carol@people.test" }))).toEqual(named("to", "cc"));
    expect(await found({ to_recipient: "DAVE@" })).toEqual(named("other-to"));
    expect(await found({ to_recipient: "carol@theirs.test" })).toEqual([]);
  });

  it("finds a sender among the last sender and the people of a thread", async () => {
    expect(sorted(await found({ from_sender: "zeppelin@fly", limit: 25 }))).toEqual(named("participant"));
    expect(await found({ from_sender: "nobody-at-all" })).toEqual([]);
  });

  it("passes a percent sign to the database as a wildcard, as it always has (the web search escapes it, this tool does not)", async () => {
    expect((await found({ query: "%", limit: 25 })).length).toBeGreaterThan(10);
  });
});

describe("bulk_thread_action", () => {
  it("selects by words in the subject, custom subject or snippet, and by sender, in the user's mailboxes only", async () => {
    const pick = async (input: Record<string, unknown>) => ((await run("bulk_thread_action", { action: "mark_read", limit: 100, ...input })).proposal?.thread_ids ?? []) as string[];
    expect(sorted(await pick({ query: "zeppelin" }))).toEqual(named("subject", "custom", "snippet", "second-account", "feed-z", "old"));
    expect(await pick({ query: "zeppelin", current_bucket: "feed" })).toEqual(named("feed-z"));
    expect(await pick({ from_sender: "boss@lines" })).toEqual(named("lastfrom"));
    expect(await pick({ query: "no-such-word-anywhere" })).toEqual([]);
  });
});

describe("find_contact", () => {
  const people = async (query: string) => ((await run("find_contact", { query })).people as { email: string; contact_id: string | null }[]).map((p) => p.email).sort();

  it("finds people in the contacts and the address book of the user's mailboxes, by address or name", async () => {
    expect(await people("carol")).toEqual(["carol@people.test"]);
    expect(await people("airfield")).toEqual([]); // notes are not searched
    expect(await people("carla")).toEqual(["carla@book.test"]);
    expect(await people("ZOE")).toEqual(["zoe@book.test"]);
    expect(await people("z")).toEqual(expect.arrayContaining(["zed@people.test", "zoe@book.test"]));
    expect(await people("theirs")).toEqual([]);
  });

  it("lists a person once, from the contacts, when the address book has them too", async () => {
    await db().prepare(`INSERT INTO address_book (account_id, email, name, updated_at) VALUES ('ts-a', 'carol@people.test', 'Carol in the book', 1)`).run();
    const r = (await run("find_contact", { query: "carol" })).people as { email: string; contact_id: string | null }[];
    expect(r.filter((p) => p.email === "carol@people.test")).toHaveLength(1);
    expect(r[0].contact_id).toBe("ts-c1");
  });
});

describe("list_screener", () => {
  it("groups the waiting threads by sender and mailbox, three to a sender, and says which sender is a contact", async () => {
    for (let i = 0; i < 4; i++) await thread(`sc-a${i}`, { subject: `Hello ${i}`, from: "pat@wait.test", bucket: "screener", set: `last_message_at = ${5000 + i}` });
    await thread("sc-b", { subject: "Hi from Pat in B", from: "pat@wait.test", bucket: "screener", account: "ts-b" });
    await thread("sc-c", { subject: "Quiet one", from: "quiet@wait.test", bucket: "screener" });
    await thread("sc-t", { subject: "Trash", from: "gone@wait.test", bucket: "trash" });
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at) VALUES ('sc-k1', 'ts-a', 'pat@wait.test', 'Pat', 'pending', 1, 1), ('sc-k2', 'ts-b', 'pat@wait.test', 'Pat B', 'pending', 1, 1)`).run();
    const r = (await run("list_screener", {})).senders as { contact_id: string | null; email: string; account_email: string; threads: unknown[] }[];
    const pat = r.filter((x) => x.email === "pat@wait.test");
    expect(pat.map((x) => [x.account_email, x.contact_id, x.threads.length]).sort()).toEqual([["a@test.local", "sc-k1", 3], ["b@test.local", "sc-k2", 1]]);
    expect(r.find((x) => x.email === "quiet@wait.test")).toMatchObject({ contact_id: null, account_email: "a@test.local" });
    expect(r.find((x) => x.email === "gone@wait.test")).toBeUndefined();
  });

  it("is a few statements, however many senders are waiting", async () => {
    for (let i = 0; i < 40; i++) await thread(`sc-m${i}`, { subject: `Many ${i}`, from: `many${i}@wait.test`, bucket: "screener" });
    resetStatements();
    const r = (await run("list_screener", {})).senders as unknown[];
    expect(r.length).toBeGreaterThanOrEqual(40);
    expect(sent.statements).toBeLessThan(8);
  });
});

describe("list_noisy_or_misfiled_senders", () => {
  it("names the contact of each suggestion, matching the address in any case, and the contacts that write most", async () => {
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, message_count) VALUES ('mf-1', 'ts-a', 'Mixed@Case.test', 'Mixed', 'imbox', 1, 9, 12), ('mf-2', 'ts-b', 'mixed@case.test', 'Mixed B', 'feed', 1, 3, 4), ('mf-3', 'ts-a', 'loud@case.test', 'Loud', 'imbox', 1, 1, 50)`).run();
    const review = (email: string, suggest: string, at: number) =>
      db().prepare(`INSERT INTO contact_reviews (user_id, email, suggest, reason, count_at, reviewed_at) VALUES ('tsu', ?, ?, 'because', 1, ?)`).bind(email, suggest, at).run();
    await review("mixed@case.test", "feed", 20);
    await review("unknown@case.test", "paper_trail", 10);
    const r = await run("list_noisy_or_misfiled_senders", { kind: "all", limit: 10 });
    const m = r.misfiled as { email: string; contact_id: string | null; name: string; current_destination: string; message_count: number; suggested_destination: string }[];
    expect(m.map((x) => x.email)).toEqual(["mixed@case.test", "unknown@case.test"]);
    expect(m[0]).toMatchObject({ contact_id: "mf-1", name: "Mixed", current_destination: "imbox", message_count: 12, suggested_destination: "feed" });
    expect(m[1]).toMatchObject({ contact_id: null, name: "", current_destination: "imbox", message_count: 0 });
    expect((r.noisy as { email: string }[])[0].email).toBe("loud@case.test");
  });

  it("is a few statements, however many suggestions there are", async () => {
    for (let i = 0; i < 25; i++) await db().prepare(`INSERT INTO contact_reviews (user_id, email, suggest, reason, count_at, reviewed_at) VALUES ('tsu', ?, 'feed', 'r', 1, ?)`).bind(`s${i}@sugg.test`, 100 + i).run();
    resetStatements();
    await run("list_noisy_or_misfiled_senders", { kind: "misfiled", limit: 30 });
    expect(sent.statements).toBeLessThan(6);
  });
});

describe("the Daily Brief's paperwork", () => {
  const later = (threadId: string, body: string, date: number) =>
    db()
      .prepare(`INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, cc_json, subject, date, snippet, text_body, html_body, is_from_me, unread, created_at) VALUES (?, 'ts-a', ?, ?, 'billing@paper.test', 'B', '[]', '[]', 'S', ?, '', ?, '', 0, 1, ?)`)
      .bind(`pm-${threadId}-${date}`, threadId, `g-pm-${threadId}-${date}`, date, body, date)
      .run();

  it("takes a Paper Trail thread when its latest message from them demands something, and not when only an older one did", async () => {
    const now = Date.now();
    const mk = async (key: string, older: string, newer: string) => {
      const id = await thread(key, { subject: key, from: "billing@paper.test", bucket: "paper_trail", body: older });
      await db().prepare(`UPDATE messages SET date = ? WHERE thread_id = ?`).bind(now - 5000, id).run();
      await later(id, newer, now - 1000);
      return id;
    };
    const urgentNow = await mk("pp-new", "Your receipt is attached", "Final notice: payment overdue");
    const urgentOnlyBefore = await mk("pp-old", "Final notice: payment overdue", "Thanks, all settled");
    const plain = await mk("pp-plain", "Your receipt is attached", "Your statement is ready");
    const picked = (await gatherCandidates(db(), "tsu")).filter((c) => c.source === "paperwork").map((c) => c.thread_id);
    expect(picked).toContain(urgentNow);
    expect(picked).not.toContain(urgentOnlyBefore);
    expect(picked).not.toContain(plain);
  });
});
