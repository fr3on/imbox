import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import type { Attachment, Message, ThreadDetail } from "@shared/types";
import { html, NOW } from "./render";
import Thread from "@/pages/Thread";
import { AttachmentItem } from "@/thread/AttachmentItem";
import { MessageRow } from "@/thread/MessageRow";
import { buildTimelineItems, isBounceMessage } from "@/thread/messages";
import { SlimHeader } from "@/thread/SlimHeader";

// The sanitiser needs a real DOM, which these tests do not have; what it makes of a message is not what is pinned here.
vi.mock("@/lib/sanitizeHtml", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sanitizeEmailHtml: (h: string) => h }));

// The thread page (one conversation: its header, note, clips, messages, reply box and the action bar), pinned before the file was split: the page for a few
// kinds of thread as it first paints, the message rows, the slim header, and the two small pure functions it uses. Menus, the reply box and the rail open
// on clicks and layout measurements, so they are not part of this first paint.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const MAYA = { email: "maya@gmail.test", name: "Maya Chen" };
const ALEX = { email: "alex@studio.test", name: "Alex Rivera" };
const att = (id: string, mid: string, name: string, o: Partial<Attachment> = {}): Attachment => ({ account_id: "a-gmail", id, message_id: mid, thread_id: "t-1", filename: name, mime_type: "application/pdf", size: 52_000, is_inline: false, created_at: NOW, ...o });
const msg = (i: number, o: Partial<Message> = {}): Message => ({
  account_id: "a-gmail",
  id: `m-${i}`,
  thread_id: "t-1",
  from: i % 2 ? ALEX : MAYA,
  to: [i % 2 ? MAYA : ALEX],
  cc: [],
  bcc: [],
  reply_to: "",
  subject: "Studio schedule",
  date: NOW - (10 - i) * 3_600_000,
  snippet: `Message number ${i} of the thread`,
  text_body: `Message number ${i} of the thread.\n\nSee you Thursday.`,
  html_body: `<p>Message number ${i} of the thread.</p><p>See you <b>Thursday</b>.</p>`,
  is_from_me: i % 2 === 0,
  unread: false,
  has_attachments: false,
  trackers: [],
  list_unsubscribe: "",
  attachments: [],
  ...o,
});
const base = (o: Partial<ThreadDetail> & { messages: Message[] }): ThreadDetail => ({
  account_id: "a-gmail",
  id: "t-1",
  subject: "Studio schedule",
  original_subject: "Studio schedule",
  snippet: "See you Thursday",
  bucket: "imbox",
  seen: true,
  unread: false,
  reply_later: false,
  set_aside: false,
  bubble_up_at: null,
  bubbled: false,
  note: "",
  has_attachments: false,
  trackers_blocked: 0,
  participants: [MAYA, ALEX],
  last_from: ALEX,
  message_count: o.messages.length,
  first_message_at: o.messages[0].date,
  last_message_at: o.messages[o.messages.length - 1].date,
  labels: [],
  collections: [],
  clips: [],
  merged_threads: [],
  sender_bundled: false,
  ...o,
});

const SHORT = base({ messages: [msg(1, { unread: true })] });
const LONG = base({
  subject: "Thursday studio plan",
  original_subject: "Studio schedule",
  bucket: "feed",
  reply_later: true,
  set_aside: true,
  bubble_up_at: NOW + 2 * 86_400_000,
  note: "Ask about the extra monitor.",
  sender_bundled: true,
  labels: [{ account_id: "a-gmail", id: "l-1", name: "Studio", color: "#3b82f6" }],
  collections: [{ id: "c-1", name: "Q4 plans" }],
  clips: [{ account_id: "a-gmail", id: "cl-1", thread_id: "t-1", message_id: "m-2", text: "Doors open at nine", created_at: NOW }],
  merged_threads: [{ id: "t-9", subject: "Earlier thread about keys" }],
  messages: [
    msg(1),
    msg(2, { attachments: [att("at-1", "m-2", "schedule.pdf"), att("at-2", "m-2", "logo.png", { mime_type: "image/png", size: 2_400_000 }), att("at-3", "m-2", "inline.png", { is_inline: true })], has_attachments: true }),
    msg(3, { from: { email: "mailer-daemon@studio.test", name: "Mail Delivery Subsystem" }, snippet: "Delivery has failed to these recipients" }),
    msg(4, { cc: [{ email: "sam@studio.test", name: "Sam" }], trackers: ["track.example"] }),
    msg(5, { unread: true, list_unsubscribe: "<mailto:unsub@studio.test>" }),
  ],
});
const TRASHED = base({ bucket: "trash", messages: [msg(1), msg(2)] });
const TWO_ACCOUNTS = base({ account_id: "a-imap", messages: [msg(1, { account_id: "a-imap" })] });

