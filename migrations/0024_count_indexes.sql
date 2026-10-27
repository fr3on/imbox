-- The counts behind the badges and the Imbox page (`/counts`, `/imbox`) ask "how many unseen threads are in this place, not merged, not snoozed", and with
-- 40,000 of them each count read every one of those rows from the table (100 ms). These indexes hold what the count needs, so it is answered
-- from the index alone (10 ms). The WHERE of each is part of the queries' own conditions in src/api/routes/mail.ts and screener.ts.
SET LOCAL statement_timeout = 0;
CREATE INDEX IF NOT EXISTS idx_threads_unseen ON threads(account_id, bucket) INCLUDE (bundle_id, reply_later, set_aside, bubble_up_at) WHERE seen = 0 AND merged_into IS NULL;

-- The senders waiting in the Screener: counted, and listed 24 at a time with their thread counts, on every Imbox page load.
CREATE INDEX IF NOT EXISTS idx_threads_screener ON threads(account_id) INCLUDE (last_from_email, last_from_name, last_message_at, bubble_up_at) WHERE bucket = 'screener' AND merged_into IS NULL;

-- "Threads merged into this one", asked every time a thread is opened; most threads have none, so the index holds only the few that are.
CREATE INDEX IF NOT EXISTS idx_threads_merged ON threads(account_id, merged_into) WHERE merged_into IS NOT NULL;

-- The newest few threads of each waiting sender, one probe per sender. Matches `LOWER(t.last_from_email) = ...` in the Screener query.
CREATE INDEX IF NOT EXISTS idx_threads_screener_sender ON threads(LOWER(last_from_email), last_message_at DESC) WHERE bucket = 'screener' AND merged_into IS NULL;
