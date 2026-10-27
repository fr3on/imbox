import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { AiBulkActionProposal, AiDraftCard, AiEventProposal } from "@shared/types";
import { html, NOW } from "./render";
import { AssistantChat } from "@/components/AssistantChat";
import { BulkActionCard } from "@/assistant/BulkActionCard";
import { DraftCard } from "@/assistant/DraftCard";
import { EventProposalCard } from "@/assistant/EventProposalCard";
import { Prose, ThinkingDots, ToolLine, textToHtml } from "@/assistant/prose";
import { suggestionsFor } from "@/assistant/suggestions";
import { applyEvent, toolLabel, turnsFromStored, type Turn } from "@/assistant/turns";

// The assistant's chat (messages, the cards it shows for a draft, an event and a bulk action, the box you type in, and the suggestions for the page you are
// on), pinned before the file was split. The pure parts, with answers worked out by hand; the rest as first paint. A conversation streams in on clicks and
// effects, which a server render does not run, so the transcript itself is not part of this.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // Dates and times in the cards are written in the reader's language; pin it, so a machine set to another one does not change them.
  const date = Date.prototype.toLocaleDateString;
  const time = Date.prototype.toLocaleTimeString;
  vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (this: Date, _l, o) { return date.call(this, "en-US", o); });
  vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, _l, o) { return time.call(this, "en-US", o); });
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const noop = () => {};

describe("what a tool call says it did", () => {
  const say = (name: string, input?: unknown) => toolLabel(name, input);
  it("describes a search by what it looked for", () => {
    expect(say("search_mail")).toBe("Searched mail");
    expect(say("search_mail", { query: "invoice", from_sender: "ann@x.test", unread_only: true, has_attachment: true, bucket: "paper_trail", label: "Work" })).toBe("Searched mail: “invoice”, from ann@x.test, unread, with attachments, in paper trail, labeled Work");
    expect(say("search_mail", { unread_only: false })).toBe("Searched mail");
  });
  it("describes each of the other tools", () => {
    const cases: [string, unknown, string][] = [
      ["list_threads", { bucket: "set_aside" }, "Listed set aside"],
      ["read_thread", undefined, "Read a thread"],
      ["list_screener", undefined, "Checked the Screener"],
      ["screen_sender", { decision: "screened_out" }, "Screened a sender → screened out"],
      ["thread_action", { action: "reply_later" }, "Organised · reply later"],
      ["create_draft", { subject: "Hello" }, "Drafted “Hello”"],
      ["create_draft", {}, "Drafted “a message”"],
      ["send_draft", undefined, "Sent a draft"],
      ["remember", { content: "likes short mails" }, "Remembered: likes short mails"],
      ["forget", undefined, "Forgot a memory entry"],
      ["find_contact", { query: "Ann" }, "Looked up “Ann”"],
      ["save_clip", undefined, "Saved a clip"],
      ["create_collection", { name: "Q4" }, "Created collection “Q4”"],
      ["add_to_collection", undefined, "Added to a collection"],
      ["list_events", { from: "2026-10-05" }, "Checked calendar (2026-10-05)"],
      ["list_events", {}, "Checked calendar (upcoming)"],
      ["find_free_time", { from_date: "2026-10-06" }, "Looked for free time on 2026-10-06"],
      ["find_free_time", {}, "Looked for free time on calendar"],
      ["propose_event", { title: "Lunch" }, "Proposed event “Lunch”"],
      ["propose_event", {}, "Proposed event “new event”"],
      ["get_daily_brief", undefined, "Loaded Daily Brief"],
      ["catch_up_thread", undefined, "Caught up on thread"],
      ["find_thread_actions", undefined, "Checked asks & deadlines"],
      ["set_contact_destination", { email: "a@x.test", destination: "paper_trail" }, "Set a@x.test destination → paper trail"],
      ["set_contact_destination", {}, "Set contact destination → "],
      ["bundle_sender", { email: "a@x.test" }, "Bundled a@x.test"],
      ["bundle_sender", { bundled: false }, "Unbundled sender"],
      ["list_noisy_or_misfiled_senders", { kind: "noisy" }, "Checked for noisy senders"],
      ["list_noisy_or_misfiled_senders", {}, "Checked for noisy & misfiled senders"],
      ["bulk_thread_action", { action: "mark_read" }, "Bulk action · mark read"],
      ["undo_bulk_action", undefined, "Undid bulk action"],
      ["something_new_and_odd", undefined, "something new and odd"],
    ];
    for (const [name, input, said] of cases) expect(say(name, input), name).toBe(said);
  });
});

