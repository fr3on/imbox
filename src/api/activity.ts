// The activity log: what happened in this person's imbox, by whom, and why. New events are written here; the page also reads the older records the app
// already kept (the sync log, agent runs and AI calls), so it has history from the first day.

import { aiFeatureName } from "@shared/aiFeatures";
import { now } from "./db";

export type Actor = "you" | "rules" | "ai" | "agent" | "sync" | "security";
export const ACTORS: Actor[] = ["you", "rules", "ai", "agent", "sync", "security"];
export type Level = "info" | "warn" | "error";

export interface ActivityInput {
  actor: Actor;
  /** A short machine word for what kind of thing it was ("move", "let_in", "send", "sign_in"). */
  kind: string;
  /** One sentence, no markup. Names and subjects, never message text. */
  summary: string;
  /** Why, in a few words. */
  why?: string;
  threadId?: string | null;
  accountId?: string | null;
  level?: Level;
}

export interface ActivityRow {
  /** Where it was read from, so two rows never share a key. */
  sid: string;
  at: number;
  actor: Actor;
  kind: string;
  summary: string;
  why: string;
  thread_id: string | null;
  account_id: string | null;
  level: Level;
}

const BUCKET_NAME: Record<string, string> = { imbox: "the Imbox", feed: "the Feed", paper_trail: "Receipts", screener: "the Screener", screened_out: "Screened out", trash: "the Trash", previously_seen: "Previously seen" };

/**
 * What a thread action says in a sentence, and its kind. `what` is the subject for one thread, or "12 conversations" for many. Null for the ones that are
 * only reading (marking read, the seen mark), which would bury everything else.
 */
export function actionSentence(body: { action?: string; on?: boolean; bucket?: string }, what: string, many = false): { kind: string; summary: string } | null {
  const w = many ? what : `\u201c${what}\u201d`;
  switch (body.action) {
    case "reply_later":
      return { kind: "reply_later", summary: body.on === false ? `Took ${w} out of Reply Later` : `Put ${w} in Reply Later` };
    case "set_aside":
      return { kind: "set_aside", summary: body.on === false ? `Took ${w} out of Set Aside` : `Set ${w} aside` };
    case "bubble_up":
      return { kind: "bubble_up", summary: `Set ${w} to bubble up later` };
    case "move":
      return { kind: "move", summary: `Moved ${w} to ${BUCKET_NAME[body.bucket ?? ""] ?? body.bucket ?? "another place"}` };
    case "delete":
      return { kind: "delete", summary: `Deleted ${w} for good` };
    case "mark_unread":
      return { kind: "mark_unread", summary: `Marked ${w} unread` };
    case "labels":
      return { kind: "labels", summary: `Changed the labels on ${w}` };
    case "collections":
      return { kind: "collections", summary: `Changed the collections of ${w}` };
    case "bundle":
      return { kind: "bundle", summary: body.on === false ? `Unbundled the sender of ${w}` : `Bundled the sender of ${w}` };
    case "rename":
      return { kind: "rename", summary: `Renamed ${w}` };
    case "note":
      return { kind: "note", summary: `Changed the note on ${w}` };
    case "merge":
      return { kind: "merge", summary: `Merged ${w} with another conversation` };
    default:
      return null;
  }
}

/** "Chrome on macOS" from a user agent: enough to tell your own devices apart, and nothing that identifies a person. */
export function deviceOf(ua: string | null | undefined): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "a browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export const RETENTION_MS = 90 * 24 * 3600_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);

