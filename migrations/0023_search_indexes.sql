-- Indexes for finding mail and for listing it. A search looks for a word anywhere in a thread's text or in the text of its messages; without a trigram
-- index that reads every message, which took 3 to 20 seconds with 300,000 messages. The expressions must match the ones in src/api/search.ts.
-- Building these on a large mailbox takes a minute or more, so this migration is exempt from the statement time limit. Writes to the two tables wait while it runs.
SET LOCAL statement_timeout = 0;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_threads_search ON threads USING gin ((subject || char(31) || COALESCE(custom_subject, '') || char(31) || snippet || char(31) || participants_json || char(31) || note) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING gin ((from_email || char(31) || subject || char(31) || text_body) gin_trgm_ops);

-- A list of one place, newest first, across all of a person's mailboxes: the planner reads this in order and stops after one page, where the
-- (account_id, bucket, last_message_at) index cannot serve a list that spans more than one mailbox.
CREATE INDEX IF NOT EXISTS idx_threads_bucket_last ON threads(bucket, last_message_at DESC);

-- A search for a word that is in many messages walks the threads newest first and stops after one page of matches, which needs this order.
CREATE INDEX IF NOT EXISTS idx_threads_last ON threads(last_message_at DESC);
