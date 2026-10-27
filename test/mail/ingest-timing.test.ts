import { beforeAll, describe, it, vi } from "vitest";
import { deliverInbound } from "../../src/api/inbound";
import { ingestParsed } from "../../src/api/ingest";
import type { ParsedMessage } from "../../src/api/mime";
import type { AccountRow } from "../../src/api/db";
import { signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

// How many statements storing mail takes, and how long. Run on its own: TIME_INGEST=1 npx vitest run test/mail/ingest-timing.test.ts

const T0 = 1_790_000_000_000;
const ME = "bench@gmail.test";
let account: AccountRow;
let seq = 0;

/** A message with a body of a few kilobytes, in one of `threads` threads, from one of `senders` people; one in ten carries a file with its bytes. */
const make = (i: number, threads: number, senders: number): ParsedMessage => {
  const id = `b${++seq}`;
  const from = `sender${i % senders}@bench${i % 7}.test`;
  const body = `Hi Maya, ${"project update and notes for the week. ".repeat(150)}`;
  return {
    gmailId: id, threadId: `bt${i % threads}`, labelIds: ["INBOX", "UNREAD"], snippet: body.slice(0, 120), internalDate: T0 + i, sizeEstimate: body.length, headers: {},
    from: { email: from, name: `Sender ${i % senders}` }, to: [{ email: ME, name: "Bench" }], cc: [], bcc: [], replyTo: "", subject: `Subject ${i % threads}`, date: T0 + i,
    messageId: `<${id}@bench.test>`, inReplyTo: "", references: "", listUnsubscribe: "", listId: "", precedence: "", autoSubmitted: "", text: body, html: `<p>${body}</p>`,
    attachments: i % 10 === 0 ? [{ attachmentId: `a${id}`, filename: `f${i}.pdf`, mimeType: "application/pdf", size: 2000, contentId: "", isInline: false, blob: new Uint8Array(2000).buffer as ArrayBuffer }] : [],
  } as ParsedMessage;
};

beforeAll(async () => {
  await signIn("bench");
  await seedAccount("bench-a", ME, { user: "bench", provider: "imap" });
  account = (await testEnv.DB.prepare(`SELECT * FROM accounts WHERE id = 'bench-a'`).first<AccountRow>())!;
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.skipIf(!process.env.TIME_INGEST)("timing", () => {
  it("a Gmail-style batch: 200 messages in 80 threads from 120 people", async () => {
    const msgs = Array.from({ length: 200 }, (_, i) => make(i, 80, 120));
    resetStatements();
    const t0 = performance.now();
    const r = await ingestParsed(testEnv, account, msgs);
    console.log(`TIMING batch of 200: added ${r.added}, ${sent.statements} statements, ${(performance.now() - t0).toFixed(0)} ms`);
    const kinds: Record<string, number> = {};
    for (const q of sent.sql) {
      const k = q.replace(/\s+/g, " ").slice(0, 52);
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`TIMING   ${v}x ${k}`);
    // The same again with 50 new messages on the threads that now exist.
    const more = Array.from({ length: 50 }, (_, i) => make(1000 + i, 80, 120));
    resetStatements();
    const t1 = performance.now();
    await ingestParsed(testEnv, account, more);
    console.log(`TIMING 50 more on known threads: ${sent.statements} statements, ${(performance.now() - t1).toFixed(0)} ms`);
  });

  it("an IMAP-style catch-up: 100 messages, one at a time through deliverInbound", async () => {
    const msgs = Array.from({ length: 100 }, (_, i) => {
      const { threadId: _t, ...rest } = make(2000 + i, 40, 60);
      return rest;
    });
    // The first message alone, to see what one costs: the statements, in order.
    await deliverInbound(testEnv, account, msgs[0]);
    resetStatements();
    await deliverInbound(testEnv, account, msgs[1]);
    console.log("TIMING one message:\n" + sent.sql.map((q, i) => `TIMING   ${i + 1}. ${q.replace(/\s+/g, " ").slice(0, 110)}`).join("\n"));
    resetStatements();
    const t0 = performance.now();
    for (const m of msgs.slice(2)) await deliverInbound(testEnv, account, m);
    console.log(`TIMING 100 one at a time: ${(sent.statements / 98).toFixed(1)} statements each, ${((performance.now() - t0) / 98).toFixed(1)} ms each`);
    const per: Record<string, number> = {};
    for (const s of sent.sql) {
      const k = s.replace(/\s+/g, " ").slice(0, 60);
      per[k] = (per[k] ?? 0) + 1;
    }
    for (const [k, v] of Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`TIMING   ${(v / 98).toFixed(1)}x ${k}`);
  });
});
