import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestMessages, ingestParsed } from "../../src/api/ingest";
import type { ParsedMessage } from "../../src/api/mime";
import type { AccountRow } from "../../src/api/db";
import { signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";

// Storing mail is the centre of the app: where a new message lands (Screener, Imbox, Trash), what happens to the contact and the thread, what is kept of the
// message. Each case ingests a few messages and pins the rows left behind, with ids and times replaced, so a change to how it is organised cannot change them.

const T0 = 1_790_000_000_000;
const ME = "ui@gmail.test";
let account: AccountRow;
let second: AccountRow;
const db = () => testEnv.DB;

const text = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>");
const norm = (v: unknown): unknown => {
  if (typeof v === "string") return text(v);
  if (typeof v === "number") return v > 1.7e12 && v < 1.85e12 && v !== T0 && !(v >= T0 && v < T0 + 1e9) ? "<now>" : v;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  return v;
};

let n = 0;
const msg = (o: Omit<Partial<ParsedMessage>, "from" | "to" | "cc"> & { from?: string; to?: string[]; cc?: string[] } = {}): ParsedMessage => {
  const id = o.gmailId ?? `g${++n}`;
  const addr = (e: string) => ({ email: e, name: e.split("@")[0] });
  const { from, to, cc, ...rest } = o;
  return {
    gmailId: id, threadId: "th1", labelIds: ["INBOX", "UNREAD"], snippet: `snippet ${id}`, internalDate: T0, sizeEstimate: 1200, headers: {},
    from: addr(from ?? "stranger@example.net"), to: (to ?? [ME]).map(addr), cc: (cc ?? []).map(addr), bcc: [], replyTo: "", subject: "Re: Hello there", date: T0,
    messageId: `<${id}@example.net>`, inReplyTo: "", references: "", listUnsubscribe: "", listId: "", precedence: "", autoSubmitted: "", text: `body of ${id}`, html: "", attachments: [], ...rest,
  };
};

/** What the account's mail looks like now, in an order that does not depend on the ids. */
async function state(accountId = account.id) {
  const rows = async (sql: string) => (await db().prepare(sql).bind(accountId).all()).results;
  return norm({
    threads: await rows(`SELECT subject, snippet, bucket, seen, unread, has_attachments, trackers_blocked, participants_json, last_from_email, message_count, first_message_at, last_message_at, is_sent_only, bundle_id IS NOT NULL AS bundled FROM threads WHERE account_id = ? ORDER BY gmail_thread_id`),
    messages: await rows(`SELECT gmail_message_id, from_email, to_json, cc_json, subject, date, snippet, text_body, html_body, is_from_me, unread, gmail_labels_json, has_attachments, trackers_json, list_unsubscribe FROM messages WHERE account_id = ? ORDER BY gmail_message_id`),
    contacts: await rows(`SELECT email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, bundled FROM contacts WHERE account_id = ? ORDER BY email`),
    attachments: await rows(`SELECT gmail_attachment_id, filename, mime_type, size, content_id, is_inline FROM attachments WHERE account_id = ? ORDER BY gmail_attachment_id`),
    blobs: (await db().prepare(`SELECT a.filename, length(b.data) AS bytes FROM attachment_blobs b JOIN attachments a ON a.id = b.attachment_id WHERE a.account_id = ? ORDER BY a.filename`).bind(accountId).all()).results,
    letIns: (await db().prepare(`SELECT email, reason FROM auto_let_ins ORDER BY email`).all()).results,
  });
}
const ingest = async (...m: ParsedMessage[]) => {
  const r = await ingestParsed(testEnv, account, m);
  return norm({ added: r.added, threads: r.threadIds.length });
};

beforeAll(async () => {
  await signIn("ui");
  await seedAccount("ui-a", ME, { user: "ui", provider: "gmail" });
  await seedAccount("ui-b", "ui@other.test", { user: "ui", provider: "gmail" });
  const rows = (await db().prepare(`SELECT * FROM accounts WHERE user_id = 'ui' ORDER BY id`).all<AccountRow>()).results;
  account = rows[0];
  second = rows[1];
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

describe("where new mail lands", () => {
  it("does nothing for nothing", async () => {
    expect(await ingest()).toMatchSnapshot();
    expect(await state()).toMatchSnapshot();
  });

  it("holds a stranger's first message in the Screener, and remembers the stranger", async () => {
    expect(await ingest(msg())).toMatchSnapshot("result");
    expect(await state()).toMatchSnapshot("state");
  });

  it("adds to a thread, newest and older arriving together, in date order", async () => {
    const result = await ingest(msg({ date: T0 + 2000, gmailId: "late", snippet: "late" }), msg({ date: T0 + 1000, gmailId: "early", snippet: "early", subject: "Hello there" }));
    expect(result).toMatchSnapshot("result");
    expect(await state()).toMatchSnapshot("state");
  });

  it("makes a new message on a known thread unread again, and keeps the bucket of a decided sender", async () => {
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes) VALUES ('k1', ?, 'stranger@example.net', 'S', 'imbox', 1, 1, 1, 3, '')`).bind(account.id).run();
    await ingest(msg({ gmailId: "one" }));
    await db().prepare(`UPDATE threads SET seen = 1, unread = 0`).run();
    await ingest(msg({ gmailId: "two", date: T0 + 5000, labelIds: ["INBOX", "UNREAD"] }));
    expect(await state()).toMatchSnapshot();
  });

  it("sends a decided sender's mail to the place they were sent to", async () => {
    for (const [i, status] of ["feed", "paper_trail", "screened_out"].entries()) {
      await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes) VALUES (?, ?, ?, 'S', ?, 1, 1, 1, 0, '')`).bind(`kk${i}`, account.id, `${status}@example.net`, status).run();
    }
    await ingest(msg({ from: "feed@example.net", threadId: "tf" }), msg({ from: "paper_trail@example.net", threadId: "tp" }), msg({ from: "screened_out@example.net", threadId: "ts" }));
    expect(await state()).toMatchSnapshot();
  });

  it("moves a thread out of the Screener when its sender is let in, and back from screened out when they write again", async () => {
    await ingest(msg({ gmailId: "a" }));
    await db().prepare(`UPDATE contacts SET screen_status = 'imbox'`).run();
    await ingest(msg({ gmailId: "b", date: T0 + 1000 }));
    expect(await state()).toMatchSnapshot("let in");
    await db().prepare(`UPDATE contacts SET screen_status = 'screened_out'`).run();
    await ingest(msg({ gmailId: "c", date: T0 + 2000 }));
    expect(await state()).toMatchSnapshot("screened out");
  });
});

