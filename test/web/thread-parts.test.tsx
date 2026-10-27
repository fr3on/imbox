import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Account, Message, ThreadDetail } from "@shared/types";
import { ACCOUNTS, html, NOW, USER } from "./render";
import { ActionBar } from "@/thread/ActionBar";
import { MessageList } from "@/thread/MessageList";
import { NoteBox } from "@/thread/NoteBox";
import { ReplyBox } from "@/thread/ReplyBox";
import { ThreadHeader } from "@/thread/ThreadHeader";
import type { ReplyState } from "@/thread/types";

// The parts of a thread page that open on a click or a measurement (the action rail and its list, the reply box, the note editor, renaming, the timeline),
// drawn open. These were written after the page was split into parts, so they pin the parts from here on; the split itself was checked against the page's
// first paint, and by comparing the code line by line.

vi.mock("@/lib/sanitizeHtml", async (orig) => ({ ...(await orig<Record<string, unknown>>()), sanitizeEmailHtml: (h: string) => h }));
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const noop = () => {};
const MAYA = { email: "maya@gmail.test", name: "Maya Chen" };
const ALEX = { email: "alex@studio.test", name: "Alex Rivera" };
const msg = (i: number, o: Partial<Message> = {}): Message => ({
  account_id: "a-gmail", id: `m-${i}`, thread_id: "t-1", from: i % 2 ? ALEX : MAYA, to: [i % 2 ? MAYA : ALEX], cc: [], bcc: [], reply_to: "", subject: "Studio schedule",
  date: NOW - (10 - i) * 3_600_000, snippet: `Message number ${i}`, text_body: `Message number ${i}.`, html_body: `<p>Message number ${i}.</p>`, is_from_me: i % 2 === 0, unread: false,
  has_attachments: false, trackers: [], list_unsubscribe: "", attachments: [], ...o,
});
const MESSAGES = [msg(1), msg(2, { from: { email: "postmaster@studio.test", name: "Mail Delivery Subsystem" }, snippet: "Delivery has failed" }), msg(3), msg(4), msg(5, { unread: true })];
const T: ThreadDetail = {
  account_id: "a-gmail", id: "t-1", subject: "Thursday studio plan", original_subject: "Studio schedule", snippet: "x", bucket: "imbox", seen: true, unread: false, reply_later: false, set_aside: false,
  bubble_up_at: null, bubbled: false, note: "Ask about the extra monitor.", has_attachments: false, trackers_blocked: 0, participants: [MAYA, ALEX], last_from: ALEX, message_count: 5,
  first_message_at: MESSAGES[0].date, last_message_at: MESSAGES[4].date, labels: [{ account_id: "a-gmail", id: "l-1", name: "Studio", color: "#3b82f6" }], collections: [{ id: "c-1", name: "Q4 plans" }],
  clips: [], merged_threads: [], sender_bundled: false, messages: MESSAGES,
};
const MARKED: ThreadDetail = { ...T, reply_later: true, set_aside: true, bubble_up_at: NOW + 86_400_000, sender_bundled: true, bucket: "feed" };
const run = vi.fn();
const toEvent = { isPending: false } as never;
const summ = { summary: null, pending: false, run: noop, clear: noop, remove: noop, stale: false, savedAt: null } as never;
const account: Account = ACCOUNTS[0];

describe("the action bar", () => {
  const props = { openReply: noop, toggleReplyLater: noop, toggleSetAside: noop, run, summ, toEvent, setNoteOpen: noop, setSubjectDraft: noop, setRenaming: noop, setMergeOpen: noop, setConfirmDelete: noop, setRailOpen: noop, setBubbleOpen: noop, reply: null as ReplyState | null };
  const wide = { left: 240, width: 1400, compact: false };
  const narrow = { left: 0, width: 700, compact: false };
  it("along the bottom, when the window has no room beside the message", () => expect(html(<ActionBar t={T} col={null} railOpen={false} bubbleOpen={false} {...props} />)).toMatchSnapshot());
  it("along the bottom in a narrow column, with marks on", () => expect(html(<ActionBar t={MARKED} col={narrow} railOpen={false} bubbleOpen={false} {...props} />)).toMatchSnapshot());
  it("as a slim rail beside a wide column", () => expect(html(<ActionBar t={T} col={wide} railOpen={false} bubbleOpen={false} {...props} />)).toMatchSnapshot());
  it("as the open list of every action", () => expect(html(<ActionBar t={T} col={wide} railOpen bubbleOpen={false} {...props} />)).toMatchSnapshot());
  it("as the open list, with marks on, for a thread in the Feed", () => expect(html(<ActionBar t={MARKED} col={wide} railOpen bubbleOpen={false} {...props} />)).toMatchSnapshot());
  it("as the open list, for a thread in the trash", () => expect(html(<ActionBar t={{ ...T, bucket: "trash" }} col={wide} railOpen bubbleOpen={false} {...props} />)).toMatchSnapshot());
  it("is hidden while a reply is open", () => expect(html(<ActionBar t={T} col={null} railOpen={false} bubbleOpen={false} {...props} reply={{ mode: "reply", m: MESSAGES[0], key: 1 }} />)).toMatchSnapshot());
});

