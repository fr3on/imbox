-- Screener AI suggestions, automated let-ins, and imbox hints
CREATE TABLE IF NOT EXISTS screener_suggestions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  bucket TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  outcome TEXT,
  person INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, email)
);

CREATE TABLE IF NOT EXISTS auto_let_ins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'rules',
  created_at INTEGER NOT NULL,
  seen_at INTEGER,
  undone_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_let_ins_user_email ON auto_let_ins(user_id, email);
CREATE INDEX IF NOT EXISTS idx_auto_let_ins_user_time ON auto_let_ins(user_id, created_at);

CREATE TABLE IF NOT EXISTS imbox_hints (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'none',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'ai',
  last_message_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_imbox_hints_user ON imbox_hints(user_id, verdict);
