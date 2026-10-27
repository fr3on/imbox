import { isValidDate, isValidZone, zonedTime } from "../dates";

export interface DtValue {
  ms: number;
  date: string; // YYYY-MM-DD in `zone`
  allDay: boolean;
  zone: string;
}

/**
 * A DATE or DATE-TIME property value.
 *   20260115                  → all-day
 *   20260115T090000Z          → UTC
 *   TZID=America/New_York:... → a wall time in that zone, resolved through zonedTime
 *   20260115T090000           → floating. Treated as UTC: the worker has no user zone at parse time
 *                               and guessing one would silently move events between accounts.
 * An unrecognised TZID (a Windows name, a VTIMEZONE-local id) also falls back to UTC.
 */
export function parseDt(raw: string, params: Record<string, string>): DtValue | null {
  const value = raw.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || (params["VALUE"] ?? "").toUpperCase() === "DATE") {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (!isValidDate(date)) return null;
    // All-day instants are anchored to UTC midnight so the date survives any viewer's zone.
    return { ms: zonedTime(date, 0, "UTC"), date, allDay: true, zone: "UTC" };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dt) return null;
  const date = `${dt[1]}-${dt[2]}-${dt[3]}`;
  if (!isValidDate(date)) return null;
  const tzid = (params["TZID"] ?? "").trim().replace(/^\//, "");
  const zone = dt[7] ? "UTC" : tzid && isValidZone(tzid) ? tzid : "UTC";
  const minutes = +dt[4] * 60 + +dt[5];
  const ms = zonedTime(date, minutes, zone) + +dt[6] * 1000;
  if (!Number.isFinite(ms)) return null;
  return { ms, date, allDay: false, zone };
}