describe("the reply box", () => {
  const props = { t: T, setReply: noop, openReply: noop, account, user: USER, replyTarget: "Alex Rivera" };
  it("closed, offering to reply", () => expect(html(<ReplyBox {...props} reply={null} />)).toMatchSnapshot());
  it("closed, with nobody to reply to", () => expect(html(<ReplyBox {...props} reply={null} replyTarget="" />)).toMatchSnapshot());
  for (const mode of ["reply", "replyAll", "forward"] as const) {
    it(`open to ${mode}`, () => expect(html(<ReplyBox {...props} reply={{ mode, m: MESSAGES[0], key: 1 }} />)).toMatchSnapshot());
  }
  it("open on a message you sent", () => expect(html(<ReplyBox {...props} reply={{ mode: "reply", m: MESSAGES[1], key: 2 }} />)).toMatchSnapshot());
});

describe("the note", () => {
  const props = { setNoteOpen: noop, setNoteDraft: noop, noteRef: { current: null }, saveNote: noop, run };
  it("shown", () => expect(html(<NoteBox t={T} noteOpen={false} noteDraft="" {...props} />)).toMatchSnapshot());
  it("being edited", () => expect(html(<NoteBox t={T} noteOpen noteDraft="Ask about the extra monitor." {...props} />)).toMatchSnapshot());
  it("being written, with none yet", () => expect(html(<NoteBox t={{ ...T, note: "" }} noteOpen noteDraft="" {...props} />)).toMatchSnapshot());
  it("absent when there is none", () => expect(html(<NoteBox t={{ ...T, note: "" }} noteOpen={false} noteDraft="" {...props} />)).toBe(""));
});

describe("the heading", () => {
  const props = { names: ["Alex Rivera"], account, setRenaming: noop, setSubjectDraft: noop, saveRename: noop, titleRef: { current: null }, run };
  const neighbours = { prev: "t-0", next: "t-2", position: 2, total: 9 };
  it("with neighbours, renamed", () => expect(html(<ThreadHeader t={T} neighbours={neighbours} renamed renaming={false} subjectDraft="" {...props} />)).toMatchSnapshot());
  it("while renaming", () => expect(html(<ThreadHeader t={T} neighbours={null} renamed={false} renaming subjectDraft="Thursday studio plan" {...props} />)).toMatchSnapshot());
  it("for a thread in the trash with marks", () => expect(html(<ThreadHeader t={{ ...MARKED, bucket: "trash" }} neighbours={null} renamed={false} renaming={false} subjectDraft="" {...props} />)).toMatchSnapshot());
});

describe("the messages", () => {
  const props = { t: T, names: ["Alex Rivera", "Sam"], setExpanded: noop, setShowTimeline: noop, openReply: noop, run };
  const last = new Set(["m-5"]);
  it("folded down to the latest, with the timeline closed", () => expect(html(<MessageList {...props} expanded={last} showTimeline={false} msgCursor={-1} allExpanded={false} />)).toMatchSnapshot());
  it("with the timeline open, a failure notice folded in", () => expect(html(<MessageList {...props} expanded={new Set(["m-5", "m-3"])} showTimeline msgCursor={-1} allExpanded={false} />)).toMatchSnapshot());
  it("all open, one focused", () => expect(html(<MessageList {...props} expanded={new Set(MESSAGES.map((m) => m.id))} showTimeline={false} msgCursor={2} allExpanded />)).toMatchSnapshot());
  it("a two-message thread has no folding", () => expect(html(<MessageList {...props} t={{ ...T, messages: MESSAGES.slice(0, 2) }} expanded={new Set(["m-2"])} showTimeline={false} msgCursor={-1} allExpanded={false} />)).toMatchSnapshot());
  it("lists what was merged into the thread", () => expect(html(<MessageList {...props} t={{ ...T, merged_threads: [{ id: "t-9", subject: "Earlier thread about keys" }] }} expanded={last} showTimeline={false} msgCursor={-1} allExpanded={false} />)).toMatchSnapshot());
});

describe("hiding delivery failure notices", () => {
  const props = { t: T, names: ["Alex Rivera"], setExpanded: noop, setShowTimeline: noop, openReply: noop, run };
  const all = new Set(MESSAGES.map((m) => m.id));
  const withChoice = (v: string | null, fn: () => void) => {
    vi.stubGlobal("localStorage", { getItem: () => v, setItem: noop });
    try { fn(); } finally { vi.unstubAllGlobals(); }
  };
  const render = () => html(<MessageList {...props} expanded={all} showTimeline={false} msgCursor={-1} allExpanded />);

  it("shows them, with an offer to hide, until the choice is made", () => withChoice(null, () => {
    const out = render();
    expect(out).toContain("1 delivery failure notice");
    expect(out).toContain(">Hide<");
    expect(out).toContain("postmaster@studio.test");
  }));

  it("drops them from the list once hidden, and says how many", () => withChoice("1", () => {
    const out = render();
    expect(out).toContain("1 delivery failure notice");
    expect(out).toContain("hidden");
    expect(out).toContain(">Show<");
    expect(out).not.toContain("postmaster@studio.test");
  }));

  it("keeps a thread that is nothing but failure notices", () => withChoice("1", () => {
    const out = html(<MessageList {...props} t={{ ...T, messages: [MESSAGES[1]] }} expanded={new Set(["m-2"])} showTimeline={false} msgCursor={-1} allExpanded />);
    expect(out).toContain("postmaster@studio.test");
  }));

  it("shows the latest message that is left when the last one was a failure notice", () => withChoice("1", () => {
    const tail = [msg(1), msg(2), msg(3, { from: { email: "mailer-daemon@studio.test", name: "Mail Delivery Subsystem" }, snippet: "Address not found" })];
    const out = html(<MessageList {...props} t={{ ...T, messages: tail }} expanded={new Set(["m-2"])} showTimeline={false} msgCursor={-1} allExpanded={false} />);
    expect(out).not.toContain("Address not found");
    expect(out).toContain("Message number 2");
  }));
});
