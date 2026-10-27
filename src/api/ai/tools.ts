// Tools the assistant can call. Every tool is scoped to the signed-in user's accounts. Each tool is a handler in ./tools/, grouped by what it works on.
import type Anthropic from "@anthropic-ai/sdk";
import type { Address } from "@shared/types";
import type { ToolContext } from "./tools/context";
import { ownedRow, safeJson } from "../db";
import { runFor, type Handler, type ToolResult } from "./tools/context";
import * as bulk from "./tools/bulk";
import * as brief from "./tools/brief";
import * as calendar from "./tools/calendar";
import * as compose from "./tools/compose";
import * as contacts from "./tools/contacts";
import * as mail from "./tools/mail";
import * as memory from "./tools/memory";
import * as organize from "./tools/organize";
import * as workflows from "./tools/workflows";

export { TOOLS } from "./tools/definitions";
export type { ToolContext } from "./tools/context";

const HANDLERS: Record<string, Handler> = { ...mail, ...organize, ...contacts, ...compose, ...memory, ...calendar, ...brief, ...bulk, ...workflows };

/** Tools whose results carry text a stranger wrote: a message, a subject, a sender's name, an invitation. */
export const MAIL_CONTENT_TOOLS = new Set([
  "search_mail", "list_threads", "read_thread", "list_screener", "find_contact", "list_events", "get_daily_brief", "catch_up_thread", "find_thread_actions", "list_noisy_or_misfiled_senders",
]);

/** True when the conversation holds mail: a tool returned some, or the user attached a thread (its text is a stranger's words too). */
export function usedMailContent(messages: Anthropic.MessageParam[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      (m.content as Anthropic.ContentBlockParam[]).some((b) => (b.type === "tool_use" && MAIL_CONTENT_TOOLS.has(b.name)) || (m.role === "user" && b.type === "text" && b.text.startsWith("[[context thread="))),
  );
}

/** Everyone on a thread: who wrote to it, who it was sent to, who was copied. */
async function threadPeople(db: Db, threadId: string): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT from_email, to_json, cc_json FROM messages WHERE thread_id = ?`).bind(threadId).all<{ from_email: string; to_json: string; cc_json: string }>();
  const out = new Set<string>();
  for (const r of rows.results) {
    out.add((r.from_email ?? "").toLowerCase());
    for (const a of [...safeJson<Address[]>(r.to_json, []), ...safeJson<Address[]>(r.cc_json, [])]) out.add((a.email ?? "").toLowerCase());
  }
  return out;
}

/**
 * Once the model has read mail, a stranger's words are in its context, and it can be talked into anything. Doing the owner's own work still goes
 * ahead; what could hurt them if the words were an attack is held back until they say so:
 *  - a message goes out by itself only to people already on the thread it answers (never a new recipient, never a forward);
 *  - a bulk change is proposed on a card, not applied, whatever the model says about confirming it;
 *  - what the assistant remembers about the owner cannot be changed, since a planted "memory" would steer every later conversation.
 * The prompt asks the model to behave; this is what holds when it does not.
 */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolResult> {
  let input = rawInput;
  if (ctx.sawMailContent) {
    const obj = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
    if (name === "remember" || name === "forget") {
      const msg = "The assistant read mail in this conversation, so it cannot change what it remembers. Ask the user to say it again in a new message.";
      return { result: JSON.stringify({ error: msg }), summary: msg, isError: true };
    }
    if (name === "bulk_thread_action" && obj.confirm === true) input = { ...obj, confirm: false };
    if (name === "send_draft") {
      const row = await ownedRow<any>(ctx.env.DB, "drafts", String(obj.draft_id ?? ""), ctx.user.id);
      let inThread = false;
      if (row?.thread_id) {
        const people = await threadPeople(ctx.env.DB, row.thread_id);
        const to = [...safeJson<Address[]>(row.to_json, []), ...safeJson<Address[]>(row.cc_json, []), ...safeJson<Address[]>(row.bcc_json, [])];
        inThread = to.length > 0 && to.every((a) => people.has((a.email ?? "").toLowerCase()));
      }
      if (row && !inThread) return { result: JSON.stringify({ needs_confirmation: true, draft_id: row.id }), summary: "Waiting for the user to press Send" };
    }
  }
  const r = await runToolInner(ctx, name, input);
  if (!r.isError && MAIL_CONTENT_TOOLS.has(name)) ctx.sawMailContent = true;
  return r;
}

async function runToolInner(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolResult> {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, any>;
  const run = runFor(ctx, input);
  if (!run.ids.length && !["list_memory", "remember", "forget"].includes(name)) return run.fail("No mail accounts are connected yet.");
  if (!Object.hasOwn(HANDLERS, name)) return run.fail(`Unknown tool ${name}`);
  return HANDLERS[name](run);
}
