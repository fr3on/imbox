-- Custom domains and routing configuration
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  zone_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | active | error
  routing TEXT NOT NULL DEFAULT 'unconfigured',  -- unconfigured | enabled | manual
  sending TEXT NOT NULL DEFAULT 'none',          -- cloudflare | resend | none
  catch_all_account_id TEXT,
  error TEXT,
  dns_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domains_user ON domains(user_id);
