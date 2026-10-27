import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createExecutor } from "../../server/pggateway.mjs";
import { createDb, type Executor } from "../../src/api/database";

// The database client, on a real PostgreSQL: numbers, text, NULLs and bytes in and out, a batch that rolls back, and the database's own error code.
const URL = process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test";
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: URL, max: 2 });
  await pool.query("DROP TABLE IF EXISTS db_paths");
  await pool.query("CREATE TABLE db_paths (id TEXT PRIMARY KEY, n BIGINT NOT NULL, data BYTEA, note TEXT)");
});
afterAll(async () => {
  await pool?.query("DROP TABLE IF EXISTS db_paths");
  await pool?.end();
});

const db = () => createDb({ execute: createExecutor(pool) } as unknown as Executor);

describe("the database client", () => {
  it("stores and reads numbers, text, nulls and bytes", async () => {
    const d = db();
    const id = `r-${Math.random()}`;
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await d.prepare(`INSERT INTO db_paths (id, n, data, note) VALUES (?, ?, ?, NULL)`).bind(id, 1790000000000, bytes).run();
    const row = await d.prepare(`SELECT * FROM db_paths WHERE id = ?`).bind(id).first<{ n: number; data: ArrayBuffer; note: string | null }>();
    expect(row!.n).toBe(1790000000000);
    expect(row!.note).toBeNull();
    expect(row!.data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(row!.data)]).toEqual([0, 1, 2, 250, 255]);
    const all = await d.prepare(`SELECT id, n FROM db_paths WHERE id = ?`).bind(id).all<{ id: string; n: number }>();
    expect(all.results).toEqual([{ id, n: 1790000000000 }]);
    expect(await d.prepare(`SELECT n FROM db_paths WHERE id = ?`).bind(id).first("n")).toBe(1790000000000);
    expect(await d.prepare(`SELECT id FROM db_paths WHERE id = 'none'`).first()).toBeNull();
    expect(await d.prepare(`SELECT id, n FROM db_paths WHERE id = ?`).bind(id).raw()).toEqual([[id, 1790000000000]]);
  });

  it("runs a batch in one transaction", async () => {
    const d = db();
    const a = `b-${Math.random()}`;
    await expect(d.batch([d.prepare(`INSERT INTO db_paths (id, n) VALUES (?, 1)`).bind(a), d.prepare(`INSERT INTO db_paths (id, n) VALUES (?, 2)`).bind(a)])).rejects.toThrow();
    expect(await d.prepare(`SELECT id FROM db_paths WHERE id = ?`).bind(a).first()).toBeNull();
  });

  it("reports the database's own error code", async () => {
    const err = await db().prepare(`INSERT INTO db_paths (id, n) VALUES (?, ?)`).bind(`x-${Math.random()}`, 1e300).run().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.code)).toMatch(/^22/);
  });

  it("leaves a NUL character out of text, which PostgreSQL cannot hold", async () => {
    const d = db();
    const id = `nul-${Math.random()}`;
    await d.prepare(`INSERT INTO db_paths (id, n, note) VALUES (?, 1, ?)`).bind(id, "a\u0000b").run();
    expect(await d.prepare(`SELECT note FROM db_paths WHERE id = ?`).bind(id).first("note")).toBe("ab");
  });
});