describe("mail you send and mail in the trash", () => {
  it("files what you send in the Imbox, and lets the person you wrote to in", async () => {
    await ingest(msg({ gmailId: "out", from: ME, to: ["new@example.org", "cc-me@example.org"], labelIds: ["SENT"], threadId: "ts1" }));
    expect(await state()).toMatchSnapshot();
  });

  it("lets a screened-out person back in when you write to them", async () => {
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes) VALUES ('so', ?, 'gone@example.org', 'G', 'screened_out', 1, 1, 1, 2, '')`).bind(account.id).run();
    await ingest(msg({ gmailId: "w", from: ME, to: ["gone@example.org"], labelIds: ["SENT"], threadId: "tw" }));
    expect(await state()).toMatchSnapshot();
  });

  it("puts a message you sent into a Screener thread's Imbox, and keeps trash in the trash", async () => {
    await ingest(msg({ gmailId: "in1" }));
    await ingest(msg({ gmailId: "reply", from: ME, to: ["stranger@example.net"], labelIds: ["SENT"], date: T0 + 1000 }));
    expect(await state()).toMatchSnapshot("sent reply");
    await ingest(msg({ gmailId: "t1", threadId: "tt", labelIds: ["TRASH"] }));
    expect(await state()).toMatchSnapshot("trash");
  });

  it("brings a trashed thread back when new mail arrives on it", async () => {
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes) VALUES ('kt', ?, 'stranger@example.net', 'S', 'feed', 1, 1, 1, 1, '')`).bind(account.id).run();
    await ingest(msg({ gmailId: "t1", labelIds: ["TRASH"] }));
    await ingest(msg({ gmailId: "t2", date: T0 + 1000 }));
    expect(await state()).toMatchSnapshot();
  });
});

