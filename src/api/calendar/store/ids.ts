import { isValidDate } from "../dates";

/**
 * `<row id>` or `<row id>@<YYYY-MM-DD>`. Splits on the *last* `@` and only treats the tail as an
 * occurrence when it really is a date, so an id that happens to contain `@` stays intact.
 */
export function parseEventId(id: string): { id: string; occurrence: string | null } {
  const at = id.lastIndexOf("@");
  if (at <= 0) return { id, occurrence: null };
  const tail = id.slice(at + 1);
  if (!isValidDate(tail)) return { id, occurrence: null };
  return { id: id.slice(0, at), occurrence: tail };
}

/**
 * Google is asked for `singleEvents=true`, so a repeating event arrives already expanded: one row
 * per occurrence, each with its own remote id and no RRULE of its own. Nothing in the schema then
 * says those rows belong together — which is why "delete all" used to remove exactly one Wednesday
 * and leave the other eighty-six behind.
 *
 * Two things tie a series back together. Every instance carries the same `iCalUID`
 * (`{masterId}@google.com`), and an instance's own id is `{masterId}_{YYYYMMDD}T{HHMMSS}Z`. The
 * second is what identifies a row as an instance at all; the first is what gathers its siblings.
 */
const GOOGLE_INSTANCE_ID = /_\d{8}T\d{6}Z$/;

/** The id of the repeating event this row is an occurrence of, or null if it is a one-off. */
export function seriesMasterId(remoteId: string | null | undefined): string | null {
  if (!remoteId || !GOOGLE_INSTANCE_ID.test(remoteId)) return null;
  const cut = remoteId.lastIndexOf("_");
  return cut > 0 ? remoteId.slice(0, cut) : null;
}
