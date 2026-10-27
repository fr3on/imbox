import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM without types
import { configFromEnv, start } from "../../server/run.mjs";

// The whole self-hosted stack, talking to a real Postgres through the gateway, over HTTP. Needs `npm run build:node` first.
const URL = process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test";
const root = path.resolve(__dirname, "../..");

let app: { port: number; close: () => Promise<void>; tick: () => Promise<void>; pool: pg.Pool };
let cookie = "";

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${app.port}${p}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

describe("self-hosted server on Postgres", () => {
  const built = fs.existsSync(path.join(root, "node-dist/api.js")) && fs.existsSync(path.join(root, "dist/index.html"));
  if (!built) return it.skip("needs npm run build:node", () => {});
  cookie = "";
  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: URL, max: 1 });
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await admin.end();
    app = await start({ ...configFromEnv({ DATABASE_URL: URL, SESSION_SECRET: "test-secret-test-secret-test-secret" }), port: 0, cronSeconds: 0 });
  }, 60_000);
  afterAll(() => app?.close());

  it("reports healthy and serves the app shell", async () => {
    expect((await call("GET", "/healthz")).json).toEqual({ ok: true });
    const page = await call("GET", "/some/spa/route");
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="root"');
  });

  it("sets up an owner and signs in", async () => {
    expect((await call("GET", "/auth/status")).json.setup_required).toBe(true);
    const setup = await call("POST", "/auth/setup", { email: "owner@test.local", password: "correct-horse-battery-staple", name: "Owner" });
    expect(setup.status).toBe(200);
    expect((await call("GET", "/api/me")).status).toBe(200);
  });

  it("lists, moves, labels and deletes threads", async () => {
    const user = (await app.pool.query("SELECT id FROM users LIMIT 1")).rows[0].id;
    const now = 1780000000000;
    await app.pool.query(`INSERT INTO accounts (id,user_id,provider,email,display_name,initial_sync_done,sync_status,created_at) VALUES ('acc1',$1,'imap','me@example.com','Me',1,'idle',$2)`, [user, now]);
    for (let i = 1; i <= 6; i++) {
      await app.pool.query(
        `INSERT INTO threads (id,account_id,gmail_thread_id,subject,snippet,bucket,seen,unread,first_message_at,last_message_at,created_at,updated_at) VALUES ($1,'acc1',$1,$2,'snip','imbox',0,1,$3,$3,$3,$3)`,
        [`t${i}`, `Subject ${i}`, now + i * 1000],
      );
      await app.pool.query(
        `INSERT INTO messages (id,account_id,thread_id,gmail_message_id,from_email,from_name,to_json,cc_json,reply_to,subject,date,snippet,text_body,html_body,is_from_me,unread,message_id_header,created_at) VALUES ($1,'acc1',$2,$1,$3,'Sender','[]','[]','',$4,$5,'snip','body','<p>body</p>',0,1,$6,$5)`,
        [`m${i}`, `t${i}`, `s${i % 2}@ex.com`, `Subject ${i}`, now + i * 1000, `<m${i}@ex>`],
      );
    }
    expect((await call("GET", "/api/imbox")).json.new_threads.length).toBeGreaterThan(0);
    expect((await call("POST", "/api/threads/t1/actions", { action: "move", bucket: "feed" })).json.bucket).toBe("feed");
    expect((await call("GET", "/api/counts")).json.feed_new).toBe(1);
    expect((await call("POST", "/api/threads/bulk", { action: "mark_read", thread_ids: ["t2", "t3"] })).json.count).toBe(2);

    const label = (await call("POST", "/api/labels", { name: "Work", color: "#3b82f6" })).json;
    await call("POST", "/api/threads/t4/actions", { action: "labels", add: [label.id] });
    expect((await call("GET", `/api/threads?label=${label.id}`)).json.threads.map((t: any) => t.id)).toEqual(["t4"]);

    expect((await call("GET", "/api/search?q=body")).json.threads.length).toBe(6);
    expect((await call("POST", "/api/threads/t5/actions", { action: "delete" })).json.deleted).toBe(true);
    expect((await call("GET", "/api/contacts")).status).toBe(200);
  });

  it("answers input it cannot use with a 4xx, never a 500", async () => {
    // A body that is not an object, a field of the wrong type, a page number past what Postgres can offset by, a search box with a very long paste in it.
    expect((await call("POST", "/api/labels", null)).status).toBe(400);
    expect((await call("PATCH", "/api/me", { settings: "text" })).status).toBe(400);
    expect((await call("POST", "/api/threads/bulk", { action: "mark_read", thread_ids: { a: 1 } })).status).toBe(400);
    expect((await call("POST", "/api/send", { account_id: "acc1", to: ["a@b.co"], send_at: "tomorrow" })).status).toBe(400);
    expect((await call("GET", "/api/threads?page=99999999999999999999")).status).toBe(200);
    expect((await call("GET", `/api/threads?q=${"x".repeat(120)}`)).status).toBe(200);
    expect((await call("GET", `/api/search?q=${Array.from({ length: 40 }, (_, i) => `w${i}`).join("+")}`)).status).toBe(200);
  });

  it("runs the scheduled job", async () => {
    await app.tick();
    expect((await call("GET", "/healthz")).status).toBe(200);
  });
});