const page = (t: ThreadDetail | null, url = "/t/t-1") =>
  html(<Routes><Route path="/t/:id" element={<Thread />} /></Routes>, url, (qc: QueryClient) => {
    if (t) {
      qc.setQueryData(["thread", t.id], t);
      qc.setQueryData(["thread", t.id, "peek"], t);
    }
  });

describe("the thread page", () => {
  it("while the thread loads", () => expect(page(null)).toMatchSnapshot());
  it("a one-message thread", () => expect(page(SHORT)).toMatchSnapshot());
  it("a long thread with a note, clips, labels, attachments, a failed delivery and everything marked", () => expect(page(LONG)).toMatchSnapshot());
  it("a trashed thread", () => expect(page(TRASHED)).toMatchSnapshot());
  it("a thread in a second mailbox", () => expect(page(TWO_ACCOUNTS)).toMatchSnapshot());
  it("a peek leaves the same page", () => expect(page(LONG, "/t/t-1?peek=1")).toBe(page(LONG)));
});

describe("a message", () => {
  const props = { index: 0, onToggle: () => {}, onReply: () => {}, onClip: () => {}, onMarkUnread: () => {}, onPrint: () => {} };
  const m = LONG.messages[1];
  it("open", () => expect(html(<MessageRow m={m} expanded focused={false} isLast={false} {...props} />)).toMatchSnapshot());
  it("open and focused, the last one", () => expect(html(<MessageRow m={m} expanded focused isLast {...props} />)).toMatchSnapshot());
  it("folded", () => expect(html(<MessageRow m={m} expanded={false} focused={false} isLast={false} {...props} />)).toMatchSnapshot());
  it("sent by you, with copies and blocked trackers", () => expect(html(<MessageRow m={LONG.messages[3]} expanded focused={false} isLast={false} {...props} />)).toMatchSnapshot());
  it("with an unsubscribe link", () => expect(html(<MessageRow m={LONG.messages[4]} expanded focused={false} isLast={false} {...props} />)).toMatchSnapshot());
  it("an attachment", () => expect(html(<AttachmentItem a={att("at-9", "m-2", "budget.xlsx", { mime_type: "application/vnd.ms-excel", size: 1_536 })} />)).toMatchSnapshot());
});

describe("the slim header", () => {
  const props = { top: 56, col: { left: 240, width: 800, compact: false }, subject: "Thursday studio plan", names: ["Alex Rivera", "Sam"], neighbours: { prev: "t-0", next: "t-2", position: 2, total: 9 }, onBack: () => {}, onGo: () => {}, onReply: () => {}, onReplyLater: () => {}, replyLaterOn: false, onSetAside: () => {}, setAsideOn: false, hideReply: false };
  it("with neighbours", () => expect(html(<SlimHeader {...props} />)).toMatchSnapshot());
  it("with both marks on, no neighbours, reply hidden", () => expect(html(<SlimHeader {...props} neighbours={null} replyLaterOn setAsideOn hideReply />)).toMatchSnapshot());
});

describe("the timeline", () => {
  it("recognises a delivery failure notice by sender, name, text or subject", () => {
    const f = (o: Partial<Message>) => isBounceMessage(msg(1, o));
    expect(f({ from: { email: "postmaster@x.test", name: "" } })).toBe(true);
    expect(f({ from: { email: "a@x.test", name: "Mail Delivery Subsystem" } })).toBe(true);
    expect(f({ snippet: "The address not found" })).toBe(true);
    expect(f({ snippet: "Your mailbox is full" })).toBe(true);
    expect(f({ subject: "Undeliverable: hello" })).toBe(true);
    expect(f({ subject: "Delivery Status Notification (Failure)" })).toBe(true);
    expect(f({})).toBe(false);
  });
  it("folds runs of failure notices into one entry, in place", () => {
    const [a, b, c, d, e] = [msg(1), msg(2, { snippet: "mailbox is full" }), msg(3, { snippet: "address not found" }), msg(4), msg(5, { subject: "Undeliverable: x" })];
    expect(buildTimelineItems([a, b, c, d, e]).map((i) => (i.type === "bounces" ? `bounces:${i.count}` : `message:${i.index}`))).toEqual(["message:0", "bounces:2", "message:3", "bounces:1"]);
    expect(buildTimelineItems([])).toEqual([]);
  });
});
