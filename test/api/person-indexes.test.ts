import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "../support/env";
import { migrate } from "../api-harness";
import { ADDRESS_TEXT, RECIPIENTS_TEXT } from "../../src/api/search";

/**
 * A person's page asks for the messages and conversations with an address; the compose box asks the address book for each key typed. Each read every row
 * until migration 0033 indexed them. The plan must name the index; if someone edits a query so it no longer matches, this stops. The texts below are those in
 * contactInsights.ts and routes/contacts.ts.
 */

const addr = async (key: string) => (await (await pool()).query(`SELECT left(md5($1), 8) AS a`, [key])).rows[0].a + "@x.test";

/** The plan for the query with its values written into the text: the planner reads a pattern's trigrams only from a value it can see, not from a parameter. */
const plan = async (sql: string, params: string[]) => {
  const db = await pool();
  const client = await db.connect();
  try {
    // A small table is read whole whatever indexes it has: ask for an index if there is one that can serve.
    await client.query("SET enable_seqscan = off");
    let i = 0;
    const text = sql.replace(/\?/g, () => client.escapeLiteral(params[i++]));
    return (await client.query(`EXPLAIN ${text}`)).rows.map((r: any) => r["QUERY PLAN"]).join("\n");
  } finally {
    client.release();
  }
};

beforeAll(async () => {
  await migrate();
  const db = await pool();
  await db.query(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'u1@test.local', '', 'x', 1)`);
  await db.query(`INSERT INTO accounts (id, user_id, provider, email, created_at) VALUES ('a1', 'u1', 'imap', 'a1@test.local', 1)`);
  const client = await db.connect();
  try {
    await client.query("SET session_replication_role = replica");
    await client.query(
      `INSERT INTO threads (id, account_id, gmail_thread_id, first_message_at, last_message_at, created_at, updated_at, participants_json)
       SELECT 't' || g, 'a1', 'g' || g, g, g, g, g, '[{"email":"' || left(md5('p' || g), 8) || '@x.test","name":"P ' || md5('n' || g) || '"}]' FROM generate_series(1, 30000) g`
    );
    await client.query(
      `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, date, created_at, from_email, to_json, cc_json)
       SELECT 'm' || g, 'a1', 't' || (g % 30000 + 1), 'gm' || g, g, g, left(md5('p' || g), 8) || '@x.test', '[{"email":"' || left(md5('q' || g), 8) || '@x.test"}]', '[]' FROM generate_series(1, 40000) g`
    );
    await client.query(
      `INSERT INTO address_book (account_id, email, name, updated_at) SELECT 'a1', left(md5('b' || g), 8) || g || '@x.test', md5('k' || g), g FROM generate_series(1, 60000) g`
    );
  } finally {
    await client.query("SET session_replication_role = DEFAULT");
    client.release();
  }
  // ANALYZE reads a random sample, so the plan could change from run to run. A high target makes it read every row of these tables.
  const stats = await db.connect();
  try {
    await stats.query("SET default_statistics_target = 1000");
    for (const t of ["messages", "threads", "address_book"]) await stats.query(`ANALYZE ${t}`);
  } finally {
    stats.release();
  }
});

describe("finding a person's mail", () => {
  it("from them by the index on the sender, to them by the trigram index on the recipients (the insights)", async () => {
    const p = await plan(
      `SELECT m.thread_id FROM messages m WHERE m.account_id IN (?) AND (m.from_email = ? OR (${RECIPIENTS_TEXT("m")}) ILIKE ?) ORDER BY m.date DESC LIMIT ?`,
      ["a1", await addr("p5"), `%"${await addr("p5")}"%`, "20000"]
    );
    expect(p).toContain("idx_messages_from");
    expect(p).toContain("idx_messages_recipients");
  });

  it("their conversations by the participants index and the sender index (the person's page)", async () => {
    const who = await addr("p5");
    const named = await plan(`SELECT p.id FROM threads p WHERE p.participants_json ILIKE ?`, [`%"${who}"%`]);
    expect(named).toContain("idx_threads_participants");
    const sent = await plan(
      `SELECT t.id FROM threads t WHERE t.id IN (
         SELECT p.id FROM threads p WHERE p.account_id IN (?) AND p.participants_json ILIKE ?
         UNION
         SELECT m.thread_id FROM messages m WHERE m.account_id IN (?) AND m.from_email = ?
       )`,
      ["a1", `%"${who}"%`, "a1", who]
    );
    // On a table this small the planner may read the participants another way inside the whole query, but the sender is always found by its index.
    expect(sent).toContain("idx_messages_from");
  });
});

describe("the address book", () => {
  it("is searched by its trigram index as someone types (compose suggestions)", async () => {
    const p = await plan(`SELECT email FROM address_book WHERE account_id IN (?) AND (${ADDRESS_TEXT("address_book")}) ILIKE ? AND (email ILIKE ? OR name ILIKE ?)`, ["a1", `%${(await addr("b77")).slice(0, 10)}%`, `%${(await addr("b77")).slice(0, 10)}%`, `%${(await addr("b77")).slice(0, 10)}%`]);
    expect(p).toContain("idx_address_book_search");
  });
});
