-- Contact reviews: second-look suggestions for sorted senders
CREATE TABLE IF NOT EXISTS contact_reviews (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  suggest TEXT,
  reason TEXT NOT NULL DEFAULT '',
  count_at INTEGER NOT NULL DEFAULT 0,
  reviewed_at INTEGER NOT NULL,
  state TEXT,
  PRIMARY KEY (user_id, email)
);
