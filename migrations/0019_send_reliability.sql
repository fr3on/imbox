-- Send idempotency / deduplication and vacation auto-replies
CREATE TABLE IF NOT EXISTS send_attempts (
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending',
  result_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_send_attempts_created ON send_attempts(created_at);

CREATE TABLE IF NOT EXISTS vacation_replies (
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, email)
);
CREATE INDEX IF NOT EXISTS idx_vacation_replies_sent ON vacation_replies(user_id, sent_at);
