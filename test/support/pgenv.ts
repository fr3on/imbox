import pg from "pg";
import { createExecutor } from "../../server/pggateway.mjs";
import { createDb, type Executor } from "../../src/api/database";

// What the tests run against: a real PostgreSQL, through the same gateway and SQL translation the server uses. Each test file gets its own database,
// copied from a template that already has every migration (made once, in global-setup.ts), so files can run side by side and none sees another's rows.

export const TEMPLATE = "inbox_tpl";
const PREFIX = "t_";

/** The server's address with another database name. PG_TEST_URL names the one the whole-server tests use; this keeps its host, port and user. */
export function urlFor(database: string): string {
  const u = new URL(process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test");
  u.pathname = `/${database}`;
  return u.toString();
}

export const isTestDatabase = (name: string) => name.startsWith(PREFIX);

let counter = 0;
export async function createTestDatabase(): Promise<{ name: string; pool: pg.Pool }> {
  const name = `${PREFIX}${process.pid}_${Date.now().toString(36)}_${counter++}`;
  const admin = new pg.Pool({ connectionString: urlFor("postgres"), max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE ${TEMPLATE}`);
  } finally {
    await admin.end();
  }
  return { name, pool: new pg.Pool({ connectionString: urlFor(name), max: 4 }) };
}

/** What the code under test has sent (and, in `sql`, the text of each statement, to see what a count is made of) to the database since `resetStatements()`: round trips (one per `first`, `all`, `run` or `batch`) and the statements inside them. */
export const sent = { roundTrips: 0, statements: 0, sql: [] as string[] };
export const resetStatements = () => {
  sent.roundTrips = 0;
  sent.statements = 0;
  sent.sql = [];
};

/**
 * TEST_DB_LATENCY_MS=5 makes every round trip wait that long first, as a database across a network does, so what a change saves in round trips shows in a
 * timing that on a local socket it does not. Left unset, nothing waits.
 */
const LATENCY = Number(process.env.TEST_DB_LATENCY_MS ?? 0);

export const executorOf = (pool: pg.Pool): Executor => {
  const execute = createExecutor(pool) as Executor["execute"];
  return {
    execute: async (body) => {
      sent.roundTrips++;
      sent.statements += body.stmts.length;
      for (const s of body.stmts) sent.sql.push(s.sql);
      if (LATENCY) await new Promise((r) => setTimeout(r, LATENCY));
      return execute(body);
    },
  };
};

/** A database that waits for the file's database to exist before its first query. The database is made while the test file is still loading. */
export function lazyDb(ready: Promise<Db>): Db {
  type Lazy = { sql: string; params: unknown[]; bind: (...v: unknown[]) => Lazy; real: (db: Db) => DbStatement };
  const stmt = (sql: string, params: unknown[] = []): Lazy => ({
    sql,
    params,
    bind: (...v) => stmt(sql, v),
    real: (db) => db.prepare(sql).bind(...params),
  });
  const run = async (s: Lazy) => s.real(await ready);
  const make = (sql: string) => {
    const s = stmt(sql);
    const proxy = {
      ...s,
      bind: (...v: unknown[]) => {
        const next = stmt(sql, v);
        return withMethods(next);
      },
    };
    return withMethods(proxy as Lazy);
  };
  const withMethods = (s: Lazy) =>
    Object.assign(s, {
      all: async () => (await run(s)).all(),
      run: async () => (await run(s)).run(),
      first: async (c?: string) => (await run(s)).first(c as never),
      raw: async () => (await run(s)).raw(),
    });
  return {
    prepare: (sql: string) => make(sql),
    batch: async (stmts: Lazy[]) => {
      const db = await ready;
      return db.batch(stmts.map((s) => s.real(db)));
    },
    exec: async () => {
      throw new Error("exec() is not supported");
    },
    dump: async () => {
      throw new Error("dump() is not supported");
    },
  } as unknown as Db;
}

export function dbFor(pool: pg.Pool): Db {
  return createDb(executorOf(pool));
}
