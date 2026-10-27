-- Searching contacts. A search looks for each word in a contact's address, name and notes; with no index that reads every contact of the account, for every
-- search. This indexes the three as one text, the way 0023 does for threads and messages, so the search can use it. The expression is written the same
-- way in src/api/search.ts (CONTACT_TEXT); change one and the other must change with it. chr(31) keeps a word from matching across two fields.
SET LOCAL statement_timeout = 0;
CREATE INDEX IF NOT EXISTS idx_contacts_search ON contacts USING gin ((email || chr(31) || name || chr(31) || notes) gin_trgm_ops);
