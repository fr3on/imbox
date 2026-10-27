// The few shapes the API uses from the environment it runs in, written out here so nothing has to be installed for them. The names Request, Response and fetch
// come from Node's own types. `Db` is the database client (src/api/database.ts).

interface DbMeta {
  duration: number;
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
  changed_db: boolean;
  size_after: number;
  served_by?: string;
}
interface DbResult<T = unknown> {
  success: true;
  results: T[];
  meta: DbMeta & Record<string, unknown>;
}
interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}
/** A database that takes SQL with `?` placeholders. On the server it is a client for PostgreSQL (src/api/database.ts). */
interface Db {
  prepare(sql: string): DbStatement;
  /** The statements run in one transaction. */
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>;
  /** The same database, taking the SQLite spellings that the first migrations use (see server/legacy-migrations.mjs). */
  legacyDialect?(): Db;
}
/** Something that answers requests: the built web files. */
interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
interface ExecutionContext {
  /** Work that goes on after the answer has been sent. */
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: any;
}
interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}
