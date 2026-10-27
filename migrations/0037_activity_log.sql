-- Everything imbox did, or you did in it, that a person might ask about later: who acted ("you", "rules", "ai", "agent", "sync", "security"),
-- what happened, and a short reason. It holds names and subjects, never message bodies or keys, and is pruned after 90 days.
CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at BIGINT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  thread_id TEXT,
  account_id TEXT,
  level TEXT NOT NULL DEFAULT 'info'
);
CREATE INDEX IF NOT EXISTS idx_activity_user_at ON activity_log(user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_thread ON activity_log(user_id, thread_id, at DESC) WHERE thread_id IS NOT NULL;