describe("who counts as a stranger", () => {
  it("lets in mail from your own other mailbox, and from someone already decided on another account", async () => {
    await ingest(msg({ from: "ui@other.test", gmailId: "own", threadId: "to" }));
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes) VALUES ('ox', ?, 'known@example.org', 'Known', 'paper_trail', 5, 1, 1, 1, '')`).bind(second.id).run();
    await ingest(msg({ from: "known@example.org", gmailId: "known", threadId: "tk" }));
    expect(await state()).toMatchSnapshot();
  });

  it("with Let obvious people in on, lets in someone from the address book, but never bulk mail", async () => {
    await db().prepare(`UPDATE users SET settings_json = '{"autoLetIn":true}' WHERE id = 'ui'`).run();
    await db().prepare(`INSERT INTO address_book (account_id, email, name, avatar_url, updated_at) VALUES (?, 'friend@example.org', 'Friend', '', 1), (?, 'shop@example.org', 'Shop', '', 1)`).bind(account.id, account.id).run();
    await ingest(
      msg({ from: "friend@example.org", gmailId: "f", threadId: "tf" }),
      msg({ from: "shop@example.org", gmailId: "s", threadId: "tsh", listUnsubscribe: "<mailto:stop@example.org>" }),
      msg({ from: "nobody@example.org", gmailId: "n", threadId: "tn" }),
    );
    expect(await state()).toMatchSnapshot();
  });

  it("with Let obvious people in on, lets in someone who answers a mail you sent", async () => {
    await db().prepare(`UPDATE users SET settings_json = '{"autoLetIn":true}' WHERE id = 'ui'`).run();
    await ingest(msg({ gmailId: "mine", from: ME, to: ["reply@example.org"], labelIds: ["SENT"], threadId: "tm", messageId: "<mine@gmail.test>" }));
    await ingest(msg({ gmailId: "back", from: "colleague@example.org", threadId: "tm", inReplyTo: "<mine@gmail.test>", date: T0 + 1000 }));
    expect(await state()).toMatchSnapshot();
  });
});

describe("what is kept of a message", () => {
  it("keeps attachments and their bytes, marks inline ones, and counts only real attachments on the thread", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await ingest(
      msg({
        gmailId: "att",
        attachments: [
          { attachmentId: "a1", filename: "plan.pdf", mimeType: "application/pdf", size: 4, contentId: "", isInline: false, blob: bytes },
          { attachmentId: "a2", filename: "logo.png", mimeType: "image/png", size: 9, contentId: "cid1", isInline: true },
          { attachmentId: "", filename: "skipped.txt", mimeType: "text/plain", size: 1, contentId: "", isInline: false },
        ],
      }),
    );
    expect(await state()).toMatchSnapshot();
  });

  it("counts an inline image only: the thread has no attachment", async () => {
    await ingest(msg({ gmailId: "inl", attachments: [{ attachmentId: "a2", filename: "logo.png", mimeType: "image/png", size: 9, contentId: "cid1", isInline: true }] }));
    expect(await state()).toMatchSnapshot();
  });

  it("blocks trackers in the html, and makes text from html when there is none", async () => {
    await ingest(msg({ gmailId: "html", text: "", html: `<p>Hello <b>there</b></p><img src="https://track.example.com/pixel.gif" width="1" height="1">` }));
    expect(await state()).toMatchSnapshot();
  });

  it("adds the trackers of a later message to the thread's count", async () => {
    const pixel = (n: number) => `<p>hi</p><img src="https://track${n}.example.com/p.gif" width="1" height="1">`;
    await ingest(msg({ gmailId: "p1", html: pixel(1) }), msg({ gmailId: "p2", html: pixel(2), date: T0 + 1000 }));
    await ingest(msg({ gmailId: "p3", html: pixel(3), date: T0 + 2000 }));
    expect(await state()).toMatchSnapshot();
  });

  it("cuts long fields to their limits", async () => {
    await ingest(msg({ gmailId: "long", text: "x".repeat(250_000), references: "r".repeat(9000), listUnsubscribe: "u".repeat(3000), listId: "l".repeat(600), precedence: "p".repeat(200) }));
    const r = (await db().prepare(`SELECT length(text_body) AS text, length(references_header) AS refs, length(list_unsubscribe) AS unsub, length(list_id) AS listid, length(precedence) AS prec FROM messages`).first())!;
    expect(r).toMatchSnapshot();
  });

  it("is idempotent: a message that is already stored is not stored twice", async () => {
    await ingest(msg({ gmailId: "dup" }));
    await ingest(msg({ gmailId: "dup" }));
    expect(((await state()) as { messages: unknown[] }).messages).toHaveLength(1);
  });
});

describe("bundles and the Gmail entry point", () => {
  it("puts mail from a bundled sender into their open bundle", async () => {
    await db().prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count, notes, bundled) VALUES ('bc', ?, 'stranger@example.net', 'S', 'imbox', 1, 1, 1, 0, '', 1)`).bind(account.id).run();
    await ingest(msg({ gmailId: "b1" }));
    expect(await state()).toMatchSnapshot();
  });

  it("ingestMessages skips spam, mail it already has and messages it cannot read", async () => {
    const gm = (id: string, labelIds: string[], bad = false) => ({ id, threadId: "gt", labelIds, snippet: "s", internalDate: String(T0), sizeEstimate: 10, payload: bad ? undefined : { headers: [{ name: "From", value: "Sam <sam@example.org>" }, { name: "To", value: ME }, { name: "Subject", value: "Gmail" }, { name: "Date", value: "Tue, 01 Oct 2030 09:00:00 +0000" }], mimeType: "text/plain", body: { data: "SGVsbG8", size: 5 } } });
    const r1 = await ingestMessages(testEnv, account, [gm("g-ok", ["INBOX"]), gm("g-spam", ["SPAM"]), gm("g-bad", ["INBOX"], true)] as any);
    expect(norm({ added: r1.added })).toMatchSnapshot("first");
    const r2 = await ingestMessages(testEnv, account, [gm("g-ok", ["INBOX"])] as any);
    expect(r2.added).toBe(0);
    expect(await ingestMessages(testEnv, account, [])).toEqual({ added: 0, threadIds: [] });
  });
});
