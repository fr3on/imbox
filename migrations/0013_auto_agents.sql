-- Autonomous background agents, run logs, and agent memory
CREATE TABLE IF NOT EXISTS auto_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  account_ids TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'draft',            -- draft | auto
  enabled INTEGER NOT NULL DEFAULT 0,
  only_screened_in INTEGER NOT NULL DEFAULT 1,
  senders TEXT NOT NULL DEFAULT '',              -- optional: only these addresses or domains
  daily_limit INTEGER NOT NULL DEFAULT 20,
  watermark INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_agents_user ON auto_agents(user_id);

CREATE TABLE IF NOT EXISTS auto_agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  status TEXT NOT NULL,                          -- running | replied | drafted | acted | skipped | error
  summary TEXT NOT NULL DEFAULT '',
  draft_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_runs_message ON auto_agent_runs(agent_id, message_id);
CREATE INDEX IF NOT EXISTS idx_auto_runs_agent ON auto_agent_runs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_runs_thread ON auto_agent_runs(thread_id, status);

CREATE TABLE IF NOT EXISTS auto_agent_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES auto_agents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'fact', -- fact | rule | faq | tone | contact
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user', -- user | learned
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_agent_memory_agent ON auto_agent_memory(agent_id, kind);
CREATE INDEX IF NOT EXISTS idx_auto_agent_memory_user ON auto_agent_memory(user_id);
