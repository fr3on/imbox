-- Contacts, address book, brand logos, and sender pictures
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  screen_status TEXT NOT NULL DEFAULT 'pending', -- pending | imbox | feed | paper_trail | screened_out
  screened_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  bundled INTEGER NOT NULL DEFAULT 0,
  photo_checked_at INTEGER,
  UNIQUE(account_id, email)
);
CREATE INDEX IF NOT EXISTS idx_contacts_account_status ON contacts(account_id, screen_status);

CREATE TABLE IF NOT EXISTS address_book (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, email)
);
CREATE INDEX IF NOT EXISTS idx_address_book_email ON address_book(account_id, email);

CREATE TABLE IF NOT EXISTS brand_logos (
  domain TEXT PRIMARY KEY,
  logo_url TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sender_photos (
  key TEXT PRIMARY KEY,
  url TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL
);
