-- Files on mail. Two ways of finding an attachment had no index, so each read every attachment there is.
--
-- By thread: opening a thread, the Feed and Updates (a card shows its files), the assistant's tools and the search all ask for the attachments of some
-- threads. The messages of a thread have an index for it; its attachments did not, so each of those requests read the whole table (11 ms with 100,000
-- attachments, and growing with them).
--
-- Newest first across all of a person's mailboxes, for the Files page and the files in a search: the planner walks this in order and stops after one
-- page, where (account_id, created_at) cannot serve a list that spans more than one mailbox. Only files that are not inline pictures are listed, so only
-- they are indexed, with their account in the index so the check does not read the table.
--
-- Building them takes about a second per 100,000 attachments, so this migration is exempt from the statement time limit, as 0023 is.
SET LOCAL statement_timeout = 0;
CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id);
CREATE INDEX IF NOT EXISTS idx_attachments_files ON attachments(created_at DESC) INCLUDE (account_id) WHERE is_inline = 0;
