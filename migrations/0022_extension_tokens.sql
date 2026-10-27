-- Tokens for the browser extension. Each one is a long random string that is shown once; only its hash is kept here. A token can read the
-- counts and the Screener queue and make a Screener decision, and nothing else (see src/api/extensionTokens.ts).
CREATE TABLE IF NOT EXISTS extension_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_extension_tokens_user ON extension_tokens(user_id, created_at DESC);
