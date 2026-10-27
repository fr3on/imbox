-- Finding a contact by an address in any case.
--
-- The assistant's tools and the contact review look a contact up with `LOWER(email) = ?`, which the btree on (account_id, email) cannot serve, so each lookup
-- read every contact of the mailbox (8 ms with 6,000; it grows with the book). This indexes the same expression, written the same way in the queries
-- (ai/tools/context.ts, ai/tools/contacts.ts). Small table, quick to build.
CREATE INDEX IF NOT EXISTS idx_contacts_lower_email ON contacts (account_id, LOWER(email));
