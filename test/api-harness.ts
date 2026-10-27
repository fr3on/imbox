import worker from "../src/api/index";
import { testEnv, migrate } from "./helpers";
import { pool } from "./support/env";
import { seedAccount } from "./agent-fixtures";

/**
 * Drives the whole Worker (`fetch`), not one router, so the real middleware runs: requireUser, requireAccount, the JSON body guard and the
 * error handler. A route test written against this sees exactly what a browser sees.
 */
const background: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void background.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
const db = () => testEnv.DB;

export { migrate, seedAccount, testEnv };

/** Empty every table (not the migration ledger), so each test file starts from nothing. */
export async function wipeAll(): Promise<void> {
  const db = await pool();
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'd1_migrations'`)).rows.map((r: { tablename: string }) => `"${r.tablename}"`);
  if (tables.length) await db.query(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
}

/** A user with a live session. Returns the bearer token. */
export async function signIn(userId: string): Promise<string> {
  const t = Date.now();
  await db().prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, 'x', ?) ON CONFLICT DO NOTHING`).bind(userId, `${userId}@test.local`, userId, t).run();
  const token = `tok-${userId}`;
  await db().prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, 'test') ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at, expires_at = excluded.expires_at, user_agent = excluded.user_agent`).bind(token, userId, t, t + 3_600_000).run();
  return token;
}

export interface CallOptions {
  token?: string | null;
  body?: unknown;
  /** Send this string as the body as it is (for malformed JSON). */
  raw?: string;
  headers?: Record<string, string>;
}

/** One request through the Worker. `path` starts at `/api/...`, `/auth/...` or `/agent/v1/...`. */
export async function call(method: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    headers["content-type"] ??= "application/json";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] ??= "application/json";
  }
  await migrate();
  const res = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body }), testEnv, ctx);
  // What a route hands to waitUntil still runs to the end, as it would on the server; a test must not leave it running behind it.
  const text = await res.clone().arrayBuffer().catch(() => null);
  void text;
  await Promise.allSettled(background.splice(0));
  return res;
}

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let seq = 0;
export const nid = (p: string) => `${p}-${++seq}`;

/** A thread with one message in an account, in the Imbox. */
export async function seedThread(accountId: string, o: { id?: string; subject?: string; bucket?: string; from?: string } = {}): Promise<{ thread: string; message: string }> {
  const thread = o.id ?? nid("t");
  const message = nid("m");
  const t = Date.now();
  const from = o.from ?? "sender@example.com";
  await db()
    .prepare(
      `INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, seen, unread, first_message_at, last_message_at, last_from_email, last_from_name, participants_json, message_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'snippet', ?, 0, 1, ?, ?, ?, 'Sender', ?, 1, ?, ?)`
    )
    .bind(thread, accountId, thread, o.subject ?? "Hello", o.bucket ?? "imbox", t, t, from, JSON.stringify([{ email: from, name: "Sender" }]), t, t)
    .run();
  await db()
    .prepare(
      `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, cc_json, reply_to, subject, date, snippet, text_body, html_body, is_from_me, unread, message_id_header, created_at)
       VALUES (?, ?, ?, ?, ?, 'Sender', '[]', '[]', '', ?, ?, 'snippet', 'body', '<p>body</p>', 0, 1, ?, ?)`
    )
    .bind(message, accountId, thread, `g-${message}`, from, o.subject ?? "Hello", t, `<${message}@example.com>`, t)
    .run();
  return { thread, message };
}
