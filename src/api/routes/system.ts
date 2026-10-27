import { Hono } from "hono";
import type { AppEnv } from "../env";
import { VERSION, COMMIT, BUILT_AT } from "@shared/buildInfo";
import { hostInfo } from "../../node/host";

/**
 * What this server is and how much of it is in use: the machine, the app, the database. The owner's page in Settings reads it; it says nothing
 * about anyone's mail beyond table sizes. Never 401 or 403 for a failure: the web app treats those as "signed out".
 */
const system = new Hono<AppEnv>();

const STARTED_AT = Date.now();

system.get("/", async (c) => {
  const db = c.env.DB;
  const [host, meta, tables] = await Promise.all([
    hostInfo(),
    db.prepare(`SELECT version() AS version, pg_database_size(current_database()) AS bytes`).first<{ version: string; bytes: number | string }>(),
    db
      .prepare(`SELECT relname AS name, pg_total_relation_size(relid) AS bytes, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC NULLS LAST LIMIT 8`)
      .all<{ name: string; bytes: number | string; rows: number | string }>(),
  ]);
  const pg = /^PostgreSQL (\S+)/.exec(meta?.version ?? "");
  return c.json(
    {
      app: { version: VERSION, commit: COMMIT, built_at: BUILT_AT, started_at: STARTED_AT },
      host,
      database: {
        version: pg ? pg[1] : "unknown",
        bytes: Number(meta?.bytes ?? 0),
        tables: tables.results.map((t) => ({ name: t.name, bytes: Number(t.bytes), rows: Number(t.rows) })),
      },
      checked_at: Date.now(),
    },
    200,
    { "cache-control": "private, no-store" },
  );
});

export default system;
