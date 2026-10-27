import { beforeEach } from "vitest";
import { pool } from "./env";

// Each test starts from the data its file had when the first test began, so a change one test makes never reaches the next. Most files start from
// nothing. A file that fills the tables in beforeAll (a shared world of users and mailboxes) keeps that, and every test gets it back as it was.
// This is done by copying the filled tables aside once and putting them back before each test, which costs a few milliseconds.

let tables: string[] | null = null;
const filled: string[] = [];
let serials: { t: string; c: string }[] = [];

beforeEach(async () => {
  const db = await pool();
  const client = await db.connect();
  try {
    if (!tables) {
      tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'd1_migrations'`)).rows.map((r: { tablename: string }) => r.tablename);
      await client.query("CREATE SCHEMA IF NOT EXISTS snapshot");
      for (const t of tables) {
        if ((await client.query(`SELECT 1 FROM public."${t}" LIMIT 1`)).rowCount) {
          await client.query(`CREATE TABLE snapshot."${t}" AS SELECT * FROM public."${t}"`);
          filled.push(t);
        }
      }
      serials = (await client.query(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval%'`)).rows.filter((r: { t: string }) => filled.includes(r.t));
    }
    // Only tables that have rows need emptying; asking for them all at once costs one round trip, and emptying the rest would cost a lock each.
    const used = (await client.query(tables.map((t) => `SELECT '${t}' AS t WHERE EXISTS (SELECT 1 FROM public."${t}")`).join(" UNION ALL "))).rows.map((r: { t: string }) => r.t);
    if (used.length) await client.query(`TRUNCATE ${used.map((t) => `public."${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
    if (filled.length) {
      // Put the rows back as they were, in any order: the constraints held when they were first written.
      await client.query("SET session_replication_role = replica");
      for (const t of filled) await client.query(`INSERT INTO public."${t}" SELECT * FROM snapshot."${t}"`);
      await client.query("SET session_replication_role = DEFAULT");
      // RESTART IDENTITY rewound the counters, and the rows came back with their own numbers, so move each counter past them.
      for (const s of serials) await client.query(`SELECT setval(pg_get_serial_sequence('public."${s.t}"', '${s.c}'), (SELECT MAX("${s.c}") FROM public."${s.t}"))`);
    }
  } finally {
    client.release();
  }
});
