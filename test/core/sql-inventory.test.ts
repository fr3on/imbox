// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the fixtures are code with a `${…}` in a query, held as a string
import { describe, expect, it } from "vitest";
import { analyse, inventory, ownedTables, tagOf } from "../../scripts/sql-inventory.mjs";

/**
 * The inventory (scripts/sql-inventory.mjs, docs/perf/sql-inventory.md) is how the SQL review finds its work. These tests keep it honest: every file with a
 * query has a tag for how often it runs, the reader finds queries and does not lose them, and each flag fires on the code it is meant for.
 */

const owned = new Set(["threads", "messages", "accounts"]);
const run = (code: string, file = "src/api/routes/x.ts") => analyse(file, code, owned);
const flagsOf = (code: string, file?: string) => run(code, file).map((r) => r.flags);

describe("the reader", () => {
  const rows = inventory();

  it("finds the queries, and none are lost", () => {
    // 812 on the day it was written; a drop means the reader has stopped seeing some form of query.
    expect(rows.length).toBeGreaterThan(780);
    const text = rows.filter((r) => r.file === "src/api/auth.ts" && r.where === "readSessionUser");
    expect(text.some((r) => r.kind === "read" && r.tables.includes("sessions"))).toBe(true);
  });

  it("has a tag for every file that holds a query", () => {
    const files = [...new Set(rows.map((r) => r.file))];
    expect(files.filter((f) => !tagOf(f))).toEqual([]);
  });

  it("can read nearly every query as text", () => {
    expect(rows.filter((r) => r.flags.includes("dynamic")).length).toBeLessThan(6);
  });

  it("knows which tables belong to a user or an account", () => {
    const o = ownedTables();
    expect(o.has("threads") && o.has("accounts") && o.has("contacts")).toBe(true);
    expect(o.has("users")).toBe(false);
  });
});

describe("the flags", () => {
  it("SELECT *", () => {
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT * FROM labels WHERE id = ?`).bind(1).first(); }")[0]).toContain("select-star");
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT id FROM labels WHERE id = ?`).bind(1).first(); }")[0]).not.toContain("select-star");
  });

  it("LIKE, OFFSET, NOT IN, a read with no LIMIT", () => {
    const f = flagsOf("async function f(db){ return db.prepare(`SELECT id FROM t WHERE name ILIKE ? AND x NOT IN (?) ORDER BY id OFFSET 5`).bind(1).all(); }")[0];
    expect(f).toEqual(expect.arrayContaining(["like", "not-in", "offset", "no-limit"]));
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT id FROM t ORDER BY id LIMIT 5`).all(); }")[0]).not.toContain("no-limit");
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT COUNT(*) AS n FROM t`).first(); }")[0]).not.toContain("no-limit");
  });

  it("a query awaited in a loop over rows, over pieces of a list, and over the items of an array", () => {
    expect(flagsOf("async function f(db, rows){ for (const r of rows) { await db.prepare(`UPDATE t SET a = ? WHERE id = ?`).bind(1, r).run(); } }")[0]).toContain("in-loop");
    expect(flagsOf("async function f(db, ids){ for (const p of chunk(ids, 90)) { await db.prepare(`SELECT id FROM t WHERE id IN (?) LIMIT 9`).bind(p).all(); } }")[0]).toContain("chunked");
    expect(flagsOf("async function f(db, rows){ await Promise.all(rows.map((r) => db.prepare(`SELECT id FROM t WHERE id = ?`).bind(r).first())); }")[0]).toContain("per-item");
  });

  it("a statement collected for a batch is not a round trip of its own", () => {
    const f = flagsOf("async function f(db, rows){ const s = []; for (const r of rows) s.push(db.prepare(`UPDATE t SET a = ? WHERE id = ?`).bind(1, r)); await db.batch(s); }")[0];
    expect(f).toContain("batched");
    expect(f).not.toContain("in-loop");
  });

  it("an interpolation that is a list of ? or a named fragment, and one that is something else", () => {
    expect(flagsOf("async function f(db, ids){ return db.prepare(`SELECT id FROM t WHERE id IN (${placeholders(ids.length)}) LIMIT 5`).all(); }")[0]).toContain("interp");
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT id FROM t WHERE ${VISIBLE} LIMIT 5`).all(); }")[0]).not.toContain("interp-other");
    const f = flagsOf("async function f(db, q){ return db.prepare(`SELECT id FROM t ORDER BY ${q.sort} LIMIT 5`).all(); }")[0];
    expect(f).toContain("interp-other");
  });

  it("an owned table in a request with nothing about whose rows", () => {
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT id FROM threads WHERE id = ?`).bind(1).first(); }", "src/api/routes/x.ts")[0]).toContain("scope?");
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT id FROM threads WHERE id = ? AND account_id = ?`).bind(1, 2).first(); }", "src/api/routes/x.ts")[0]).not.toContain("scope?");
    // A job works on rows it already owns, so it is not asked.
    expect(flagsOf("async function f(db){ return db.prepare(`SELECT id FROM threads WHERE id = ?`).bind(1).first(); }", "src/api/sync.ts")[0]).not.toContain("scope?");
  });

  it("reads a query held in a constant, and names the route it is in", () => {
    const r = run("const Q = `SELECT id FROM labels WHERE id = ? LIMIT 1`; app.get('/labels/:id', async (c) => { return db.prepare(Q).bind(1).first(); });")[0];
    expect(r.sql).toContain("SELECT id FROM labels");
    expect(r.where).toBe("GET /labels/:id");
  });
});
