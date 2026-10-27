import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "../support/env";
import { migrate } from "../api-harness";
import { numberPlaceholders } from "../../server/sql.mjs";

/**
 * Attachments are found by thread (opening a thread, the Feed) and newest first across mailboxes (the Files page). Each was a read of every attachment until
 * migration 0032 indexed it. The plan must name the index; if someone edits a query so it no longer matches, this stops. The texts below are those in
 * routes/mail/thread.ts, routes/mail/lists.ts and routes/mail/files.ts.
 */

const plan = async (sql: string, params: unknown[]) => {
  const { text } = numberPlaceholders(sql);
  const db = await pool();
  // Each test starts from the state the file was set up in, and a plan follows the table's statistics: read them again, so the plan does not depend on whether a background pass got to them.
  await db.query("ANALYZE attachments");
  return (await db.query(`EXPLAIN ${text}`, params)).rows.map((r: any) => r["QUERY PLAN"]).join("\n");
};

beforeAll(async () => {
  await migrate();
  const db = await pool();
  await db.query(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'u1@test.local', '', 'x', 1)`);
  for (const a of ["a1", "a2"]) await db.query(`INSERT INTO accounts (id, user_id, provider, email, created_at) VALUES ($1, 'u1', 'imap', $1 || '@test.local', 1)`, [a]);
  // Enough attachments that reading them all costs more than reading an index, in two mailboxes. Their messages and threads are not made: only the
  // attachments are looked at, so the checks that they belong to a message are put aside for the insert.
  const client = await db.connect();
  try {
    await client.query("SET session_replication_role = replica");
    await client.query(
      `INSERT INTO attachments (id, account_id, message_id, thread_id, gmail_attachment_id, filename, created_at, is_inline)
       SELECT 'at' || g, CASE WHEN g % 2 = 0 THEN 'a1' ELSE 'a2' END, 'm' || g, 't' || (g % 3000), 'g' || g, 'f' || g || '.pdf', g, 0 FROM generate_series(1, 20000) g`
    );
  } finally {
    await client.query("SET session_replication_role = DEFAULT");
    client.release();
  }
  await db.query("ANALYZE attachments");
});

describe("finding attachments", () => {
  it("of a thread, by its index (opening a thread, the Feed)", async () => {
    const one = await plan(`SELECT * FROM attachments WHERE thread_id IN (?) AND account_id = ? ORDER BY created_at ASC`, ["t5", "a1"]);
    expect(one).toContain("idx_attachments_thread");
    const many = await plan(`SELECT a.*, m.from_email, m.from_name FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.thread_id IN (?,?,?,?) AND a.is_inline = 0 ORDER BY a.created_at ASC`, ["t1", "t2", "t3", "t4"]);
    expect(many).toContain("idx_attachments_thread");
  });

  it("newest first across a person's mailboxes, in order from an index (the Files page)", async () => {
    const files = await plan(
      `SELECT a.*, t.subject AS t_subject, t.custom_subject AS t_custom_subject, m.from_email, m.from_name FROM attachments a JOIN messages m ON m.id = a.message_id JOIN threads t ON t.id = a.thread_id WHERE a.account_id IN (?,?) AND a.is_inline = 0 ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      ["a1", "a2", 51, 0]
    );
    expect(files).toContain("idx_attachments_files");
    expect(files).not.toMatch(/\bSort\b/);
  });
});
