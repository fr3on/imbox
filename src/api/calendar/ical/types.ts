

export interface IcsEvent {
  uid: string;
  recurrenceId: string | null; // RECURRENCE-ID as YYYY-MM-DD when present
  sequence: number;
  summary: string;
  description: string;
  location: string;
  url: string;
  allDay: boolean;
  startsAt: number; // epoch ms
  endsAt: number;
  startDate: string | null; // all-day only, YYYY-MM-DD
  endDate: string | null; // all-day only, INCLUSIVE last day (DTEND in ICS is exclusive)
  tzid: string;
  rrule: string | null; // the raw "FREQ=...;..." value
  exdates: string[]; // YYYY-MM-DD
  status: "confirmed" | "tentative" | "cancelled";
  busy: boolean; // false when TRANSP:TRANSPARENT
  organizer: { email: string; name: string } | null;
  attendees: { email: string; name: string; rsvp: string; optional: boolean }[];
  conferenceUrl: string; // from X-GOOGLE-CONFERENCE, or a meet/zoom/teams link found in DESCRIPTION/LOCATION
  reminders: number[]; // minutes before start, from VALARM TRIGGER
  lastModified: number | null;
}

/** The writable subset of {@link IcsEvent} — what buildIcs needs and nothing more. */
export interface IcsEventInput {
  uid?: string;
  summary?: string;
  description?: string;
  location?: string;
  url?: string;
  allDay?: boolean;
  startsAt?: number;
  endsAt?: number;
  startDate?: string | null;
  endDate?: string | null; // inclusive; written out as an exclusive DTEND
  tzid?: string;
  rrule?: string | null;
  organizer?: { email: string; name?: string } | null;
  attendees?: { email: string; name?: string; rsvp?: string; optional?: boolean }[];
  reminders?: number[];
  status?: "confirmed" | "tentative" | "cancelled";
  /** This event replaces one occurrence of the series with the same UID: a date (all-day) or the occurrence's original start (ms). */
  recurrenceId?: string | number;
  /** Occurrences skipped: dates for an all-day series, original starts (ms) for a timed one. */
  exdates?: (string | number)[];
}