describe("the conversation as it was stored", () => {
  const msg = (id: string, role: "user" | "assistant", content: unknown) => ({ id, role, content: content as unknown[] });
  it("turns a user message into a turn, and splits the threads attached to it from the words", () => {
    const turns = turnsFromStored([msg("m1", "user", [{ type: "text", text: "[[context thread=t-9]] Subject: Studio plan · From: Alex Rivera <alex@studio.test>\nbody" }, { type: "text", text: "Summarise this" }])]);
    expect(turns).toEqual([{ id: "m1", role: "user", text: "Summarise this", context: [{ id: "t-9", subject: "Studio plan", from: "Alex Rivera <alex@studio.test>" }], tools: [], drafts: [], eventProposals: [], bulkActionProposals: [], sent: {} }]);
  });
  it("drops a user message that held only attachments, and blocks that are not text", () => {
    expect(turnsFromStored([msg("m1", "user", [{ type: "text", text: "[[context thread=t-9]] Subject: S · From: F" }])])).toEqual([]);
    expect(turnsFromStored([msg("m1", "user", [{ type: "image" }, { type: "text", text: 5 }, { type: "text", text: "  " }])])).toEqual([]);
    expect(turnsFromStored([msg("m1", "user", "not a list")])).toEqual([]);
  });
  it("joins consecutive assistant messages into one turn: their text with a blank line, their tool calls as done", () => {
    const turns = turnsFromStored([
      msg("m1", "user", [{ type: "text", text: "Find it" }]),
      msg("m2", "assistant", [{ type: "text", text: "Looking." }, { type: "tool_use", id: "tu1", name: "search_mail", input: { query: "plan" } }]),
      msg("m3", "assistant", [{ type: "text", text: "Found it." }]),
      msg("m4", "user", [{ type: "text", text: "Thanks" }]),
      msg("m5", "assistant", [{ type: "text", text: "Welcome." }]),
    ]);
    expect(turns.map((t) => [t.role, t.text])).toEqual([["user", "Find it"], ["assistant", "Looking.\n\nFound it."], ["user", "Thanks"], ["assistant", "Welcome."]]);
    expect(turns[1].tools).toEqual([{ id: "tu1", status: "done", summary: "Searched mail: “plan”" }]);
    expect(turns[1].id).toBe("m2");
  });
  it("starts an assistant turn when there is no user message before it", () => {
    expect(turnsFromStored([msg("m1", "assistant", [{ type: "text", text: "Hi" }])])).toHaveLength(1);
    expect(turnsFromStored([])).toEqual([]);
  });
});

describe("text in a draft", () => {
  it("becomes paragraphs and line breaks, with markup made harmless", () => {
    expect(textToHtml("Hello <b>you</b> & co\nsecond line\n\n\nNew paragraph")).toBe("<p>Hello &lt;b&gt;you&lt;/b&gt; &amp; co<br>second line</p><p>New paragraph</p>");
    expect(textToHtml("  one  ")).toBe("<p>one</p>");
  });
});

