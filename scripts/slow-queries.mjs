#!/usr/bin/env node
// Lists the queries that took the most time since the statistics were last reset, with a plan for each. The plans are generic (the constants have become $n in
// pg_stat_statements), so an index on an expression with a constant in it, like the search indexes' chr(31), looks unused here: confirm with EXPLAIN on a real value. Needs the pg_stat_statements extension:
//   shared_preload_libraries = 'pg_stat_statements'   (postgresql.conf, then restart)   and   CREATE EXTENSION pg_stat_statements;
//   DATABASE_URL=postgres://... node scripts/slow-queries.mjs --reset      (clear the statistics, then use the app or run scripts/load-test.mjs)
//   DATABASE_URL=postgres://... node scripts/slow-queries.mjs [20]         (the 20 that took the most total time, with plans)
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
if (process.argv.includes("--reset")) {
  await pool.query("SELECT pg_stat_statements_reset()");
  console.log("statistics cleared");
  await pool.end();
  process.exit(0);
}
const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 20);
const { rows } = await pool.query(
  `SELECT queryid, calls, round(total_exec_time::numeric) AS total_ms, round(mean_exec_time::numeric, 1) AS mean_ms, round(max_exec_time::numeric) AS max_ms, rows / GREATEST(calls, 1) AS rows_per_call, query
   FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND query NOT LIKE '%pg_stat_statements%' AND query !~* '^(begin|commit|set|show)'
   ORDER BY total_exec_time DESC LIMIT $1`,
  [limit]
);
for (const [i, r] of rows.entries()) {
  console.log(`\n#${i + 1}  ${r.calls} calls  total ${r.total_ms} ms  mean ${r.mean_ms} ms  max ${r.max_ms} ms  ${r.rows_per_call} rows/call`);
  console.log(r.query.replace(/\s+/g, " ").slice(0, 600));
  if (process.argv.includes("--no-plan")) continue;
  try {
    const plan = await pool.query(`EXPLAIN (GENERIC_PLAN, COSTS OFF) ${r.query}`);
    const lines = plan.rows.map((x) => x["QUERY PLAN"]);
    const seq = lines.filter((l) => /Seq Scan/.test(l)).map((l) => l.trim());
    console.log(seq.length ? `  sequential scans: ${seq.join("; ")}` : "  plan uses indexes only");
  } catch (e) {
    console.log(`  (no plan: ${e.message.split("\n")[0]})`);
  }
}
await pool.end();
