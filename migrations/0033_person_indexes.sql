-- Finding a person's mail, and the address book as someone types.
--
-- A person's page asks which messages are with them: from them (`from_email = ?`), or with them in the recipients (`to_json` or `cc_json` holds their address
-- in quotes). Neither had a usable index, so each visit read every message there is (4.4 seconds with 321,000 messages, half a second warm, growing with the
-- mail). The sender is a plain btree on `from_email`; the 0023 index does not serve it, because a prefix of the text shared by most senders matches too many
-- trigrams to help (1.8 seconds measured). The two recipient lists are indexed as one text with pg_trgm, the way 0023 does for the text of a message. The
-- expression is written the same way in src/api/search.ts (RECIPIENTS_TEXT); change one and the other must change.
--
-- The person's page also lists their conversations, matching `participants_json` of the thread; that column gets the same kind of index.
--
-- The compose suggestions look in the address book for each key typed, with `ILIKE` on the address and the name, which read the whole book (60 ms with 50,000
-- people). This indexes the two as one text, as 0031 does for contacts (ADDRESS_TEXT in src/api/search.ts).
--
-- Building them takes a few seconds per 100,000 rows, so this migration is exempt from the statement time limit, as 0023 is. Writes to the tables wait while
-- it runs.
SET LOCAL statement_timeout = 0;
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages (from_email);
CREATE INDEX IF NOT EXISTS idx_messages_recipients ON messages USING gin ((to_json || chr(31) || cc_json) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_participants ON threads USING gin (participants_json gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_address_book_search ON address_book USING gin ((email || chr(31) || name) gin_trgm_ops);
