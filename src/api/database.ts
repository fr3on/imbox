// The database client the rest of the API uses: `db.prepare(sql).bind(...).first() / all() / run()` and `db.batch([...])`, on PostgreSQL. The statements go to
// the executor in server/pggateway.mjs, which owns the connection pool and lives in the same process, so rows come back as they are.
//
// SQL is written for PostgreSQL with `?` for a parameter (server/sql.mjs numbers them); see imbox-website/docs/content/docs/database.mdx for what remains to be done.

import type { Env } from "./env";

/** What the server hands the API to reach the database: the statements in, the rows out. */
export interface Executor {
  execute(body: Wire): Promise<{ results: WireResult[] }>;
}

interface Wire {
  stmts: { sql: string; params?: unknown[]; legacy?: boolean }[];
  batch?: boolean;
}
interface WireResult {
  rows: Record<string, unknown>[];
  changes: number;
  duration: number;
  /** The columns that hold bytes, so only those values need a second look. */
  binary: string[];
}

const encodeParam = (v: unknown): unknown => {
  if (v === undefined) return null;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  // PostgreSQL text cannot hold a NUL character. Nothing here means one, so it is left out rather than failing the whole request.
  if (typeof v === "string") return v.includes("\u0000") ? v.replace(/\u0000/g, "") : v;
  return v;
};

const toArrayBuffer = (v: Uint8Array): ArrayBuffer => v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;

/** The rows of a result with bytes made into ArrayBuffers. Rows that hold no bytes are returned untouched, which is nearly all of them. */
function decodedRows(r: WireResult): Record<string, unknown>[] {
  if (!r.binary.length) return r.rows;
  return r.rows.map((row) => {
    for (const c of r.binary) if (row[c] instanceof Uint8Array) row[c] = toArrayBuffer(row[c] as Uint8Array);
    return row;
  });
}

function toResult<T>(r: WireResult): DbResult<T> {
  return {
    success: true as const,
    results: decodedRows(r) as T[],
    meta: { changes: r.changes, duration: r.duration, last_row_id: 0, rows_read: r.rows.length, rows_written: r.changes, changed_db: r.changes > 0, size_after: 0, served_by: "postgres" },
  };
}

class Statement implements DbStatement {
  constructor(
    private readonly executor: Executor,
    readonly sql: string,
    readonly params: unknown[] = [],
    private readonly legacy = false,
  ) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.executor, this.sql, values, this.legacy);
  }
  toWire() {
    return { sql: this.sql, params: this.params.map(encodeParam), ...(this.legacy ? { legacy: true } : {}) };
  }
  async all<T = Record<string, unknown>>() {
    return toResult<T>((await send(this.executor, { stmts: [this.toWire()] }))[0]);
  }
  async run<T = Record<string, unknown>>() {
    return toResult<T>((await send(this.executor, { stmts: [this.toWire()] }))[0]);
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = (await send(this.executor, { stmts: [this.toWire()] }))[0];
    const row = decodedRows({ ...result, rows: result.rows.slice(0, 1) })[0];
    if (!row) return null;
    return (column ? (row[column] ?? null) : row) as T;
  }
  async raw<T = unknown[]>(): Promise<T[]> {
    return decodedRows((await send(this.executor, { stmts: [this.toWire()] }))[0]).map((r) => Object.values(r) as unknown as T);
  }
}

async function send(executor: Executor, body: Wire): Promise<WireResult[]> {
  try {
    return (await executor.execute(body)).results;
  } catch (e) {
    // The database's own error code goes with the message, so a caller can tell "that value does not fit" (class 22) from a fault.
    throw Object.assign(new Error(`postgres: ${(e as Error)?.message ?? String(e)}`), { code: (e as { code?: string | null })?.code ?? null });
  }
}

/** `env.DB`. The statements of a batch run in one transaction. */
export function createDb(executor: Executor, legacy = false): Db {
  const db: Db = {
    prepare: (sql: string) => new Statement(executor, sql, [], legacy),
    /** The same database, for the migrations that shipped before queries were written for PostgreSQL (see server/legacy-migrations.mjs). */
    legacyDialect: () => createDb(executor, true),
    async batch<T = unknown>(statements: DbStatement[]) {
      if (!statements.length) return [];
      return (await send(executor, { stmts: (statements as Statement[]).map((s) => s.toWire()), batch: true })).map((r) => toResult<T>(r));
    },
  };
  return db;
}

/** The environment with `DB` set up from the executor the server bound as `PG`. */
export function withDatabase(env: Env): Env {
  return env.PG ? { ...env, DB: createDb(env.PG) } : env;
}