/** Write one event. Never throws: a log that fails must not fail the thing it describes. */
export async function logActivity(db: Db, userId: string, e: ActivityInput): Promise<void> {
  try {
    await db
      .prepare(`INSERT INTO activity_log (user_id, at, actor, kind, summary, why, thread_id, account_id, level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, now(), e.actor, e.kind, clip(e.summary, 300), clip(e.why ?? "", 400), e.threadId ?? null, e.accountId ?? null, e.level ?? "info")
      .run();
  } catch {
    /* not worth failing for */
  }
}

/** The subject of a thread, for a sentence about it. Empty when it is gone. */
export async function threadSubject(db: Db, threadId: string): Promise<string> {
  const r = await db.prepare(`SELECT COALESCE(custom_subject, subject) AS s FROM threads WHERE id = ?`).bind(threadId).first<{ s: string | null }>();
  return (r?.s ?? "").trim() || "(no subject)";
}

export async function pruneActivity(db: Db, t = now()): Promise<void> {
  await db.prepare(`DELETE FROM activity_log WHERE at < ?`).bind(t - RETENTION_MS).run();
}

export interface ActivityQuery {
  actor?: Actor | null;
  problems?: boolean;
  q?: string;
  threadId?: string | null;
  /** The cursor of the last row seen: "at|sid". */
  before?: string | null;
  limit?: number;
}

const PAGE = 50;

/** One page of events, newest first, from the log and from the records older parts of the app keep. */
export async function listActivity(db: Db, userId: string, o: ActivityQuery): Promise<{ events: ActivityRow[]; next: string | null }> {
  const limit = Math.min(Math.max(o.limit ?? PAGE, 1), 200);
  let cutAt: number | null = null;
  let cutSid = "";
  if (o.before) {
    const i = o.before.indexOf("|");
    const at = Number(o.before.slice(0, i));
    if (i > 0 && Number.isFinite(at)) {
      cutAt = at;
      cutSid = o.before.slice(i + 1);
    }
  }
  const branches: { sql: string; params: unknown[] }[] = [];
  const add = (actor: Actor | null, build: (sid: string) => { sql: string; params: unknown[] }) => {
    if (o.actor && actor && o.actor !== actor) return;
    if (o.actor && !actor) return;
    branches.push(build(actor ?? ""));
  };
  const cut = (at: string, sid: string) => (cutAt == null ? { sql: "", params: [] as unknown[] } : { sql: ` AND (${at} < ? OR (${at} = ? AND ${sid} < ?))`, params: [cutAt, cutAt, cutSid] });
  const like = o.q?.trim() ? `%${o.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  // The log itself.
  {
    const c = cut("at", "('l:' || id::text)");
    const extra = [o.actor ? " AND actor = ?" : "", o.problems ? " AND level <> 'info'" : "", o.threadId ? " AND thread_id = ?" : "", like ? " AND (summary ILIKE ? OR why ILIKE ?)" : ""].join("");
    branches.push({
      sql: `(SELECT ('l:' || id::text) AS sid, at, actor, kind, summary, why, thread_id, account_id, level FROM activity_log WHERE user_id = ?${extra}${c.sql} ORDER BY at DESC, id DESC LIMIT ${limit + 1})`,
      params: [userId, ...(o.actor ? [o.actor] : []), ...(o.threadId ? [o.threadId] : []), ...(like ? [like, like] : []), ...c.params],
    });
  }
  // The sync log: system messages about each mailbox.
  if (!o.threadId) {
    add("sync", () => {
      const c = cut("l.created_at", "('s:' || l.id::text)");
      const extra = [o.problems ? " AND l.level <> 'info'" : "", like ? " AND l.message ILIKE ?" : ""].join("");
      return {
        sql: `(SELECT ('s:' || l.id::text) AS sid, l.created_at AS at, 'sync' AS actor, 'sync' AS kind, l.message AS summary, '' AS why, NULL::text AS thread_id, l.account_id, l.level FROM sync_log l JOIN accounts a ON a.id = l.account_id WHERE a.user_id = ?${extra}${c.sql} ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit + 1})`,
        params: [userId, ...(like ? [like] : []), ...c.params],
      };
    });
  }
  // What each AI call was for.
  if (!o.threadId && !o.problems) {
    add("ai", () => {
      const c = cut("created_at", "('a:' || id)");
      return {
        sql: `(SELECT ('a:' || id) AS sid, created_at AS at, 'ai' AS actor, 'ai_call' AS kind, ('Asked the AI: ' || feature) AS summary, (model || ' \u00b7 ' || (input_tokens + output_tokens) || ' tokens \u00b7 ' || ms || ' ms') AS why, NULL::text AS thread_id, NULL::text AS account_id, CASE WHEN ok = 1 THEN 'info' ELSE 'error' END AS level FROM ai_calls WHERE user_id = ?${like ? " AND feature ILIKE ?" : ""}${c.sql} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1})`,
        params: [userId, ...(like ? [like] : []), ...c.params],
      };
    });
  }
  // Agent runs.
  add("agent", () => {
    const c = cut("created_at", "('g:' || id)");
    const extra = [o.problems ? " AND status = 'error'" : "", o.threadId ? " AND thread_id = ?" : "", like ? " AND (summary ILIKE ? OR subject ILIKE ?)" : ""].join("");
    return {
      sql: `(SELECT ('g:' || id) AS sid, created_at AS at, 'agent' AS actor, 'agent_run' AS kind, ('Agent ' || status || ': ' || COALESCE(NULLIF(subject, ''), '(no subject)')) AS summary, summary AS why, thread_id, account_id, CASE WHEN status = 'error' THEN 'error' ELSE 'info' END AS level FROM auto_agent_runs WHERE user_id = ?${extra}${c.sql} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1})`,
      params: [userId, ...(o.threadId ? [o.threadId] : []), ...(like ? [like, like] : []), ...c.params],
    };
  });

  const rows = await db
    .prepare(`SELECT * FROM (${branches.map((b) => b.sql).join(" UNION ALL ")}) u ORDER BY at DESC, sid DESC NULLS LAST LIMIT ${limit + 1}`)
    .bind(...branches.flatMap((b) => b.params))
    .all<ActivityRow>();
  // An AI call is written down under its feature key ("jev_screener"); the page says what that is called everywhere else.
  const page = rows.results.slice(0, limit).map((r) => (r.kind === "ai_call" ? { ...r, summary: `Asked the AI: ${aiFeatureName(r.summary.replace(/^Asked the AI: /, ""))}` } : r));
  const last = page[page.length - 1];
  return { events: page, next: rows.results.length > limit && last ? `${last.at}|${last.sid}` : null };
}
