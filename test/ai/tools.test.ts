import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runTool, TOOLS, type ToolContext } from "../../src/api/ai/tools";
import type { AccountRow } from "../../src/api/db";
import { seedThread, testEnv } from "../api-harness";
import { seedWorld, type World } from "../api-world";

// Every assistant tool, called the way the model calls it, with the answer pinned as a snapshot. Ids, times and dates are replaced so the
// snapshot says what a tool answers, not when it was run. The point is that a change to how the tools are organised cannot change an answer.

const text = (s: string) =>
  s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<iso>")
    .replace(/\b(?!2030-)\d{4}-\d{2}-\d{2}\b/g, "<date>")
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} [AP]M/g, "<local>")
    .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} \w{3} \d{4} [\d:]+ GMT/g, "<utc>");
// A number that is a moment near the time the test ran; the fixed 2030 times stay as they are.
const normal = (v: unknown): unknown => {
  if (typeof v === "string") return text(v);
  if (typeof v === "number") return v > 1.7e12 && v < 1.85e12 ? "<ms>" : v;
  if (Array.isArray(v)) return v.map(normal);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normal(x)]));
  return v;
};

let w: World;
let accounts: AccountRow[];
let events: Record<string, unknown>[];
let other: { thread: string };
const base = (): ToolContext => ({
  env: testEnv,
  user: { id: w.user, email: `${w.user}@test.local`, name: "Maya Chen" },
  accounts: accounts.filter((a) => a.id !== w.agentAccount),
  autoSend: false,
  emit: (e) => void events.push(e),
});

async function call(name: string, input: unknown, ctx: ToolContext = base()) {
  const r = await runTool(ctx, name, input);
  return normal({ ...r, result: (() => { try { return JSON.parse(r.result); } catch { return r.result; } })(), emitted: events });
}

