-- The Updates digest: one short briefing a day over the newsletters, receipts and notices waiting to be read.
-- `key` says which mail it was written from, so the page can tell when new mail has arrived since.
CREATE TABLE IF NOT EXISTS updates_digests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, day)
);