describe("the little markdown the assistant writes", () => {
  const p = (text: string) => html(<Prose text={text} />);
  it("paragraphs and bold and code", () => expect(p("First **bold** and `code`.\nSame paragraph.\n\nSecond.")).toMatchSnapshot());
  it("bullets", () => expect(p("- one\n* two with **bold**\n- three")).toMatchSnapshot());
  it("numbered steps", () => expect(p("1. first\n2) second\n10. tenth")).toMatchSnapshot());
  it("a list only when every line is one", () => expect(p("- one\nnot a bullet")).toMatchSnapshot());
  it("windows line endings, empty blocks and nothing", () => {
    expect(p("a\r\n\r\n\r\n\r\nb")).toBe(p("a\n\nb"));
    expect(html(<Prose text={"  \n\n  "} />)).toBe(html(<Prose text="" />));
  });
});

describe("the small status lines", () => {
  it("a tool call running, done and failed", () => {
    for (const status of ["running", "done", "error"] as const) expect(html(<ToolLine status={status} summary={`Did a thing (${status})`} />)).toMatchSnapshot();
  });
  it("the dots while it thinks", () => expect(html(<ThinkingDots />)).toMatchSnapshot());
});

const DRAFT: AiDraftCard = { draft_id: "d-1", account_id: "a-gmail", from: "maya@gmail.test", thread_id: "t-1", to: [{ email: "alex@studio.test", name: "Alex Rivera" }, { email: "sam@studio.test", name: "" }], cc: [{ email: "lee@studio.test", name: "Lee" }], subject: "Re: Studio plan", body_text: "Thursday works.\n\n- bring cables\n- **doors** at nine" };
const EVENT: AiEventProposal = { id: "p-1", title: "Studio review", starts_at: Date.UTC(2026, 9, 8, 14, 0), ends_at: Date.UTC(2026, 9, 8, 15, 30), all_day: false, start_date: "2026-10-08", end_date: "2026-10-08", location: "Room 2", description: "Bring cables.\nSecond line.", attendees: ["alex@studio.test", "sam@studio.test"], calendar_id: "work" };
const BULK: AiBulkActionProposal = { id: "b-1", description: "Move 5 newsletters to the Feed", action: "move", bucket: "feed", thread_ids: ["t1", "t2", "t3", "t4", "t5"], threads: [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, subject: `Issue ${i}`, from: `News ${i} <news${i}@x.test>`, previous_bucket: "imbox" })) };

describe("the draft card", () => {
  it("offers to send it, or to open it in the composer", () => expect(html(<DraftCard d={DRAFT} />)).toMatchSnapshot());
  it("without anyone in copy", () => expect(html(<DraftCard d={{ ...DRAFT, cc: [] }} />)).toMatchSnapshot());
  it("collapses to one line once it has been sent, with a way to open the thread", () => {
    expect(html(<DraftCard d={DRAFT} sentThreadId="t-77" />)).toMatchSnapshot();
  });
});

describe("the event card", () => {
  it("a proposed event with everything", () => expect(html(<EventProposalCard p={EVENT} />)).toMatchSnapshot());
  it("a bare one", () => expect(html(<EventProposalCard p={{ id: "p-2", title: "Call", starts_at: EVENT.starts_at, ends_at: EVENT.ends_at, all_day: false, start_date: null, end_date: null }} />)).toMatchSnapshot());
  it("an all-day one", () => expect(html(<EventProposalCard p={{ ...EVENT, all_day: true, start_date: "2026-10-08" }} />)).toMatchSnapshot());
});

describe("the bulk action card", () => {
  it("asks before it does, listing the first three threads", () => expect(html(<BulkActionCard p={BULK} />)).toMatchSnapshot());
  it("one thread, with the singular", () => expect(html(<BulkActionCard p={{ ...BULK, thread_ids: ["t1"], threads: BULK.threads.slice(0, 1) }} />)).toMatchSnapshot());
  it("already applied, with a way to undo it", () => expect(html(<BulkActionCard p={{ ...BULK, applied: true }} />)).toMatchSnapshot());
  it("with no threads listed", () => expect(html(<BulkActionCard p={{ ...BULK, threads: [] }} />)).toMatchSnapshot());
});

