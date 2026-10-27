-- IMAP/SMTP accounts and Stalwart mail servers
CREATE TABLE IF NOT EXISTS stalwart_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 465,
  api_key_enc TEXT NOT NULL,
  api_key_hint TEXT NOT NULL DEFAULT '',
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stalwart_servers_user ON stalwart_servers(user_id);

CREATE TABLE IF NOT EXISTS imap_accounts (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_security TEXT NOT NULL DEFAULT 'tls',
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 465,
  smtp_security TEXT NOT NULL DEFAULT 'tls',
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL DEFAULT '',
  password_hint TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT 'INBOX',
  uid_validity INTEGER NOT NULL DEFAULT 0,
  last_uid INTEGER NOT NULL DEFAULT 0,
  stalwart_server_id TEXT,
  stalwart_account_id TEXT,
  initial_import INTEGER NOT NULL DEFAULT 0,
  caldav_checked_at INTEGER,
  caldav_home TEXT NOT NULL DEFAULT '',
  backlog INTEGER NOT NULL DEFAULT 0,
  import_total INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_imap_accounts_stalwart ON imap_accounts(stalwart_server_id);
