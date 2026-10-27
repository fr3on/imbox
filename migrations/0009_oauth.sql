-- OAuth app credentials for mail providers
CREATE TABLE IF NOT EXISTS oauth_credentials (
  provider TEXT PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT '',
  secret_enc TEXT NOT NULL DEFAULT '',
  secret_hint TEXT NOT NULL DEFAULT '',
  override_env INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