const configured = (qc: QueryClient) => qc.setQueryData(["ai", "settings"], { configured: true });
const unconfigured = (qc: QueryClient) => qc.setQueryData(["ai", "settings"], { configured: false });
const chat = (props: Partial<React.ComponentProps<typeof AssistantChat>> = {}, url = "/", more: (qc: QueryClient) => void = configured) => html(<AssistantChat onConversationId={noop} {...props} />, url, more);
const CONTEXT = [{ id: "t-9", subject: "Studio plan", from: "Alex Rivera" }, { id: "t-10", subject: "", from: "Sam" }];

describe("the assistant on each page", () => {
  for (const [name, url] of [["the Imbox", "/"], ["a thread", "/t/t-9"], ["the calendar", "/calendar"], ["contacts", "/contacts"], ["the Screener", "/screener"], ["the Feed", "/feed"], ["Updates", "/updates"], ["Paper Trail", "/paper-trail"]] as const) {
    it(`in a panel on ${name}`, () => expect(chat({}, url)).toMatchSnapshot());
  }
  it("docked on the Imbox, folded down to the box", () => expect(chat({ variant: "dock" })).toMatchSnapshot());
  it("docked and opened, on the calendar", () => expect(chat({ variant: "dock", expanded: true }, "/calendar")).toMatchSnapshot());
  it("docked with menu actions and threads attached", () => expect(chat({ variant: "dock", expanded: true, context: CONTEXT, onRemoveContext: noop, onAddContext: noop, onNewChat: noop, onOpenHistory: noop })).toMatchSnapshot());
  it("in a panel with threads attached", () => expect(chat({ context: CONTEXT, onRemoveContext: noop, onAddContext: noop })).toMatchSnapshot());
  it("compact", () => expect(chat({ compact: true })).toMatchSnapshot());
  it("while the conversation loads", () => expect(chat({ conversationId: "c-1" })).toMatchSnapshot());
  it("before an AI key is set up, in a panel and docked", () => {
    expect(chat({}, "/", unconfigured)).toMatchSnapshot();
    expect(chat({ variant: "dock", expanded: true }, "/", unconfigured)).toMatchSnapshot();
  });
});

// ---- written after the chat was split: the two decisions that became plain functions (answers worked out by hand) ----

describe("what the assistant suggests", () => {
  const labels = (path: string, hasContext = false) => suggestionsFor(path, hasContext).suggestions.map((x) => x.label);
  const titles = (path: string, hasContext = false) => suggestionsFor(path, hasContext).emptyCards.map((x) => x.title);
  it("on the Imbox, and anywhere it has no better idea", () => {
    const want = ["What needs me today?", "Review Screener", "Deadlines this week", "Summarize unread", "Draft a reply"];
    expect(labels("/")).toEqual(want);
    expect(labels("/settings")).toEqual(want);
    expect(titles("/")).toEqual(["What needs me today?", "Review Screener", "Deadlines this week", "Summarize unread"]);
  });
  it("in a thread, or with a thread attached wherever it is", () => {
    const want = ["What is the deadline?", "Catch me up", "Draft a reply", "Reply briefly", "Summarize"];
    expect(labels("/t/abc")).toEqual(want);
    expect(labels("/", true)).toEqual(want);
    expect(labels("/calendar", true)).toEqual(want);
    expect(titles("/t/abc")).toEqual(["What is the deadline?", "Catch me up", "Draft a reply", "Summarize thread"]);
  });
  it("on the calendar, in contacts and in the Screener", () => {
    expect(labels("/calendar")).toEqual(["What is on tomorrow?", "Today's schedule", "Find free time", "Propose event"]);
    expect(labels("/calendar/week")).toEqual(labels("/calendar"));
    expect(labels("/contacts")).toEqual(["Which senders are noisy?", "Misfiled senders", "Bundle a sender", "Set destination"]);
    expect(labels("/screener")).toEqual(["Who is waiting?", "Recommend decisions", "What needs me today?", "Summarize unread"]);
    expect(titles("/calendar")).toEqual(["What is on tomorrow?", "Today's schedule", "Find free time", "Schedule meeting"]);
  });
  it("in the Feed, Updates and Paper Trail", () => {
    const want = ["Summarize Feed", "What needs me today?", "Find receipts", "Misfiled senders"];
    for (const path of ["/feed", "/updates", "/paper-trail"]) expect(labels(path), path).toEqual(want);
  });
  it("fills the box instead of sending when the prompt ends in a space, because it needs finishing", () => {
    const open = (path: string) => suggestionsFor(path, false).suggestions.filter((x) => /\s$/.test(x.prompt)).map((x) => x.prompt);
    expect(open("/")).toEqual(["Draft a reply to the latest email from "]);
    expect(open("/calendar")).toEqual(["Propose an event for "]);
    expect(open("/contacts")).toEqual(["Bundle senders from ", "Set contact destination for "]);
    expect(open("/screener")).toEqual([]);
  });
});

