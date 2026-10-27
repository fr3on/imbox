-- Workflows: rules you write once ("when mail arrives and it matches, do these things"), and a log of what each one did.
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled SMALLINT NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL DEFAULT 'message_arrives',  -- message_arrives | no_reply
  trigger_days BIGINT NOT NULL DEFAULT 3,           -- no_reply: days without an answer
  match TEXT NOT NULL DEFAULT 'all',                 -- all | any
  conditions TEXT NOT NULL DEFAULT '[]',             -- [{field, op, value}]
  actions TEXT NOT NULL DEFAULT '[]',                -- [{type, ...}]
  account_ids TEXT NOT NULL DEFAULT '[]',            -- empty: every mailbox of the user
  daily_limit BIGINT NOT NULL DEFAULT 200,
  watermark BIGINT NOT NULL DEFAULT 0,
  last_run_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,                         -- the message id, or "noreply:<last message time>": a thing is handled once
  status TEXT NOT NULL,                              -- done | partial | error
  summary TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_key ON workflow_runs(workflow_id, trigger_key);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf ON workflow_runs(workflow_id, created_at DESC);
