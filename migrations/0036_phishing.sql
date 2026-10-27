-- What the receiving mail server said about who sent a message ("spf=pass dkim=pass dmarc=fail"), kept as it arrived.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS auth_results TEXT NOT NULL DEFAULT '';

-- What the owner decided about a sender or a domain: Report makes it "bad", "Looks fine" makes it "ok". A key is an address ("a@b.com") or a whole
-- domain ("@b.com"). Later mail from there is judged by it.
CREATE TABLE IF NOT EXISTS phish_verdicts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  verdict TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, key)
);