beforeAll(async () => {
  w = await seedWorld("ua");
  accounts = (await testEnv.DB.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY id`).bind(w.user).all<AccountRow>()).results;
  other = await seedThread(w.imap, { subject: "Quarterly plan", bucket: "feed", from: "news@example.org" });
  await seedThread(w.imap, { subject: "Invoice 42", bucket: "paper_trail", from: "billing@example.org" });
  await seedThread(w.imap, { subject: "Lunch?", bucket: "screener", from: "stranger@example.net" });
  // The seeded lunch starts a day from now at the minute the test ran; pin it to noon so the listing does not depend on the clock.
  const tomorrow = new Date(Date.now() + 86_400_000);
  const noon = Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 12);
  await testEnv.DB.prepare(`UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?`).bind(noon, noon + 3_600_000, w.event).run();
  const parked = async (subject: string, set: string) => {
    const t = await seedThread(w.imap, { subject });
    await testEnv.DB.prepare(`UPDATE threads SET ${set} WHERE id = ?`).bind(t.thread).run();
  };
  await parked("Follow up", "reply_later = 1, reply_later_at = 1790000000000");
  await parked("Not now", "set_aside = 1, set_aside_at = 1790000000000");
  await parked("Next month", "bubble_up_at = 4102444800000");
});
beforeEach(() => {
  events = [];
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the tool list", () => {
  it("names every tool the assistant is offered", () => {
    expect(TOOLS.map((t) => t.name).sort()).toMatchSnapshot();
  });

  it("answers an unknown tool with an error, and a mailbox-less user with a clear one", async () => {
    expect(await call("no_such_tool", {})).toMatchSnapshot();
    expect(await call("list_labels", {}, { ...base(), accounts: [] })).toMatchSnapshot();
  });
});

describe("finding mail", () => {
  it("searches by words and by filters", async () => {
    expect(await call("search_mail", {})).toMatchSnapshot("no filter");
    expect(await call("search_mail", { query: "quarterly" })).toMatchSnapshot("query");
    expect(await call("search_mail", { from_sender: "billing", bucket: "paper_trail" })).toMatchSnapshot("sender and bucket");
    expect(await call("search_mail", { unread_only: true, has_attachment: false, limit: 2 })).toMatchSnapshot("unread");
    expect(await call("search_mail", { label: "L-ua" })).toMatchSnapshot("label");
    expect(await call("search_mail", { to_recipient: "nobody@nowhere.test" })).toMatchSnapshot("recipient");
    expect(await call("search_mail", { since_date: "2030-01-01", until_date: "2030-02-01" })).toMatchSnapshot("dates");
    expect(await call("search_mail", { bucket: "reply_later", query: "x" })).toMatchSnapshot("reply later");
  });

  it("lists threads in each place", async () => {
    for (const bucket of ["imbox", "previously_seen", "feed", "paper_trail", "screener", "trash", "sent", "reply_later", "set_aside", "bubble_up", "everything"]) {
      expect(await call("list_threads", { bucket })).toMatchSnapshot(bucket);
    }
    expect(await call("list_threads", { only_new: true, limit: 1 })).toMatchSnapshot("only new");
  });

  it("reads a thread, and refuses one that is not the user's", async () => {
    expect(await call("read_thread", { thread_id: w.thread })).toMatchSnapshot("read");
    expect(await call("read_thread", { thread_id: w.thread, max_messages: 1 })).toMatchSnapshot("max one");
    expect(await call("read_thread", { thread_id: "nope" })).toMatchSnapshot("missing");
  });

  it("lists the Screener by sender", async () => {
    expect(await call("list_screener", {})).toMatchSnapshot();
  });

  it("finds a contact, from the contacts and from the address book", async () => {
    expect(await call("find_contact", { query: "sender" })).toMatchSnapshot("found");
    expect(await call("find_contact", { query: "" })).toMatchSnapshot("empty");
    expect(await call("find_contact", { query: "zzz-nobody" })).toMatchSnapshot("none");
  });
});

describe("changing mail", () => {
  it("screens a sender in or out", async () => {
    expect(await call("screen_sender", { contact_id: w.contact, decision: "feed" })).toMatchSnapshot("feed");
    expect(await call("screen_sender", { contact_id: w.contact, decision: "pending" })).toMatchSnapshot("bad decision");
    expect(await call("screen_sender", { contact_id: "nope", decision: "feed" })).toMatchSnapshot("missing");
    expect(await call("set_contact_destination", { contact_id: w.contact, destination: "paper_trail", scope: "account" })).toMatchSnapshot("destination");
    expect(await call("set_contact_destination", { email: "sender@example.com", destination: "imbox" })).toMatchSnapshot("by email");
    expect(await call("set_contact_destination", { email: "sender@example.com", destination: "elsewhere" })).toMatchSnapshot("bad destination");
    expect(await call("set_contact_destination", { email: "nobody@example.com", destination: "imbox" })).toMatchSnapshot("no contact");
  });

  it("bundles and unbundles a sender", async () => {
    expect(await call("bundle_sender", { contact_id: w.contact })).toMatchSnapshot("bundle");
    expect(await call("bundle_sender", { email: "sender@example.com", bundled: false, scope: "account" })).toMatchSnapshot("unbundle");
    expect(await call("bundle_sender", { email: "nobody@example.com" })).toMatchSnapshot("missing");
  });

  it("acts on one thread", async () => {
    const t = w.thread;
    for (const input of [
      { action: "mark_read" }, { action: "mark_unread" }, { action: "reply_later" }, { action: "reply_later", on: false }, { action: "set_aside", on: true },
      { action: "bubble_up", at: 1893456000000 }, { action: "bubble_up" }, { action: "move", bucket: "feed" }, { action: "move", bucket: "nowhere" },
      { action: "label_add", label_id: w.label }, { action: "label_add" }, { action: "label_remove", label_id: w.label }, { action: "bundle", on: false },
      { action: "unsubscribe_info" }, { action: "dance" },
    ]) expect(await call("thread_action", { thread_id: t, ...input })).toMatchSnapshot(JSON.stringify(input).replace(w.label, "<label>"));
    expect(await call("thread_action", { thread_id: "nope", action: "mark_read" })).toMatchSnapshot("missing");
  });

  it("reads an unsubscribe link from a message header", async () => {
    await testEnv.DB.prepare(`UPDATE messages SET list_unsubscribe = '<https://example.org/u?x=1>, <mailto:stop@example.org>' WHERE thread_id = ?`).bind(w.thread).run();
    expect(await call("thread_action", { thread_id: w.thread, action: "unsubscribe_info" })).toMatchSnapshot();
  });
});

describe("labels, collections and clips", () => {
  it("lists labels and collections, and makes a collection", async () => {
    expect(await call("list_labels", {})).toMatchSnapshot("labels");
    expect(await call("list_collections", {})).toMatchSnapshot("collections");
    expect(await call("create_collection", { name: "  Taxes  ", description: "2030" })).toMatchSnapshot("create");
    expect(await call("create_collection", { name: "  " })).toMatchSnapshot("no name");
  });

  it("adds a thread to a collection, and clips text from it", async () => {
    expect(await call("add_to_collection", { thread_id: w.thread, collection_id: w.collection })).toMatchSnapshot("add");
    expect(await call("add_to_collection", { thread_id: w.thread, collection_id: "nope" })).toMatchSnapshot("missing");
    expect(await call("save_clip", { thread_id: w.thread, text: "worth keeping" })).toMatchSnapshot("clip");
    expect(await call("save_clip", { thread_id: w.thread, text: "" })).toMatchSnapshot("empty clip");
    expect(await call("save_clip", { thread_id: "nope", text: "x" })).toMatchSnapshot("clip missing");
  });
});

describe("drafting and sending", () => {
  it("drafts a new message, a reply, a reply to all and a forward", async () => {
    expect(await call("create_draft", { to: ["Sam@Example.org", "not an address"], subject: "Plan", body_text: "Hello\n\nSam" })).toMatchSnapshot("new");
    expect(await call("create_draft", { to: [], subject: "Plan", body_text: "x" })).toMatchSnapshot("new no to");
    expect(await call("create_draft", { to: ["a@b.co"], body_text: "x" })).toMatchSnapshot("new no subject");
    expect(await call("create_draft", { mode: "reply", thread_id: w.thread, body_text: "Thanks" })).toMatchSnapshot("reply");
    expect(await call("create_draft", { mode: "reply_all", thread_id: w.thread, body_text: "Thanks" })).toMatchSnapshot("reply all");
    expect(await call("create_draft", { mode: "forward", thread_id: w.thread, to: ["fw@example.org"], body_text: "FYI" })).toMatchSnapshot("forward");
    expect(await call("create_draft", { mode: "forward", thread_id: w.thread, body_text: "FYI" })).toMatchSnapshot("forward no to");
    expect(await call("create_draft", { mode: "reply", body_text: "Thanks" })).toMatchSnapshot("reply no thread");
    expect(await call("create_draft", { mode: "reply", thread_id: "nope", body_text: "x" }, { ...base(), threadHints: [w.thread] })).toMatchSnapshot("reply from hint");
    expect(await call("create_draft", { mode: "reply", thread_id: w.thread, body_text: "  " })).toMatchSnapshot("no body");
  });

  it("holds a send for the user unless sending is automatic", async () => {
    expect(await call("send_draft", { draft_id: w.draft })).toMatchSnapshot("held");
    expect(await call("send_draft", { draft_id: "nope" })).toMatchSnapshot("missing");
  });

  it("holds back sending and bulk changes once the model has read mail", async () => {
    const ctx = { ...base(), sawMailContent: true };
    expect(await call("send_draft", { draft_id: w.draft }, { ...ctx, autoSend: true })).toMatchSnapshot("send held back");
    expect(await call("remember", { content: "x" }, ctx)).toMatchSnapshot("remember refused");
    expect(await call("forget", { id: "x" }, ctx)).toMatchSnapshot("forget refused");
    expect(await call("bulk_thread_action", { action: "mark_read", thread_ids: [w.thread], confirm: true }, ctx)).toMatchSnapshot("bulk not applied");
  });

  it("marks that mail was read once a mail tool answered", async () => {
    const ctx = base();
    await runTool(ctx, "list_threads", {});
    expect(ctx.sawMailContent).toBe(true);
    const fresh = base();
    await runTool(fresh, "list_labels", {});
    expect(fresh.sawMailContent).toBeUndefined();
  });
});

describe("what the assistant remembers", () => {
  it("lists, remembers and forgets", async () => {
    expect(await call("list_memory", {})).toMatchSnapshot("list");
    expect(await call("remember", { kind: "tone", content: "Keep it short" })).toMatchSnapshot("remember");
    expect(await call("remember", { content: " " })).toMatchSnapshot("empty");
    expect(await call("forget", { id: w.memory })).toMatchSnapshot("forget");
    expect(await call("forget", { id: "nope" })).toMatchSnapshot("forget missing");
  });
});

describe("the calendar", () => {
  it("lists events in a range", async () => {
    expect(await call("list_events", { from: "2020-01-01", to: "2020-01-31" })).toMatchSnapshot("empty range");
    expect(await call("list_events", {})).toMatchSnapshot("next week");
    expect(await call("list_events", { from: "2030-02-01", to: "2030-01-01" })).toMatchSnapshot("reversed");
  });

  it("finds free time around busy events", async () => {
    expect(await call("find_free_time", { from_date: "2030-01-01" })).toMatchSnapshot("one day");
    expect(await call("find_free_time", { from_date: "2030-01-01", to_date: "2030-01-03", duration_minutes: 60, start_hour: 8, end_hour: 12 })).toMatchSnapshot("range");
    expect(await call("find_free_time", { from_date: "2030-01-01", duration_minutes: 10, start_hour: 30, end_hour: 3 })).toMatchSnapshot("clamped");
    expect(await call("find_free_time", { from_date: "nope" })).toMatchSnapshot("bad date");
    expect(await call("find_free_time", { from_date: "2030-01-05", to_date: "2030-01-01" })).toMatchSnapshot("reversed");
  });

  it("proposes an event as a card, and does not save it", async () => {
    expect(await call("propose_event", { title: "Review", date: "2030-03-04", start_time: "14:30", end_time: "15:15", attendees: ["a@b.co", "no"], location: "Room 2" })).toMatchSnapshot("timed");
    expect(await call("propose_event", { title: "Offsite", date: "2030-03-04", all_day: true })).toMatchSnapshot("all day");
    expect(await call("propose_event", { title: "Call", date: "2030-03-04", duration_minutes: 45 })).toMatchSnapshot("duration");
    expect(await call("propose_event", { title: "", date: "2030-03-04" })).toMatchSnapshot("no title");
    expect(await call("propose_event", { title: "x", date: "soon" })).toMatchSnapshot("bad date");
  });
});

describe("the Daily Brief, catching up and actions", () => {
  it("gives the brief for the day", async () => {
    expect(await call("get_daily_brief", {})).toMatchSnapshot();
  });

  it("catches up on a thread without an AI provider", async () => {
    expect(await call("catch_up_thread", { thread_id: w.thread })).toMatchSnapshot("thread");
    expect(await call("catch_up_thread", {})).toMatchSnapshot("no thread");
    expect(await call("catch_up_thread", {}, { ...base(), threadHints: [w.thread] })).toMatchSnapshot("from hint");
    expect(await call("catch_up_thread", { thread_id: "nope" })).toMatchSnapshot("missing");
  });

  it("finds actions on a thread, and across threads", async () => {
    expect(await call("find_thread_actions", { thread_id: w.thread })).toMatchSnapshot("thread");
    expect(await call("find_thread_actions", { thread_id: w.thread, kind: "task" })).toMatchSnapshot("kind");
    expect(await call("find_thread_actions", { thread_id: "nope" })).toMatchSnapshot("missing");
    expect(await call("find_thread_actions", {})).toMatchSnapshot("across");
  });

  it("lists noisy and misfiled senders", async () => {
    await testEnv.DB.prepare(`UPDATE contacts SET message_count = 9 WHERE id = ?`).bind(w.contact).run();
    expect(await call("list_noisy_or_misfiled_senders", {})).toMatchSnapshot("all");
    expect(await call("list_noisy_or_misfiled_senders", { kind: "noisy", limit: 1 })).toMatchSnapshot("noisy");
    expect(await call("list_noisy_or_misfiled_senders", { kind: "misfiled" })).toMatchSnapshot("misfiled");
  });
});

describe("changing many threads at once", () => {
  it("proposes a change, applies it when confirmed, and undoes it", async () => {
    expect(await call("bulk_thread_action", { action: "mark_read", thread_ids: [w.thread, other.thread] })).toMatchSnapshot("propose");
    const unread = async () => (await testEnv.DB.prepare(`SELECT unread FROM threads WHERE id = ?`).bind(other.thread).first<{ unread: number }>())!.unread;
    expect(await unread()).toBe(1);
    expect(await call("bulk_thread_action", { action: "mark_read", thread_ids: [w.thread, other.thread], confirm: true })).toMatchSnapshot("apply");
    expect(await unread()).toBe(0);
    expect(await call("undo_bulk_action", { thread_ids: [other.thread], restore_action: "mark_unread" })).toMatchSnapshot("undo");
    expect(await unread()).toBe(1);
  });

  it("selects threads by filter, and checks its input", async () => {
    expect(await call("bulk_thread_action", { action: "trash", current_bucket: "feed", from_sender: "news", confirm: true })).toMatchSnapshot("trash feed");
    expect(await call("bulk_thread_action", { action: "move", bucket: "imbox", query: "Invoice", unread_only: true })).toMatchSnapshot("move");
    expect(await call("bulk_thread_action", { action: "move", bucket: "nowhere", query: "x" })).toMatchSnapshot("bad bucket");
    expect(await call("bulk_thread_action", { action: "explode" })).toMatchSnapshot("bad action");
    expect(await call("bulk_thread_action", { action: "set_aside", query: "zzz-nothing" })).toMatchSnapshot("nothing");
    expect(await call("bulk_thread_action", { action: "reply_later", current_bucket: "set_aside" })).toMatchSnapshot("set aside source");
  });

  it("undoes into each kind of previous state", async () => {
    for (const restore_action of ["mark_read", "reply_later_off", "set_aside_off", "move"]) {
      expect(await call("undo_bulk_action", { thread_ids: [other.thread], restore_action, restore_bucket: "feed" })).toMatchSnapshot(restore_action);
    }
    expect(await call("undo_bulk_action", { thread_ids: [] })).toMatchSnapshot("none");
    expect(await call("undo_bulk_action", { thread_ids: ["nope"], restore_action: "mark_read" })).toMatchSnapshot("not the user's");
  });
});
