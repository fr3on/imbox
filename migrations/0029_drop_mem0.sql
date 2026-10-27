-- The mem0 memory sync is gone: the assistant's memory lives only in imbox.
UPDATE ai_memory SET source = 'learned' WHERE source = 'mem0';
ALTER TABLE ai_memory DROP COLUMN IF EXISTS mem0_id;
ALTER TABLE ai_memory DROP COLUMN IF EXISTS mem0_synced_at;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_enabled;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_base_url;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_api_key_enc;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_key_hint;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_last_synced_at;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_mode;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS mem0_user_id;
