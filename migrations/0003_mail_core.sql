-- Core mail storage: threads, messages, attachments, blobs, labels, collections, clips, drafts
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  custom_subject TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  bucket TEXT NOT NULL DEFAULT 'screener', -- screener | imbox | feed | paper_trail | screened_out | trash
  seen INTEGER NOT NULL DEFAULT 0,          -- opened at least once ("Previously seen")
  unread INTEGER NOT NULL DEFAULT 1,
  reply_later INTEGER NOT NULL DEFAULT 0,
  reply_later_at INTEGER,
  set_aside INTEGER NOT NULL DEFAULT 0,
  set_aside_at INTEGER,
  bubble_up_at INTEGER,                    -- hidden until this time
  bubbled INTEGER NOT NULL DEFAULT 0,       -- has bubbled up (show badge)
  merged_into TEXT,                         -- thread id this was merged into
  note TEXT NOT NULL DEFAULT '',            -- sticky note on the thread
  has_attachments INTEGER NOT NULL DEFAULT 0,
  trackers_blocked INTEGER NOT NULL DEFAULT 0,
  participants_json TEXT NOT NULL DEFAULT '[]', -- [{email,name}]
  last_from_email TEXT NOT NULL DEFAULT '',
  last_from_name TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  first_message_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL,
  is_sent_only INTEGER NOT NULL DEFAULT 0,  -- thread only contains messages from me
  bundle_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, gmail_thread_id)
);
CREATE INDEX IF NOT EXISTS idx_threads_account_bucket ON threads(account_id, bucket, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_reply_later ON threads(account_id, reply_later);
CREATE INDEX IF NOT EXISTS idx_threads_set_aside ON threads(account_id, set_aside);
CREATE INDEX IF NOT EXISTS idx_threads_bubble ON threads(bubble_up_at);
CREATE INDEX IF NOT EXISTS idx_threads_bundle ON threads(bundle_id);
CREATE INDEX IF NOT EXISTS idx_threads_account_updated ON threads(account_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  from_email TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  date INTEGER NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  is_from_me INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 1,
  message_id_header TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  references_header TEXT NOT NULL DEFAULT '',
  list_unsubscribe TEXT NOT NULL DEFAULT '',
  gmail_labels_json TEXT NOT NULL DEFAULT '[]',
  has_attachments INTEGER NOT NULL DEFAULT 0,
  trackers_json TEXT NOT NULL DEFAULT '[]',
  size_estimate INTEGER NOT NULL DEFAULT 0,
  list_id TEXT NOT NULL DEFAULT '',
  precedence TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, date);
CREATE INDEX IF NOT EXISTS idx_messages_account_date ON messages(account_id, date DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  gmail_attachment_id TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  content_id TEXT NOT NULL DEFAULT '',
  is_inline INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_account ON attachments(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

CREATE TABLE IF NOT EXISTS attachment_blobs (
  attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#0f766e',
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, name)
);

CREATE TABLE IF NOT EXISTS thread_labels (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY(thread_id, label_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_threads (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY(collection_id, thread_id)
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clips_account ON clips(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT,
  reply_to_message_id TEXT,
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  send_at INTEGER,                 -- scheduled send (send later)
  status TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sending | sent | failed
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_account ON drafts(account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_scheduled ON drafts(status, send_at);
