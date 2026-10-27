import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import { configFromEnv, start } from "../../server/run.mjs";

// Windows are told their mail changed: a real server, a real PostgreSQL (the trigger of migration 0027, LISTEN on the server's own connection) and a real
// event stream over HTTP. Needs `npm run build:node` first.
const URL = process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test";
const root = path.resolve(__dirname, "../..");

let app: { port: number; close: () => Promise<void>; pool: pg.Pool };
let cookie = "";
let owner = "";
let other = "";

async function http(method: string, p: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${app.port}${p}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}

/** An open event stream: what it has said so far, and a way to wait for the next thing. */
async function stream() {
  const abort = new AbortController();
  const res = await fetch(`http://127.0.0.1:${app.port}/api/events`, { headers: { cookie }, signal: abort.signal });
  const reader = res.body!.getReader();
  const seen: string[] = [];
  let ended = false;
  void (async () => {
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value);
        for (;;) {
          const i = buf.indexOf("\n\n");
          if (i < 0) break;
          const m = /event: (\w+)/.exec(buf.slice(0, i));
          if (m) seen.push(m[1] === "ready" && /"live":true/.test(buf.slice(0, i)) ? "ready:live" : m[1]);
          buf = buf.slice(i + 2);
        }
      }
    } catch {
      /* aborted */
    }
    ended = true;
  })();
  /** Wait until the stream has said one of these. */
  const until = async (event: string | string[], ms = 4000) => {
    const t = Date.now();
    const wanted = Array.isArray(event) ? event : [event];
    while (!wanted.some((e) => seen.includes(e))) {
      if (Date.now() - t > ms) throw new Error(`no ${wanted.join(" or ")} in ${ms} ms; saw: ${seen.join(", ") || "nothing"}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { res, seen, until, abort, get ended() { return ended; } };
}
const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("telling windows that mail changed", () => {
  const built = fs.existsSync(path.join(root, "node-dist/api.js")) && fs.existsSync(path.join(root, "dist/index.html"));
  if (!built) return it.skip("needs npm run build:node", () => {});

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: URL, max: 1 });
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await admin.end();
    app = await start({ ...configFromEnv({ DATABASE_URL: URL, SESSION_SECRET: "test-secret-test-secret-test-secret" }), port: 0, cronSeconds: 0 });
    expect((await http("POST", "/auth/setup", { email: "owner@test.local", password: "correct-horse-battery-staple", name: "Owner" })).status).toBe(200);
    const q = (sql: string, ...p: unknown[]) => app.pool.query(sql, p);
    owner = (await q("SELECT id FROM users LIMIT 1")).rows[0].id;
    await q(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('other', 'other@test.local', '', 'x', 1)`);
    other = "other";
    const t = Date.now();
    for (const [acc, user] of [["acc-o", owner], ["acc-x", other]]) {
      await q(`INSERT INTO accounts (id, user_id, provider, email, display_name, created_at) VALUES ($1, $2, 'imap', $1 || '@test.local', '', $3)`, acc, user, t);
      for (const n of [1, 2, 3]) {
        await q(`INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, first_message_at, last_message_at, participants_json, created_at, updated_at) VALUES ($1, $2, $1, 'S', '', 'imbox', $3, $3, '[]', $3, $3)`, `${acc}-t${n}`, acc, t);
      }
    }
  }, 60_000);
  afterAll(() => app?.close());

  it("says it is ready and listening, then tells the owner when their own thread changes", async () => {
    const s = await stream();
    expect(s.res.headers.get("content-type")).toMatch(/event-stream/);
    await s.until(["ready:live", "up"]);
    await app.pool.query(`UPDATE threads SET unread = 1, updated_at = $1 WHERE id = 'acc-o-t1'`, [Date.now()]);
    await s.until("changed");
    s.abort.abort();
  });

  it("does not tell the owner about another person's mail", async () => {
    const s = await stream();
    await s.until(["ready:live", "up"]);
    await app.pool.query(`UPDATE threads SET unread = 1, updated_at = $1 WHERE id = 'acc-x-t1'`, [Date.now()]);
    await quiet(600);
    expect(s.seen).not.toContain("changed");
    s.abort.abort();
  });

  it("makes one event of a whole batch of changes, and tells on insert and delete as well", async () => {
    const s = await stream();
    await s.until(["ready:live", "up"]);
    await app.pool.query(`UPDATE threads SET updated_at = $1 WHERE account_id = 'acc-o'`, [Date.now()]);
    await s.until("changed");
    await quiet(500);
    expect(s.seen.filter((e) => e === "changed")).toHaveLength(1);
    await app.pool.query(`INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, first_message_at, last_message_at, participants_json, created_at, updated_at) VALUES ('acc-o-new', 'acc-o', 'new', 'S', '', 'imbox', 1, 1, '[]', 1, 1)`);
    await quiet(500);
    expect(s.seen.filter((e) => e === "changed")).toHaveLength(2);
    await app.pool.query(`DELETE FROM threads WHERE id = 'acc-o-new'`);
    await quiet(500);
    expect(s.seen.filter((e) => e === "changed")).toHaveLength(3);
    s.abort.abort();
  });

  it("tells every window the person has open", async () => {
    const [a, b] = [await stream(), await stream()];
    await a.until(["ready:live", "up"]);
    await b.until(["ready:live", "up"]);
    await app.pool.query(`UPDATE threads SET unread = 0, updated_at = $1 WHERE id = 'acc-o-t2'`, [Date.now()]);
    await Promise.all([a.until("changed"), b.until("changed")]);
    a.abort.abort();
    b.abort.abort();
  });

  it("says down when the server's connection to PostgreSQL is cut, and up and changed when it is back", async () => {
    const s = await stream();
    await s.until(["ready:live", "up"]);
    await app.pool.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'imbox-listener'`);
    await s.until("down");
    await s.until("up", 8000);
    await s.until("changed", 8000);
    // And it listens again.
    const before = s.seen.filter((e) => e === "changed").length;
    await app.pool.query(`UPDATE threads SET unread = 1, updated_at = $1 WHERE id = 'acc-o-t3'`, [Date.now()]);
    for (let i = 0; i < 100 && s.seen.filter((e) => e === "changed").length === before; i++) await quiet(30);
    expect(s.seen.filter((e) => e === "changed").length).toBeGreaterThan(before);
    s.abort.abort();
  }, 30_000);

  it("tells the owner when a mailbox's state or settings change, but not for a sync that only stamps its time", async () => {
    const s = await stream();
    await s.until(["ready:live", "up"]);
    const count = () => s.seen.filter((e) => e === "accounts").length;
    const settle = async (n: number) => {
      for (let i = 0; i < 100 && count() < n; i++) await quiet(30);
      await quiet(300);
      return count();
    };
    // Stamped by every few syncs, and tokens refreshed: nothing on screen changes.
    await app.pool.query(`UPDATE accounts SET last_synced_at = $1, access_token = 'new', history_id = '9' WHERE id = 'acc-o'`, [Date.now()]);
    await quiet(500);
    expect(count()).toBe(0);
    // A sync that fails, and one that recovers.
    await app.pool.query(`UPDATE accounts SET sync_status = 'error', sync_error = 'connection refused' WHERE id = 'acc-o'`);
    expect(await settle(1)).toBe(1);
    await app.pool.query(`UPDATE accounts SET sync_status = 'idle', sync_error = NULL WHERE id = 'acc-o'`);
    expect(await settle(2)).toBe(2);
    // Renamed.
    await app.pool.query(`UPDATE accounts SET display_name = 'Work' WHERE id = 'acc-o'`);
    expect(await settle(3)).toBe(3);
    // Added and removed, on the other person's side or the owner's.
    await app.pool.query(`INSERT INTO accounts (id, user_id, provider, email, display_name, created_at) VALUES ('acc-x2', 'other', 'imap', 'x2@test.local', '', 1)`);
    await quiet(500);
    expect(count()).toBe(3);
    await app.pool.query(`INSERT INTO accounts (id, user_id, provider, email, display_name, created_at) VALUES ('acc-o2', $1, 'imap', 'o2@test.local', '', 1)`, [owner]);
    expect(await settle(4)).toBe(4);
    await app.pool.query(`DELETE FROM accounts WHERE id = 'acc-o2'`);
    expect(await settle(5)).toBe(5);
    s.abort.abort();
  });

  it("tells whether the server syncs the mailboxes by itself", async () => {
    const first = async (port: number) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie } });
      const reader = res.body!.getReader();
      const text = new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();
      return text;
    };
    // This server was started with the once-a-minute job off.
    expect(await first(app.port)).toContain('"syncs":false');
    // One started the normal way syncs by itself (the job is stopped again before its first run).
    const syncing = await start({ ...configFromEnv({ DATABASE_URL: URL, SESSION_SECRET: "test-secret-test-secret-test-secret" }), port: 0, cronSeconds: 3600 });
    try {
      expect(await first(syncing.port)).toContain('"syncs":true');
    } finally {
      await syncing.close();
    }
  });

  it("is closed when the server is, without waiting for the window to go away", async () => {
    const s = await stream();
    await s.until(["ready:live", "up"]);
    const t = Date.now();
    await app.close();
    expect(Date.now() - t).toBeLessThan(4000);
    for (let i = 0; i < 100 && !s.ended; i++) await quiet(20);
    expect(s.ended).toBe(true);
  });
});
