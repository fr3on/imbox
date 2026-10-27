-- Data repairs and reconciliations for existing mailboxes, senders, and thoughts
UPDATE accounts
SET sync_status = 'error'
WHERE sync_status = 'disconnected'
  AND provider = 'imap'
  AND (sync_error LIKE 'imap_timeout: login%' OR sync_error LIKE 'imap_closed: login%');

DELETE FROM sender_photos WHERE url = '' AND key LIKE 'd:%';
UPDATE contacts SET photo_checked_at = NULL WHERE avatar_url = '';

UPDATE day_thoughts SET reaction = 'happy' WHERE reaction = 'like';
UPDATE day_thoughts SET reaction = 'meh' WHERE reaction = 'dislike';

UPDATE contacts
SET screen_status = 'imbox', screened_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE screen_status = 'pending'
  AND lower(email) IN (SELECT lower(a.email) FROM accounts a WHERE a.user_id = (SELECT a2.user_id FROM accounts a2 WHERE a2.id = contacts.account_id));

UPDATE threads
SET bucket = 'imbox'
WHERE bucket = 'screener'
  AND EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = threads.account_id AND c.email = threads.last_from_email AND c.screen_status = 'imbox');
