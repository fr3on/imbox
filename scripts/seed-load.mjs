#!/usr/bin/env node
// Fills a Postgres database with a large, made-up mailbox so the app and its queries can be measured at a realistic size.
//   DATABASE_URL=postgres://... node scripts/seed-load.mjs            (defaults: 1 user, 2 mailboxes, 100000 threads each, about 320000 messages, about 107000 attachments)
//   USERS=2 ACCOUNTS=2 THREADS=50000 node scripts/seed-load.mjs        (a different size)
//   node scripts/seed-load.mjs --reset                                (removes everything this script made)
// Start the server once against the database first, so the schema exists. Everything is generated in SQL, so it takes a minute or two, not an hour.
// Prints a session token for each user to use with scripts/load-test.mjs. Names, addresses and text are invented.
import crypto from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const USERS = Number(process.env.USERS ?? 1);
const ACCOUNTS = Number(process.env.ACCOUNTS ?? 2);
const THREADS = Number(process.env.THREADS ?? 100_000);
const SENDERS = Number(process.env.SENDERS ?? 3000);
const pool = new pg.Pool({ connectionString: url, max: 2 });

if (process.argv.includes("--reset")) {
  await pool.query(`DELETE FROM users WHERE id LIKE 'load-u%'`);
  console.log("removed");
  await pool.end();
  process.exit(0);
}

