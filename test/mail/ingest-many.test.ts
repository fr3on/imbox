import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestParsed } from "../../src/api/ingest";
import type { ParsedMessage } from "../../src/api/mime";
import type { AccountRow } from "../../src/api/db";
import { signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * Storing many messages at once. A batch is written with a few statements, each holding many rows; this pins that what is left behind is what storing the
 * same messages one at a time leaves (threads, contacts, messages, attachments and their bytes), whatever shape the batch has, and that the statements are few.
 */

const T0 = 1_790_000_000_000;
const db = () => testEnv.DB;
let batchAcc: AccountRow;
let singleAcc: AccountRow;

const text = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>").replace(/\b(batch|single)@gmail\.test/g, "me@gmail.test");
const norm = (v: unknown): unknown => {
  if (typeof v === "string") return text(v);
  if (typeof v === "number") return v > 1.7e12 && v < 1.85e12 && !(v >= T0 && v < T0 + 1e9) ? "<now>" : v;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};

/** What an account's mail looks like, in an order that does not depend on the ids. */
async function state(a: AccountRow) {
  const rows = async (sql: string) => (await db().prepare(sql).bind(a.id).all()).results;
  return norm({
    threads: await rows(
      `SELECT gmail_thread_id, subject, snippet, bucket, seen, unread, has_attachments, trackers_blocked, participants_json, last_from_email, last_from_name, message_count, first_message_at, last_message_at, is_sent_only
       FROM threads WHERE account_id = ? ORDER BY gmail_thread_id`
    ),
    messages: await rows(
      `SELECT gmail_message_id, from_email, from_name, to_json, cc_json, subject, date, snippet, text_body, html_body, is_from_me, unread, gmail_labels_json, has_attachments, trackers_json, list_unsubscribe, list_id, precedence
       FROM messages WHERE account_id = ? ORDER BY gmail_message_id`
    ),
    contacts: await rows(`SELECT email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, bundled FROM contacts WHERE account_id = ? ORDER BY email`),
    attachments: await rows(`SELECT gmail_attachment_id, filename, mime_type, size, content_id, is_inline FROM attachments WHERE account_id = ? ORDER BY gmail_attachment_id`),
    blobs: (await db().prepare(`SELECT a.filename, length(b.data) AS bytes FROM attachment_blobs b JOIN attachments a ON a.id = b.attachment_id WHERE a.account_id = ? ORDER BY a.filename`).bind(a.id).all()).results,
  });
}

const addr = (e: string) => ({ email: e, name: e.endsWith("@gmail.test") ? "Me" : e.split("@")[0] });
/** A message for `account`: i picks its thread, its sender, and whether it is mine, in the trash, unread or carries files. */
const make = (i: number, me: string, o: Partial<ParsedMessage> = {}): ParsedMessage => {
  const fromMe = i % 11 === 0;
  const sender = `sender${i % 17}@x${i % 3}.test`;
  const labels = ["INBOX", ...(i % 4 === 0 ? [] : ["UNREAD"]), ...(fromMe ? ["SENT"] : []), ...(i % 13 === 0 ? ["TRASH"] : [])];
  return {
    gmailId: `g${i}`, threadId: `th${i % 30}`, labelIds: labels, snippet: `snippet ${i}`, internalDate: T0 + i * 1000, sizeEstimate: 900, headers: {},
    from: addr(fromMe ? me : sender), to: [addr(fromMe ? `rcpt${i % 5}@y.test` : me)], cc: i % 7 === 0 ? [addr(`cc${i % 3}@z.test`)] : [], bcc: [], replyTo: "",
    subject: `Subject ${i % 30}`, date: T0 + i * 1000, messageId: `<g${i}@x.test>`, inReplyTo: "", references: "", listUnsubscribe: i % 9 === 0 ? "<mailto:u@x.test>" : "", listId: "", precedence: "",
    autoSubmitted: "", text: i % 5 === 0 ? "" : `body of ${i} é ✓`, html: i % 2 ? `<p>html ${i}</p><img src="https://t.example/p${i}.gif" width="1" height="1">` : "",
    attachments:
      i % 6 === 0
        ? [
            { attachmentId: `a${i}-1`, filename: `file${i}.pdf`, mimeType: "application/pdf", size: 1500, contentId: "", isInline: false, blob: new Uint8Array(1500).fill(7).buffer as ArrayBuffer },
            { attachmentId: `a${i}-2`, filename: `logo${i}.png`, mimeType: "image/png", size: 300, contentId: `cid${i}`, isInline: true },
          ]
        : [],
    ...o,
  } as ParsedMessage;
};

beforeAll(async () => {
  await signIn("um1");
  await signIn("um2");
  await seedAccount("m-batch", "batch@gmail.test", { user: "um1", provider: "gmail" });
  await seedAccount("m-single", "single@gmail.test", { user: "um2", provider: "gmail" });
  for (const [id, set] of [["m-batch", (a: AccountRow) => (batchAcc = a)], ["m-single", (a: AccountRow) => (singleAcc = a)]] as const) {
    set((await db().prepare(`SELECT * FROM accounts WHERE id = ?`).bind(id).first<AccountRow>())!);
  }
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

/** The same messages for both accounts: the batch account gets them together, the other one at a time, in the order a batch is stored. */
async function both(first: number[], second: number[], tweak: (a: AccountRow, i: number) => Partial<ParsedMessage> = () => ({})) {
  const mk = (a: AccountRow, ids: number[]) => ids.map((i) => make(i, a.email, tweak(a, i)));
  const sorted = (ms: ParsedMessage[]) => [...ms].sort((x, y) => x.date - y.date);
  // What is there already, so some threads and contacts are known and some are not.
  for (const a of [batchAcc, singleAcc]) await ingestParsed(testEnv, a, mk(a, first));
  await ingestParsed(testEnv, batchAcc, mk(batchAcc, second));
  for (const m of sorted(mk(singleAcc, second))) await ingestParsed(testEnv, singleAcc, [m]);
}

describe("a batch is what the same messages one at a time are", () => {
  it("threads, contacts, messages, attachments and their bytes, new and already known", async () => {
    // Decided senders on both accounts, a screened-out one who is written to in the batch, and a bundled one.
    for (const a of [batchAcc, singleAcc]) {
      await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, bundled) VALUES (?, ?, 'sender3@x0.test', 'Three', 'feed', 5, 1, 1, 1, '', 0)`).bind(`c3-${a.id}`, a.id).run();
      await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, bundled) VALUES (?, ?, 'rcpt0@y.test', '', 'screened_out', 5, 1, 1, 1, '', 0)`).bind(`c0-${a.id}`, a.id).run();
    }
    await both(Array.from({ length: 12 }, (_, i) => i), Array.from({ length: 90 }, (_, i) => 12 + i));
    const batch = (await state(batchAcc)) as any;
    const single = (await state(singleAcc)) as any;
    // Not an empty comparison.
    expect(batch.messages.length).toBe(102);
    expect(batch.threads.length).toBe(30);
    expect(batch.attachments.length).toBeGreaterThan(20);
    expect(batch.blobs.length).toBeGreaterThan(10);
    expect(batch.contacts.length).toBeGreaterThan(20);
    // Section by section, so a difference names itself.
    for (const key of ["threads", "messages", "contacts", "attachments", "blobs"]) {
      const diff = batch[key].map((x: any, i: number) => ({ x, y: single[key][i] })).filter(({ x, y }: any) => JSON.stringify(x) !== JSON.stringify(y));
      expect(diff.slice(0, 2).map(({ x, y }: any) => Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y?.[k])).map((k) => `${k}: ${JSON.stringify(x[k])} vs ${JSON.stringify(y?.[k])}`)), key).toEqual([]);
      expect(batch[key].length, key).toBe(single[key].length);
    }
  });

  it("a message twice in one batch is stored once, and its attachments once", async () => {
    const m = make(500, batchAcc.email, { threadId: "dup" });
    const n = make(500, singleAcc.email, { threadId: "dup" });
    const r = await ingestParsed(testEnv, batchAcc, [m, { ...m }]);
    await ingestParsed(testEnv, singleAcc, [n]);
    await ingestParsed(testEnv, singleAcc, [{ ...n }]);
    expect(r.added).toBe(2);
    const a = (await state(batchAcc)) as any;
    const b = (await state(singleAcc)) as any;
    expect(a.messages.length).toBe(1);
    expect(a.attachments).toEqual(b.attachments);
    expect(a.blobs).toEqual(b.blobs);
  });

  it("a message another sync stored first is skipped, with its attachments", async () => {
    const m = make(600, batchAcc.email, { threadId: "first" });
    await ingestParsed(testEnv, batchAcc, [m]);
    const before = (await state(batchAcc)) as any;
    // The same message again, with new attachment ids, in a batch with a new one: only the new one is stored.
    const again = { ...m, attachments: m.attachments.map((x) => ({ ...x, attachmentId: `again-${x.attachmentId}` })) };
    await ingestParsed(testEnv, batchAcc, [again, make(601, batchAcc.email, { threadId: "first" })]);
    const after = (await state(batchAcc)) as any;
    expect(after.messages.length).toBe(before.messages.length + 1);
    expect(after.attachments.map((x: any) => x.gmail_attachment_id).filter((x: string) => x.startsWith("again-"))).toEqual([]);
  });
});

