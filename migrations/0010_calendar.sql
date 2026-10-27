-- Calendar events, habits, days, flex tasks, time tracking, and CalDAV synchronization
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE, -- set when source = 'google'
  source TEXT NOT NULL DEFAULT 'local',  -- local | google | ics
  remote_id TEXT,                        -- Google calendarId
  url TEXT,                              -- ICS/webcal feed
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#111111',
  timezone TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  writable INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  sync_token TEXT,
  etag TEXT,
  last_synced_at INTEGER,
  full_synced_at INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'idle', -- idle | syncing | error
  sync_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendars_user ON calendars(user_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendars_remote ON calendars(account_id, remote_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  remote_id TEXT,             -- Google eventId / ICS UID (+ recurrence-id)
  ical_uid TEXT,
  kind TEXT NOT NULL DEFAULT 'event', -- event | birthday | anniversary | todo
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '',
  all_day INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  start_date TEXT,            -- YYYY-MM-DD, all-day only
  end_date TEXT,              -- YYYY-MM-DD, inclusive last day
  timezone TEXT NOT NULL DEFAULT '',
  rrule TEXT,                 -- RRULE for masters we expand ourselves (local + ICS)
  exdates TEXT NOT NULL DEFAULT '',  -- comma-separated YYYY-MM-DD of skipped instances
  master_id TEXT,             -- this row overrides one occurrence of master_id
  occurrence_date TEXT,       -- which occurrence of master_id this row replaces
  status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | tentative | cancelled
  busy INTEGER NOT NULL DEFAULT 1,
  countdown INTEGER NOT NULL DEFAULT 0,  -- show "in 12 days" on the event
  circled INTEGER NOT NULL DEFAULT 0,    -- "circle this event"
  organizer_email TEXT NOT NULL DEFAULT '',
  organizer_name TEXT NOT NULL DEFAULT '',
  attendees_json TEXT NOT NULL DEFAULT '[]',
  rsvp TEXT NOT NULL DEFAULT '',   -- needsAction | accepted | declined | tentative
  conference_url TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  reminders_json TEXT NOT NULL DEFAULT '[]', -- [{minutes:number}]
  thread_id TEXT,             -- created from this email
  message_id TEXT,
  done_at INTEGER,            -- todos
  etag TEXT,
  href TEXT,
  pushed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_window ON events(user_id, starts_at, ends_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_remote ON events(calendar_id, remote_id);
CREATE INDEX IF NOT EXISTS idx_events_masters ON events(user_id, starts_at) WHERE rrule IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_master ON events(master_id) WHERE master_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_thread ON events(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_href ON events(calendar_id, href);

CREATE TABLE IF NOT EXISTS event_completions (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,        -- YYYY-MM-DD of the occurrence
  done_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, date)
);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#111111',
  days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', -- weekdays it's expected on
  position INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id, position);

CREATE TABLE IF NOT EXISTS habit_completions (
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  done_at INTEGER NOT NULL,
  PRIMARY KEY (habit_id, date)
);

CREATE TABLE IF NOT EXISTS calendar_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,               -- YYYY-MM-DD
  label TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  cover_id TEXT,
  cover_position TEXT NOT NULL DEFAULT '50% 50%',
  journal_html TEXT NOT NULL DEFAULT '',
  journal_updated_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_calendar_days_journal ON calendar_days(user_id, journal_updated_at DESC);

CREATE TABLE IF NOT EXISTS flex_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,   -- YYYY-MM-DD of that week's first day
  title TEXT NOT NULL DEFAULT '',
  done_at INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flex_tasks_week ON flex_tasks(user_id, week_start, position);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,           -- NULL while running
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS calendar_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT '',
  week_start INTEGER NOT NULL DEFAULT 1,   -- 0 = Sunday, 1 = Monday
  night_start INTEGER NOT NULL DEFAULT 22, -- hours collapsed as "Nighttime"
  night_end INTEGER NOT NULL DEFAULT 6,
  collapse_night INTEGER NOT NULL DEFAULT 1,
  time_format TEXT NOT NULL DEFAULT '12',  -- 12 | 24
  default_view TEXT NOT NULL DEFAULT 'week',
  show_declined INTEGER NOT NULL DEFAULT 0,
  cover_art INTEGER NOT NULL DEFAULT 0,    -- show the calendar snapshot in the Imbox
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS day_covers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL DEFAULT 'image/jpeg',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_day_covers_user ON day_covers(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS removed_calendars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  remote_id TEXT NOT NULL,
  removed_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_removed_calendars ON removed_calendars(account_id, remote_id);

CREATE TABLE IF NOT EXISTS caldav_deletes (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  href TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
