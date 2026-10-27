// The executor: it takes the API's statements (one, or a batch), numbers their parameters, runs them on a pooled connection, and gives the rows back as they
// are. It lives in the same process as the API. A batch runs in one transaction.

import pg from "pg";
import { numberPlaceholders, splitStatements } from "./sql.mjs";
import { isLegacyMigration, legacyToPostgres } from "./legacy-migrations.mjs";

// BIGINT and NUMERIC come back as strings by default. Every number in this app (millisecond timestamps, counts, sums) is far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const cache = new Map();
/** The statement with its parameters numbered. A statement from a shipped migration is first read for PostgreSQL (see legacy-migrations.mjs). */
function translate(stmt) {
  const legacy = stmt.legacy === true;
  const key = legacy ? `legacy:${stmt.sql}` : stmt.sql;
  let t = cache.get(key);
  if (!t) {
    t = numberPlaceholders(legacy ? legacyToPostgres(stmt.sql) : stmt.sql);
    if (cache.size > 2000) cache.clear();
    cache.set(key, t);
  }
  return t;
}

/** Bytes travel as { $b64 }: JSON has no binary type. */
export function decodeParam(v) {
  if (v && typeof v === "object" && typeof v.$b64 === "string") return Buffer.from(v.$b64, "base64");
  return v === undefined ? null : v;
}
const BYTEA = 17;

async function runOne(client, stmt) {
  const { text, params } = translate(stmt);
  const values = (stmt.params ?? []).map(decodeParam);
  if (values.length !== params) throw new Error(`${params} placeholders but ${values.length} values in: ${stmt.sql.slice(0, 120)}`);
  const started = Date.now();
  const r = await client.query(text, values);
  // `binary` names the columns that hold bytes, so a caller that has the rows as they are knows which few values need attention.
  const binary = (r.fields ?? []).filter((f) => f.dataTypeID === BYTEA).map((f) => f.name);
  return { rows: r.rows, binary, changes: r.command === "SELECT" ? 0 : (r.rowCount ?? 0), duration: Date.now() - started };
}

/**
 * @param {import("pg").Pool} pool
 * @returns {(body: { stmts: { sql: string, params?: unknown[] }[], batch?: boolean }) => Promise<{ results: unknown[] }>}
 */
export function createExecutor(pool) {
  return async function execute(body) {
    const stmts = Array.isArray(body?.stmts) ? body.stmts : [];
    if (!stmts.length) return { results: [] };
    const client = await pool.connect();
    try {
      const results = [];
      if (body.batch) {
        await client.query("BEGIN");
        try {
          for (const s of stmts) results.push(await runOne(client, s));
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          throw e;
        }
      } else {
        for (const s of stmts) results.push(await runOne(client, s));
      }
      return { results };
    } finally {
      client.release();
    }
  };
}

/** Apply migrations/*.sql, translated, and record them in d1_migrations, exactly as the API's own migrator does. */
export async function migrate(pool, files) {
  const execute = createExecutor(pool);
  await execute({
    batch: true,
    stmts: [
      { sql: "CREATE TABLE IF NOT EXISTS d1_migrations (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)" },
      { sql: "CREATE TABLE IF NOT EXISTS app_secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at BIGINT NOT NULL)" },
    ],
  });
  const done = new Set((await execute({ stmts: [{ sql: "SELECT name FROM d1_migrations" }] })).results[0].rows.map((r) => r.name));
  const applied = [];
  for (const f of files) {
    if (done.has(f.name)) continue;
    const legacy = isLegacyMigration(f.name);
    const stmts = splitStatements(f.sql).map((sql) => ({ sql, legacy }));
    stmts.push({ sql: "INSERT INTO d1_migrations (name) VALUES (?)", params: [f.name] });
    await execute({ batch: true, stmts });
    applied.push(f.name);
  }
  return applied;
}
