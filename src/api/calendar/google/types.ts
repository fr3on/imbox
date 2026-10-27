export const API = "https://www.googleapis.com/calendar/v3";
export const DAY = 86_400_000;
/** How far back and forward a first sync reaches. Later syncs follow the syncToken instead. */
export const WINDOW_BACK_DAYS = 120;
export const WINDOW_FWD_DAYS = 540;
export const PAGE_LIMIT = 40;
/** 27 bound parameters per upsert; 50 statements a batch keeps one transaction a sensible size. */
export const BATCH_SIZE = 50;

export const RSVP_VALUES = new Set(["needsAction", "accepted", "declined", "tentative"]);

/** How stale a quiet calendar's `last_synced_at` may get before it is written for its own sake. */
export const HEARTBEAT_MS = 10 * 60_000;
/**
 * How often a calendar is pulled from scratch. The first pull is bounded to a window, and the sync
 * token Google hands back keeps that window for life — an event that drifts into range later is
 * never reported through it. A monthly full pull picks those up; with the etag check in applyPage
 * an unchanged calendar pays for it in reads, which are fifty times cheaper than writes.
 */
export const FULL_RESYNC_MS = 30 * DAY;

// ---------- Google's shapes ----------
export interface GTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  optional?: boolean;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
}

export interface GEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  iCalUID?: string;
  transparency?: string;
  start?: GTime;
  end?: GTime;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GAttendee[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
}

export interface GEventList {
  items?: GEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GCalendarListEntry {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  timeZone?: string;
  accessRole?: string;
  primary?: boolean;
  deleted?: boolean;
}

export interface GCalendarList {
  items?: GCalendarListEntry[];
  nextPageToken?: string;
}

export interface RemoteCalendar {
  remote_id: string;
  name: string;
  description: string;
  color: string;
  timezone: string;
  writable: boolean;
  primary: boolean;
}
