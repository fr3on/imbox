-- Bundles as batches: grouping mail from bundled senders
CREATE TABLE IF NOT EXISTS bundles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | seen
  thread_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  first_message_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  seen_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bundles_account_status ON bundles(account_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_bundles_account_email ON bundles(account_id, email, status);
