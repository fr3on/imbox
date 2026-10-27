#!/usr/bin/env node
// Adds today's Updates digest to the demo mailbox made by seed-demo.mjs, written by hand (the demo has no AI behind it). Run it after seed-demo.mjs:
//   DATABASE_URL=postgres://... node scripts/seed-demo-digest.mjs
// The digest says which mails it covers, so the page shows it as written and does not ask for a new one.
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });
const user = (await pool.query("SELECT id FROM users LIMIT 1")).rows[0];
if (!user) throw new Error("no user: finish /signup first");
const now = Date.now();
const rows = (
  await pool.query(
    `SELECT t.id, t.subject, t.last_from_name, t.last_message_at FROM threads t
     WHERE t.account_id IN (SELECT id FROM accounts WHERE user_id = $1) AND t.merged_into IS NULL AND t.bucket IN ('feed', 'paper_trail') AND t.seen = 0
       AND t.last_message_at >= $2 ORDER BY t.last_message_at DESC, t.id DESC LIMIT 20`,
    [user.id, now - 7 * 24 * 3600_000],
  )
).rows;
const by = (subject) => rows.find((r) => r.subject.startsWith(subject));
const src = (subject) => {
  const r = by(subject);
  return r ? [{ thread_id: r.id, from: r.last_from_name, subject: r.subject }] : [];
};
const sections = [
  { theme: "Reading", text: "Two newsletters make a case for calmer software: fewer notifications and quieter defaults, and for choosing boring technology on purpose.", sources: [...src("Issue 214"), ...src("The case for boring")] },
  { theme: "Design", text: "Kite Design explains how to build a typographic scale, with a ratio to start from and three common mistakes.", sources: src("New: typographic") },
  { theme: "Money and travel", text: "Your Cloudbox plan receipt for November is in, and the Amsterdam to Lisbon booking is confirmed.", sources: [...src("Receipt for your November"), ...src("Your booking confirmation")] },
  { theme: "Support", text: "Cloud Support added a reply to case 4820 about production access and is waiting on your answer.", sources: src("[Case 4820] New correspondence") },
].filter((s) => s.sources.length);
const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const digest = { day, sections, count: rows.length, covers: rows.map((r) => `${r.id}:${r.last_message_at}`), created_at: now };
await pool.query(
  `INSERT INTO updates_digests (user_id, day, key, body, model, created_at) VALUES ($1,$2,'demo',$3,'demo',$4)
   ON CONFLICT (user_id, day) DO UPDATE SET body = excluded.body, created_at = excluded.created_at`,
  [user.id, day, JSON.stringify(digest), now],
);
console.log(`Wrote a digest of ${sections.length} themes over ${rows.length} mails for ${day}`);
await pool.end();
