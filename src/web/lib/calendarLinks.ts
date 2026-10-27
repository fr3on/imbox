/**
 * Google offers two addresses for a calendar. The secret one (`…/private-<code>/basic.ics`) carries everything. The public one
 * (`…/public/basic.ics`) carries only what the calendar shares publicly, which for most calendars is busy times with no titles,
 * so a calendar subscribed through it fills up with "Busy". Worth saying before that happens.
 */
export function isGooglePublicCalendarLink(url: string | null | undefined): boolean {
  return /^https?:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/public\//i.test((url ?? "").trim());
}
