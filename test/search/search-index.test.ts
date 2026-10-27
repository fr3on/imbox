import { describe, it, expect } from "vitest";
import { pool } from "../support/env";
import { termSql, commonTerms, CONTACT_TEXT } from "../../src/api/search";
import { testEnv } from "../support/env";
import { parseSearch } from "../../src/shared/searchQuery";
import { numberPlaceholders } from "../../server/sql.mjs";

// A search is fast only while the SQL it runs is written the way the indexes are (migration 0023). A table this small is read in full whatever
// the index, so the planner is told not to, and the plan must then name the index. If someone edits one side, this stops matching.
describe("the search uses its indexes", () => {
  it("reads both text indexes, not the tables", async () => {
    const t = termSql("zanzibar");
    const { text } = numberPlaceholders(`SELECT t.id FROM threads t WHERE ${t.sql}`);
    const db = await (await pool()).connect();
    try {
      await db.query("SET enable_seqscan = off");
      const plan = (await db.query(`EXPLAIN ${text}`, ["%zanzibar%", "%zanzibar%"])).rows.map((r: any) => r["QUERY PLAN"]).join("\n");
      expect(plan).toContain("idx_threads_search");
      expect(plan).toContain("idx_messages_search");
    } finally {
      await db.query("RESET enable_seqscan");
      db.release();
    }
  });
});

describe("telling a common word from a rare one", () => {
  it("counts a word as common once it is in a thousand messages", async () => {
    const db = await pool();
    await db.query(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'u1@test.local', '', 'x', 1)`);
    await db.query(`INSERT INTO accounts (id, user_id, provider, email, created_at) VALUES ('a1', 'u1', 'imap', 'a1@test.local', 1)`);
    await db.query(`INSERT INTO threads (id, account_id, gmail_thread_id, first_message_at, last_message_at, created_at, updated_at) VALUES ('t1', 'a1', 'g1', 1, 1, 1, 1)`);
    await db.query(
      `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, date, created_at, text_body)
       SELECT 'm' || g, 'a1', 't1', 'm' || g, g, 1, CASE WHEN g <= 1000 THEN 'about the budget' ELSE 'rare' END || ' ' || g FROM generate_series(1, 1500) g`
    );
    const found = await commonTerms(testEnv.DB, parseSearch("budget rare").parsed);
    expect([...found]).toEqual(["budget"]);
  });
});

describe("keeping what is known about a word", () => {
  it("asks the database once for a word, and again once the answer is old", async () => {
    const { clearCommonTerms } = await import("../../src/api/search");
    const { resetStatements, sent } = await import("../support/pgenv");
    const parsed = parseSearch("budget rare").parsed;
    clearCommonTerms();
    resetStatements();
    const first = await commonTerms(testEnv.DB, parsed, 1_000);
    expect(sent.statements).toBe(2);
    const again = await commonTerms(testEnv.DB, parsed, 1_000 + 60_000);
    expect(sent.statements).toBe(2);
    expect([...again]).toEqual([...first]);
    await commonTerms(testEnv.DB, parsed, 1_000 + 11 * 60_000);
    expect(sent.statements).toBe(4);
  });

  it("does not hold more than it is meant to, and drops the oldest first", async () => {
    const { clearCommonTerms } = await import("../../src/api/search");
    const { resetStatements, sent } = await import("../support/pgenv");
    clearCommonTerms();
    for (let i = 0; i < 2002; i++) await commonTerms(testEnv.DB, parseSearch(`w${i}`).parsed, 5_000);
    resetStatements();
    await commonTerms(testEnv.DB, parseSearch("w2001").parsed, 5_001);
    expect(sent.statements).toBe(0);
    await commonTerms(testEnv.DB, parseSearch("w0").parsed, 5_001);
    expect(sent.statements).toBe(1);
  });
});

describe("searching contacts", () => {
  const words = ["maya", "chen", "acme", "studio", "note", "x@", "ZZZ", "a b"];

  async function seed() {
    const db = await pool();
    await db.query(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('uc', 'uc@test.local', '', 'x', 1) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO accounts (id, user_id, provider, email, created_at) VALUES ('ac', 'uc', 'imap', 'ac@test.local', 1) ON CONFLICT DO NOTHING`);
    const rows: [string, string, string][] = [
      ["maya@chen.studio", "Maya Chen", "runs the studio"],
      ["priya@acme.test", "Priya Nair", "Acme brand refresh note"],
      ["x@y.test", "Acme", ""],
      ["lena@fischer.test", "", "note: kiln tour, a b"],
      ["noreply@acme.test", "ACME Billing", ""],
    ];
    for (const [i, [email, name, notes]] of rows.entries()) {
      await db.query(`INSERT INTO contacts (id, account_id, email, name, notes, first_seen_at, last_seen_at) VALUES ($1, 'ac', $2, $3, $4, 1, 1) ON CONFLICT DO NOTHING`, [`c${i}`, email, name, notes]);
    }
    return db;
  }

  it("finds the same contacts as looking in the three columns one by one", async () => {
    const db = await seed();
    for (const w of words) {
      const one = (await db.query(`SELECT id FROM contacts c WHERE c.email ILIKE $1 OR c.name ILIKE $1 OR c.notes ILIKE $1 ORDER BY id`, [`%${w}%`])).rows;
      const all = (await db.query(`SELECT id FROM contacts c WHERE (${CONTACT_TEXT("c")}) ILIKE $1 ORDER BY id`, [`%${w}%`])).rows;
      expect(all, `the word "${w}"`).toEqual(one);
    }
  });

  it("reads its index, not the table", async () => {
    const db = await (await pool()).connect();
    try {
      await seed();
      await db.query("SET enable_seqscan = off");
      const plan = (await db.query(`EXPLAIN SELECT c.id FROM contacts c WHERE (${CONTACT_TEXT("c")}) ILIKE $1`, ["%acme%"])).rows.map((r: any) => r["QUERY PLAN"]).join("\n");
      expect(plan).toContain("idx_contacts_search");
    } finally {
      await db.query("RESET enable_seqscan");
      db.release();
    }
  });
});
