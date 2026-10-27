-- Fast decisions with TypeSafe AI's Jev model: the owner's key (encrypted), whether it is switched on, and which decisions it may make
-- (a JSON object such as {"phishing":false}; a decision that is not named is on while the switch is on).
CREATE TABLE IF NOT EXISTS jev_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_enc TEXT NOT NULL DEFAULT '',
  key_hint TEXT NOT NULL DEFAULT '',
  enabled SMALLINT NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL
);

-- What Jev said about a message, kept so opening the same message again costs nothing.
CREATE TABLE IF NOT EXISTS jev_checks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  probability DOUBLE PRECISION NOT NULL,
  pressure DOUBLE PRECISION NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, message_id, kind)
);
