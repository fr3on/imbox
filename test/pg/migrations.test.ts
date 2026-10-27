import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExecutor, migrate } from "../../server/pggateway.mjs";

const URL = process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test";
const dir = path.resolve(__dirname, "../../migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));

let pool: pg.Pool;
let execute: (b: unknown) => Promise<{ results: { rows: Record<string, unknown>[]; changes: number }[] }>;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: URL, max: 4 });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  execute = createExecutor(pool);
});
afterAll(() => pool?.end());

describe("every migration applies to Postgres", () => {
  it("applies all of them, in order, once", async () => {
    const applied = await migrate(pool, files);
    expect(applied).toHaveLength(files.length);
    expect(await migrate(pool, files)).toEqual([]);
  });

  it("uses 64-bit integers for millisecond timestamps", async () => {
    const r = await pool.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'integer' AND table_name <> 'd1_migrations'`);
    expect(r.rows[0].n).toBe(0);
    const t = await execute({ stmts: [{ sql: "SELECT created_at FROM users LIMIT 1" }] });
    expect(t.results).toHaveLength(1);
  });

  it("has the tables the Worker expects", async () => {
    const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const names = new Set(r.rows.map((x) => x.table_name));
    for (const t of ["users", "accounts", "threads", "messages", "contacts", "attachment_blobs", "ai_settings", "auto_agent_memory", "daily_briefs", "contact_reviews"]) expect(names.has(t), t).toBe(true);
  });
});
