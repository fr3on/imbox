import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLegacyMigration, LAST_LEGACY_MIGRATION, legacyToPostgres } from "../../server/legacy-migrations.mjs";
import { splitStatements } from "../../server/sql.mjs";
import { LAST_LEGACY_MIGRATION as API_LAST, MIGRATIONS } from "../../src/api/migrations";

describe("reading a shipped migration for PostgreSQL", () => {
  it("widens INTEGER to BIGINT, since a millisecond timestamp does not fit in 32 bits", () => {
    expect(legacyToPostgres("CREATE TABLE t (id TEXT PRIMARY KEY, at INTEGER NOT NULL DEFAULT 0, data BLOB)")).toBe("CREATE TABLE t (id TEXT PRIMARY KEY, at BIGINT NOT NULL DEFAULT 0, data BYTEA)");
  });
  it("turns an autoincrementing key into BIGSERIAL", () => {
    expect(legacyToPostgres("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, n TEXT)")).toBe("CREATE TABLE t (id BIGSERIAL PRIMARY KEY, n TEXT)");
  });
  it("reads strftime('%s','now'), LIKE and char()", () => {
    expect(legacyToPostgres("UPDATE c SET at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE k LIKE 'd:%'")).toBe("UPDATE c SET at = CAST(FLOOR(EXTRACT(EPOCH FROM now())) AS BIGINT) * 1000 WHERE k ILIKE 'd:%'");
    expect(legacyToPostgres("CREATE INDEX i ON t ((a || char(31) || b))")).toBe("CREATE INDEX i ON t ((a || chr(31) || b))");
  });
  it("does not touch a word inside a string or a comment", () => {
    expect(legacyToPostgres("INSERT INTO t VALUES ('INTEGER BLOB LIKE') -- char(1)")).toBe("INSERT INTO t VALUES ('INTEGER BLOB LIKE') -- char(1)");
  });
  it("refuses what the shipped migrations do not use, so a new SQLite habit cannot come in this way", () => {
    expect(() => legacyToPostgres("SELECT strftime('%Y', 'now')")).toThrow(/strftime/);
    expect(() => legacyToPostgres("INSERT OR IGNORE INTO t (a) VALUES (1)")).toThrow(/INSERT OR/);
  });
});

describe("which migrations are legacy", () => {
  it("is the same number on the server and in the API", () => {
    expect(API_LAST).toBe(LAST_LEGACY_MIGRATION);
  });
  it("covers exactly the migrations that were written for SQLite", () => {
    expect(isLegacyMigration("0001_core.sql")).toBe(true);
    expect(isLegacyMigration("0026_domains_http.sql")).toBe(true);
    expect(isLegacyMigration("0027_anything.sql")).toBe(false);
  });
  it("leaves no migration after the last legacy one that still uses a SQLite spelling", () => {
    const dir = path.resolve(__dirname, "../../migrations");
    const late = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && !isLegacyMigration(f));
    for (const f of late) {
      const sql = splitStatements(fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
      expect(sql, f).not.toMatch(/\b(INTEGER|BLOB|AUTOINCREMENT|strftime)\b/i);
    }
  });
  it("registers every migration file, in order, with the same name", () => {
    const dir = path.resolve(__dirname, "../../migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
  });
});
