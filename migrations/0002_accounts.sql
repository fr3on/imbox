-- Connected mail accounts (Gmail, Outlook, IMAP, custom domains)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gmail',
  domain_id TEXT,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  history_id TEXT,
  delta_link TEXT,
  initial_sync_done INTEGER NOT NULL DEFAULT 0,
  initial_sync_page_token TEXT,
  initial_sync_count INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'idle', -- idle | syncing | error | disconnected
  sync_error TEXT,
  last_synced_at INTEGER,
  signature TEXT NOT NULL DEFAULT '',
  cover_art TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  photos_synced_at INTEGER,
  contacts_changed_at INTEGER,
  scopes TEXT NOT NULL DEFAULT '',
  calendar_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