describe("how many statements a batch takes", () => {
  it("a few for a batch of two hundred, not one for each message, thread and contact", async () => {
    const msgs = Array.from({ length: 200 }, (_, i) => make(1000 + i, batchAcc.email, { threadId: `many${i % 80}`, from: addr(`many${i}@w.test`), labelIds: ["INBOX", "UNREAD"] }));
    resetStatements();
    const r = await ingestParsed(testEnv, batchAcc, msgs);
    expect(r.added).toBe(200);
    expect(sent.statements).toBeLessThan(80);
  });

  it("long messages are written in pieces, none of them huge, and all of them stored", async () => {
    const long = "x".repeat(190_000);
    const msgs = Array.from({ length: 24 }, (_, i) => make(2000 + i, batchAcc.email, { threadId: `long${i}`, text: long, html: "", attachments: [] }));
    resetStatements();
    await ingestParsed(testEnv, batchAcc, msgs);
    const inserts = sent.sql.filter((q) => /^\s*INSERT INTO messages/.test(q));
    expect(inserts.length).toBeGreaterThanOrEqual(3);
    expect((await db().prepare(`SELECT count(*) AS n FROM messages WHERE account_id = ? AND gmail_message_id LIKE 'g20%'`).bind(batchAcc.id).first<any>()).n).toBe(24);
  });

  it("an empty batch does nothing", async () => {
    resetStatements();
    expect(await ingestParsed(testEnv, batchAcc, [])).toEqual({ added: 0, threadIds: [] });
    expect(sent.statements).toBe(0);
  });
});