const now = Date.now();
const YEAR = 365 * 24 * 3600 * 1000;
const sql = (text, params = []) => pool.query(text, params);
const t0 = Date.now();
const lap = (what) => console.error(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${what}`);

// Words that give the search something to find, at different frequencies.
const SUBJECTS = "{Quarterly plan,Invoice attached,Your receipt,Meeting notes,Weekly digest,Shipping update,Welcome aboard,Security alert,Budget review,Lunch on Friday,Draft for review,Contract renewal,Trip itinerary,New comment,Payment received,Reminder,Follow up,Project kickoff,Release notes,Feedback request}";

const tokens = [];
for (let u = 1; u <= USERS; u++) {
  const uid = `load-u${u}`;
  await sql(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, 'x', $4) ON CONFLICT (id) DO NOTHING`, [uid, `maya${u}@chen.example`, "Maya Chen", now]);
  const token = crypto.randomBytes(24).toString("hex");
  await sql(`INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, 'load-test')`, [token, uid, now, now + 30 * 24 * 3600 * 1000]);
  tokens.push({ user: uid, token });

  for (let a = 1; a <= ACCOUNTS; a++) {
    const acc = `load-u${u}-a${a}`;
    await sql(
      `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, scopes, initial_sync_done, sync_status, signature, cover_art, avatar_url, created_at)
       VALUES ($1, $2, 'imap', $3, 'Maya Chen', '', '', '', 1, 'idle', '', '', '', $4) ON CONFLICT (id) DO NOTHING`,
      [acc, uid, `maya${u}.${a}@chen.example`, now]
    );
    // Senders, with the screening decision the thread buckets follow: 30% imbox, 30% feed, 25% paper trail, 10% screened out, 5% waiting in the screener.
    await sql(
      `INSERT INTO contacts (id, account_id, email, name, screen_status, screened_at, first_seen_at, last_seen_at, message_count)
       SELECT $1::text || '-c' || s, $1::text, 'sender' || s || '@' || (ARRAY['example.org','mail.example.net','news.example.com','billing.example.io'])[1 + s % 4], 'Sender ' || s,
              CASE WHEN s % 100 < 30 THEN 'imbox' WHEN s % 100 < 60 THEN 'feed' WHEN s % 100 < 85 THEN 'paper_trail' WHEN s % 100 < 95 THEN 'screened_out' ELSE 'pending' END,
              $2::bigint, $2::bigint - $3::bigint, $2::bigint, 0
       FROM generate_series(1, $4::int) s ON CONFLICT DO NOTHING`,
      [acc, now, YEAR, SENDERS]
    );
    lap(`${acc}: contacts`);
    await sql(
      `INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, seen, unread, participants_json, last_from_email, last_from_name, message_count,
                            first_message_at, last_message_at, created_at, updated_at, has_attachments)
       SELECT $1::text || '-t' || g, $1::text, $1::text || '-t' || g,
              ($5::text[])[1 + g % 20] || ' #' || g,
              'Hello Maya, this is message ' || g || ' in a long running conversation about the plan.',
              CASE WHEN s % 100 < 30 THEN 'imbox' WHEN s % 100 < 60 THEN 'feed' WHEN s % 100 < 85 THEN 'paper_trail' WHEN s % 100 < 95 THEN 'screened_out' ELSE 'screener' END,
              (g % 3 = 0)::int, (g % 7 = 0)::int,
              '[{"email":"sender' || s || '@example.org","name":"Sender ' || s || '"}]',
              'sender' || s || '@' || (ARRAY['example.org','mail.example.net','news.example.com','billing.example.io'])[1 + s % 4], 'Sender ' || s,
              1 + (g % 3 = 0)::int + (g % 11 = 0)::int * 3,
              ($2::bigint - (g::bigint * $3::bigint / $4)) - 3600000, $2::bigint - (g::bigint * $3::bigint / $4), $2, $2, (g % 12 = 0)::int
       FROM (SELECT g, 1 + (g::bigint * 7919) % $6 AS s FROM generate_series(1, $4::int) g) x`,
      [acc, now, 3 * YEAR, THREADS, SUBJECTS, SENDERS]
    );
    lap(`${acc}: threads`);
    // Messages: each thread's message count, a few kilobytes of text each, with some words that appear in about 1 in 50 and 1 in 1000 of them.
    await sql(
      `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, subject, date, snippet, text_body, html_body, unread, message_id_header, size_estimate, created_at)
       SELECT t.id || '-m' || k, t.account_id, t.id, t.id || '-m' || k, t.last_from_email, t.last_from_name, '[{"email":"maya@chen.example","name":"Maya Chen"}]', t.subject,
              t.last_message_at - (t.message_count - k) * 600000, t.snippet,
              'Hi Maya, ' || repeat(md5(t.id || k) || ' project update and notes for the week. ', 25)
                || CASE WHEN (t.message_count + k) % 50 = 0 THEN ' The quarterly invoice is attached.' ELSE '' END
                || CASE WHEN (t.message_count * k + length(t.id)) % 1000 = 0 THEN ' Please see the Zanzibar contract.' ELSE '' END,
              '', t.unread, '<' || t.id || '-m' || k || '@example.org>', 3000, $2
       FROM threads t, LATERAL generate_series(1, t.message_count) k WHERE t.account_id = $1`,
      [acc, now]
    );
    lap(`${acc}: messages`);
    // Files: about one message in three carries one, so what reaches for attachments (a thread, the Feed, the Files page) has a table of a realistic size to look through.
    await sql(
      `INSERT INTO attachments (id, account_id, message_id, thread_id, gmail_attachment_id, filename, mime_type, size, created_at, is_inline)
       SELECT m.id || '-a', m.account_id, m.id, m.thread_id, m.id || '-a',
              (ARRAY['invoice','report','photo','contract','slides','notes','receipt'])[1 + abs(hashtext(m.id)) % 7] || '-' || (abs(hashtext(m.id)) % 100000) || (ARRAY['.pdf','.png','.docx','.xlsx'])[1 + abs(hashtext(m.id || 'x')) % 4],
              'application/octet-stream', 20000 + abs(hashtext(m.id)) % 900000, m.date, 0
       FROM messages m WHERE m.account_id = $1 AND abs(hashtext(m.id)) % 3 = 0`,
      [acc]
    );
    lap(`${acc}: attachments`);
    await sql(`UPDATE contacts c SET message_count = x.n FROM (SELECT last_from_email AS e, count(*) AS n FROM threads WHERE account_id = $1 GROUP BY 1) x WHERE c.account_id = $1 AND c.email = x.e`, [acc]);
  }
}
await sql(`ANALYZE`);
lap("analyzed");
const counts = (await sql(`SELECT (SELECT count(*) FROM threads WHERE account_id LIKE 'load-%') AS threads, (SELECT count(*) FROM messages WHERE account_id LIKE 'load-%') AS messages, (SELECT count(*) FROM attachments WHERE account_id LIKE 'load-%') AS attachments, pg_size_pretty(pg_database_size(current_database())) AS size`)).rows[0];
console.log(JSON.stringify({ ...counts, tokens }, null, 2));
await pool.end();
