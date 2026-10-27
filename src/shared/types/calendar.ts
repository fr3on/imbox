import type { Address } from "./common";

export type CalendarSource = "local" | "google" | "ics" | "caldav";
export type EventKind = "event" | "birthday" | "anniversary" | "todo";
export type Rsvp = "" | "needsAction" | "accepted" | "declined" | "tentative";
/** Apple-style: a day, a week, a month, a year. */
export type CalendarView = "days" | "week" | "month" | "year";

export interface Calendar {
  id: string;
  account_id: string | null;
  account_email?: string | null;
  source: CalendarSource;
  remote_id: string | null;
  url: string | null;
  name: string;
  description: string;
  color: string;
  timezone: string;
  visible: boolean;
  writable: boolean;
  is_default: boolean;
  position: number;
  last_synced_at: number | null;
  sync_status: "idle" | "syncing" | "error";
  sync_error: string | null;
  event_count?: number;
}

export interface EventAttendee {
  email: string;
  name?: string;
  rsvp?: Rsvp;
  optional?: boolean;
  organizer?: boolean;
}

export interface Reminder {
  minutes: number;
}

/** One occurrence, ready to draw. Recurring masters are expanded server-side into these. */
export interface CalEvent {
  id: string;            // "<row id>" or "<row id>@<YYYY-MM-DD>" for an expanded occurrence
  event_id: string;      // the stored row
  occurrence_date: string | null;
  calendar_id: string;
  calendar_name: string;
  calendar_color: string;
  source: CalendarSource;
  writable: boolean;
  kind: EventKind;
  title: string;
  description: string;
  location: string;
  emoji: string;
  all_day: boolean;
  starts_at: number;
  ends_at: number;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  rrule: string | null;
  recurring: boolean;
  /**
   * A repeating event Google already expanded into one row per occurrence. It repeats, but there is
   * no RRULE here to narrow an edit down with — so a delete can reach the whole series while a save
   * only ever means this one occurrence.
   */
  series?: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  busy: boolean;
  countdown: boolean;
  circled: boolean;
  organizer: Address | null;
  attendees: EventAttendee[];
  rsvp: Rsvp;
  conference_url: string;
  url: string;
  reminders: Reminder[];
  thread_id: string | null;
  done: boolean;
  created_at: number;
  updated_at: number;
}

export interface DayCover {
  id: string;
  url: string;
  width: number;
  height: number;
  size: number;
  name: string;
  created_at: number;
}

export interface CalendarDay {
  date: string;
  label: string;
  cover_url: string;
  cover_id: string | null;
  /** CSS object-position for the crop, e.g. "50% 30%". */
  cover_position: string;
  has_journal: boolean;
  journal_updated_at: number | null;
}

export interface CalendarSettings {
  timezone: string;
  week_start: number;
  night_start: number;
  night_end: number;
  collapse_night: boolean;
  time_format: "12" | "24";
  default_view: CalendarView;
  show_declined: boolean;
  cover_art: boolean;
}

/** GET /api/calendar/events?from=&to= — everything needed to draw a range of days. */
export interface CalendarRange {
  from: string;
  to: string;
  events: CalEvent[];
  days: CalendarDay[];
}

/** One connected Google account, and what its refresh token actually carries. */
export interface GoogleCalendarAccount {
  id: string;
  email: string;
  /** Its token carries the Google Calendar scope. */
  calendar: boolean;
  /** Its token carries the Gmail scope — or predates the `scopes` column, which means it does. */
  mail: boolean;
  /** How many of its calendars inbox holds. */
  calendar_count: number;
  sync_error: string | null;
  /** Why the calendar list failed, when the scope is granted but Google refused the call. */
  calendar_error: string | null;
}

export interface CalendarSourcesResponse {
  calendars: Calendar[];
  settings: CalendarSettings;
  /** Gmail accounts that have not yet granted the Calendar scope. */
  connectable: { id: string; email: string }[];
  /** Every Google account, connected for mail, calendar or both. */
  google_accounts: GoogleCalendarAccount[];
}
