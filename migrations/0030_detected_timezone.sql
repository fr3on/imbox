-- The zone the person's browser last reported (the X-Timezone header), for when no calendar timezone is saved.
ALTER TABLE users ADD COLUMN IF NOT EXISTS detected_timezone TEXT NOT NULL DEFAULT '';
