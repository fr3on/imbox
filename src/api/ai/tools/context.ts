import type { Env } from "../../env";
import type { ThreadSummary } from "@shared/types";
import { type AccountRow, type ContactRow, type ThreadRow, inClause, now, ownedRow, uid } from "../../db";

export interface ToolContext {
  env: Env;
  user: { id: string; email: string; name: string };
  accounts: AccountRow[];
  autoSend: boolean;
  /** Sent by an agent on its own: outgoing mail is marked `Auto-Submitted` so other autoresponders leave it alone. */
  autoSubmitted?: boolean;
  /**
   * Threads this conversation has been about, most recent first: attached as context, or read by a tool.
   * A reply names its thread through the model, and a model that has moved on to the next question
   * sometimes leaves it out; this is what such a reply falls back to.
   */
  threadHints?: string[];
  /** Set once a tool has returned mail: from then on runTool holds back what a message could talk the model into. */
  sawMailContent?: boolean;
  /** Streams a UI event (draft cards etc.). */
  emit: (event: { type: string; [k: string]: unknown }) => void;
}

/** Minimal Hono-context shim so the route helpers (thread detail, actions) can be reused unchanged. */
export function shim(ctx: ToolContext, threadAccount?: AccountRow | null) {
  const ids = ctx.accounts.map((a) => a.id);
  const vars: Record<string, unknown> = { user: ctx.user, accountIds: ids, allAccountIds: ids, account: threadAccount ?? ctx.accounts[0] ?? null };
  return {
    env: ctx.env,
    get: (k: string) => vars[k],
    req: { param: () => undefined, query: (k: string) => (k === "peek" ? "1" : undefined), json: async () => ({}) },
    executionCtx: { waitUntil: (_p: Promise<unknown>) => {} },
    json: (body: unknown, status?: number) => ({ body, status }),
  } as any;
}

export function summary(t: ThreadSummary) {
  return {
    thread_id: t.id,
    subject: t.subject,
    from: t.last_from.name ? `${t.last_from.name} <${t.last_from.email}>` : t.last_from.email,
    participants: t.participants.map((p) => p.email),
    snippet: t.snippet.slice(0, 160),
    bucket: t.bucket,
    unread: t.unread,
    new: !t.seen,
    reply_later: t.reply_later,
    set_aside: t.set_aside,
    messages: t.message_count,
    last_message_at: new Date(t.last_message_at).toISOString(),
    labels: t.labels.map((l) => l.name),
    account_id: t.account_id,
  };
}

export async function ownedThreadRow(ctx: ToolContext, id: string): Promise<ThreadRow | null> {
  return ownedRow<ThreadRow>(ctx.env.DB, "threads", id, ctx.user.id);
}

export function accountById(ctx: ToolContext, id: string): AccountRow | undefined {
  return ctx.accounts.find((a) => a.id === id);
}

export async function resolveContact(ctx: ToolContext, email?: string | null, contactId?: string | null): Promise<ContactRow | null> {
  const db = ctx.env.DB;
  if (contactId) {
    const row = await ownedRow<ContactRow>(db, "contacts", contactId, ctx.user.id);
    if (row) return row;
  }
  if (email?.trim()) {
    const cleanEmail = email.trim().toLowerCase();
    const ids = ctx.accounts.map((a) => a.id);
    if (!ids.length) return null;
    const sc = inClause(ids);
    const row = await db
      .prepare(`SELECT * FROM contacts WHERE account_id IN ${sc.sql} AND LOWER(email) = ? ORDER BY last_seen_at DESC LIMIT 1`)
      .bind(...sc.params, cleanEmail)
      .first<ContactRow>();
    if (row) return row;

    const thread = await db
      .prepare(`SELECT account_id, last_from_name FROM threads WHERE account_id IN ${sc.sql} AND LOWER(last_from_email) = ? ORDER BY last_message_at DESC LIMIT 1`)
      .bind(...sc.params, cleanEmail)
      .first<{ account_id: string; last_from_name: string }>();
    if (thread) {
      return {
        id: uid(),
        account_id: thread.account_id,
        email: cleanEmail,
        name: thread.last_from_name || "",
        screen_status: "pending",
        screened_at: null,
        first_seen_at: now(),
        last_seen_at: now(),
        message_count: 1,
        notes: "",
        avatar_url: "",
        bundled: 0,
        photo_checked_at: null,
      };
    }

    if (ctx.accounts.length > 0) {
      return {
        id: uid(),
        account_id: ctx.accounts[0].id,
        email: cleanEmail,
        name: "",
        screen_status: "pending",
        screened_at: null,
        first_seen_at: now(),
        last_seen_at: now(),
        message_count: 0,
        notes: "",
        avatar_url: "",
        bundled: 0,
        photo_checked_at: null,
      };
    }
  }
  return null;
}

export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function parseUnsubscribe(header: string): { url?: string; mailto?: string } {
  const out: { url?: string; mailto?: string } = {};
  for (const m of header.matchAll(/<([^>]+)>/g)) {
    const v = m[1].trim();
    if (/^https?:/i.test(v) && !out.url) out.url = v;
    if (/^mailto:/i.test(v) && !out.mailto) out.mailto = v.replace(/^mailto:/i, "").split("?")[0];
  }
  return out;
}

export type ToolResult = { result: string; summary: string; isError?: boolean };

/** What a tool is handed: the conversation, its input, and the pieces nearly every tool needs. */
export interface Run {
  ctx: ToolContext;
  input: Record<string, any>;
  db: Db;
  ids: string[];
  sc: ReturnType<typeof inClause>;
  t: number;
  /** SQL for a thread that is not merged away and not waiting to bubble up. Bind `t` to its `?`. */
  VISIBLE: string;
  ok: (data: unknown, summaryText: string) => ToolResult;
  fail: (msg: string) => ToolResult;
}
export type Handler = (run: Run) => Promise<ToolResult>;

export function runFor(ctx: ToolContext, input: Record<string, any>): Run {
  const ids = ctx.accounts.map((a) => a.id);
  return {
    ctx,
    input,
    db: ctx.env.DB,
    ids,
    sc: inClause(ids),
    t: now(),
    VISIBLE: `t.merged_into IS NULL AND (t.bubble_up_at IS NULL OR t.bubble_up_at <= ?)`,
    ok: (data, summaryText) => ({ result: JSON.stringify(data), summary: summaryText }),
    fail: (msg) => ({ result: JSON.stringify({ error: msg }), summary: msg, isError: true }),
  };
}

/** A string input, trimmed; "" when it is missing or not a string. */
export const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The places that are a flag on a thread rather than a bucket of their own. */
export const FLAGGED: Record<string, string> = {
  reply_later: `t.reply_later = 1 AND t.bucket <> 'trash'`,
  set_aside: `t.set_aside = 1 AND t.bucket <> 'trash'`,
};
