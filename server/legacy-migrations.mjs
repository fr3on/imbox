// The first 26 migrations were written for SQLite, in the days the app ran on Cloudflare D1, and they have shipped, so they are never edited. This reads them for
// PostgreSQL. It knows only the spellings those files use (test/core/legacy-migrations.test.ts checks every file against it) and refuses anything else, so a
// new SQLite habit cannot slip in through it. A migration written after them is plain PostgreSQL and does not pass through here (see src/api/migrations.ts).
//
//   INTEGER                            ->  BIGINT       (timestamps here are millisecond epochs; 32 bits overflow)
//   INTEGER PRIMARY KEY AUTOINCREMENT  ->  BIGSERIAL PRIMARY KEY
//   BLOB                               ->  BYTEA
//   strftime('%s','now')               ->  FLOOR(EXTRACT(EPOCH FROM now()))
//   LIKE                               ->  ILIKE        (SQLite's LIKE ignores ASCII case)
//   char(n)                            ->  chr(n)

import { mask, unmask } from "./sql.mjs";

/** Migrations up to this number were written for SQLite. Every later one is PostgreSQL as written. */
export const LAST_LEGACY_MIGRATION = 26;
export const isLegacyMigration = (name) => Number.parseInt(name, 10) <= LAST_LEGACY_MIGRATION;

/** @param {string} sql one statement of a shipped migration */
export function legacyToPostgres(sql) {
  let { masked, kept } = mask(sql.trim().replace(/;\s*$/, ""));
  masked = masked
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "BIGSERIAL PRIMARY KEY")
    .replace(/\bINTEGER\b/gi, "BIGINT")
    .replace(/\bBLOB\b/gi, "BYTEA")
    .replace(/\bstrftime\s*\(\s*\u0001(\d+)\u0002\s*,\s*\u0001(\d+)\u0002\s*\)/gi, (whole, a, b) =>
      /'%s'/.test(kept[Number(a)]) && /'now'/.test(kept[Number(b)]) ? "FLOOR(EXTRACT(EPOCH FROM now()))" : whole,
    )
    .replace(/\bLIKE\b/gi, "ILIKE")
    .replace(/\bchar\s*\(/gi, "chr(");
  if (/\bstrftime\s*\(/i.test(masked)) throw new Error("legacy migration: an unsupported strftime() form");
  if (/\bINSERT\s+OR\s+/i.test(masked)) throw new Error("legacy migration: INSERT OR ... is not one of the spellings the shipped migrations use");
  return unmask(masked, kept);
}