describe("what a streamed event does to the reply being written", () => {
  const live = (o: Partial<Turn> = {}): Turn => ({ id: "a-1", role: "assistant", text: "", tools: [], drafts: [], sent: {}, ...o });
  it("adds text on the end", () => {
    expect(applyEvent(live({ text: "Hel" }), { type: "text", text: "lo" })?.text).toBe("Hello");
  });
  it("adds a tool call, and updates one it already has, leaving the others", () => {
    const a = applyEvent(live(), { type: "tool", id: "t1", name: "search_mail", status: "running", summary: "Searching" });
    expect(a?.tools).toEqual([{ id: "t1", status: "running", summary: "Searching" }]);
    const b = applyEvent(a, { type: "tool", id: "t2", name: "read_thread", status: "running", summary: "Reading" });
    const c = applyEvent(b, { type: "tool", id: "t1", name: "search_mail", status: "done", summary: "Searched" });
    expect(c?.tools).toEqual([{ id: "t1", status: "done", summary: "Searched" }, { id: "t2", status: "running", summary: "Reading" }]);
  });
  it("collects drafts, event proposals and bulk action proposals in order", () => {
    const d1 = { draft_id: "d1" } as never;
    const d2 = { draft_id: "d2" } as never;
    expect(applyEvent(applyEvent(live(), { type: "draft", draft: d1 }), { type: "draft", draft: d2 })?.drafts).toEqual([d1, d2]);
    const e = { id: "p1" } as never;
    expect(applyEvent(live(), { type: "event_proposal", proposal: e })?.eventProposals).toEqual([e]);
    expect(applyEvent(live({ eventProposals: [{ id: "p0" } as never] }), { type: "event_proposal", proposal: e })?.eventProposals).toEqual([{ id: "p0" }, e]);
    const b = { id: "b1" } as never;
    expect(applyEvent(live(), { type: "bulk_action_proposal", proposal: b })?.bulkActionProposals).toEqual([b]);
  });
  it("notes which thread a draft was sent into, and an error", () => {
    const sent = applyEvent(applyEvent(live(), { type: "sent", draft_id: "d1", thread_id: "t-1" }), { type: "sent", draft_id: "d2", thread_id: "t-2" });
    expect(sent?.sent).toEqual({ d1: "t-1", d2: "t-2" });
    expect(applyEvent(live(), { type: "error", message: "No API key" })?.error).toBe("No API key");
  });
  it("leaves the turn alone for an event that is not about it, and does not change the one it was given", () => {
    const l = live({ text: "x" });
    expect(applyEvent(l, { type: "start", conversation_id: "c-1" })).toBe(l);
    expect(applyEvent(l, { type: "done", conversation_id: "c-1" })).toBe(l);
    const out = applyEvent(l, { type: "text", text: "y" });
    expect(out).not.toBe(l);
    expect(l.text).toBe("x");
  });
  it("has nothing to add to when there is no reply being written", () => {
    expect(applyEvent(null, { type: "text", text: "x" })).toBeNull();
    expect(applyEvent(null, { type: "error", message: "x" })).toBeNull();
  });
});
