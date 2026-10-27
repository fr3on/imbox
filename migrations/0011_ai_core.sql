-- AI assistant: configuration, memory, conversations, messages, learning state, and usage metrics
CREATE TABLE IF NOT EXISTS ai_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'anthropic', -- anthropic | openai_compatible
  preset TEXT NOT NULL DEFAULT 'anthropic',   -- anthropic | openai | xai | openrouter | gemini | custom
  base_url TEXT NOT NULL DEFAULT '',
  api_key_enc TEXT NOT NULL DEFAULT '',
  key_hint TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'claude-opus-5',
  learn INTEGER NOT NULL DEFAULT 1,
  auto_send INTEGER NOT NULL DEFAULT 0,
  mem0_enabled INTEGER NOT NULL DEFAULT 0,
  mem0_base_url TEXT NOT NULL DEFAULT '',
  mem0_api_key_enc TEXT NOT NULL DEFAULT '',
  mem0_key_hint TEXT NOT NULL DEFAULT '',
  mem0_last_synced_at INTEGER,
  mem0_mode TEXT NOT NULL DEFAULT 'own',
  mem0_user_id TEXT NOT NULL DEFAULT '',
  screener_suggest INTEGER NOT NULL DEFAULT 1,
  daily_brief INTEGER NOT NULL DEFAULT 1,
  suggest_actions INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'fact', -- profile | tone | fact | preference | contact
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user', -- user | assistant | learned
  mem0_id TEXT,
  mem0_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_memory_user ON ai_memory(user_id, kind);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- user | assistant
  content_json TEXT NOT NULL, -- Anthropic content blocks
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_learning_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_learned_at INTEGER,
  last_sent_date INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_user_time ON ai_calls(user_id, created_at);
