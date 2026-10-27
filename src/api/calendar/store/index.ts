// The calendar's data layer: row → API mappers, the windowed range query every view is drawn from,
// and the write path that keeps the database and Google in step.
//
// Recurrence lives on a master row as an RRULE and is expanded per request window (`rangeFor`).
// A single occurrence that was edited is stored as its own row carrying `master_id` +
// `occurrence_date`; one that was deleted is a date appended to the master's `exdates`.
// Google calendars are asked for pre-expanded instances by the sync layer, so masters here are in
// practice `local` and `ics` — but nothing below assumes that.


export { parseEventId, seriesMasterId } from "./ids";
export { toCalendar, toEvent, toCalendarDay, toSettings } from "./mappers";
export { getSettings, putSettings } from "./settings";
export type { SettingsPatch } from "./settings";
export { listCalendars, ownedCalendar, ownedEvent } from "./owned";
export { rangeFor } from "./range";
export { occurrenceStart } from "./input";
export type { EventInput } from "./input";
export { createEvent, duplicateEvent } from "./create";
export { updateEvent } from "./update";
export { deleteEvent } from "./delete";
export { setRsvp, setDone } from "./answer";
export { eventIcs } from "./ics";
