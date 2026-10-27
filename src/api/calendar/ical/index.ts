// A self-contained iCalendar (RFC 5545) reader, writer and recurrence expander. No dependencies:
// this runs on the worker, where the only date maths available is ../dates.
//
// Scope on purpose: VEVENT only. VTODO/VJOURNAL/VFREEBUSY are skipped, and VTIMEZONE bodies are
// ignored rather than interpreted — real feeds always carry an IANA name in TZID, and ICU knows
// those far better than a hand-rolled RRULE-of-offsets reader ever would.

export type { IcsEvent, IcsEventInput } from "./types";
export { parseIcs } from "./read";
export { expandRRule } from "./expand";
export { buildIcs } from "./write";
