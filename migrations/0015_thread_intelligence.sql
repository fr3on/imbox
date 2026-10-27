-- Thread intelligence: summaries, catchups, suggested actions, action states, and gists
CREATE TABLE IF NOT EXISTS thread_summaries (
  thread_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_summaries_account ON thread_summaries(account_id);

CREATE TABLE IF NOT EXISTS thread_catchups (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, key)
);

CREATE TABLE IF NOT EXISTS thread_actions (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, key)
);

CREATE TABLE IF NOT EXISTS thread_action_state (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, action_id)
);

CREATE TABLE IF NOT EXISTS thread_gists (
  thread_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  gist TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
