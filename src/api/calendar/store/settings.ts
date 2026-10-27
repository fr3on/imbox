import { now } from "../../db";
import type { CalendarSettingsRow } from "../types";
import { clampInt } from "./util";

export async function getSettings(db: Db, userId: string): Promise<CalendarSettingsRow> {
  const row = await db.prepare(`SELECT * FROM calendar_settings WHERE user_id = ?`).bind(userId).first<CalendarSettingsRow>();
  if (row) return row;
  // First touch: materialise the schema defaults so every later read is a plain SELECT. The view
  // is named explicitly because the column's own default still says 'days' — SQLite cannot alter a
  // default in place, and the week is the calendar's home.
  await db.prepare(`INSERT INTO calendar_settings (user_id, default_view, updated_at) VALUES (?, 'week', ?) ON CONFLICT DO NOTHING`).bind(userId, now()).run();
  const fresh = await db.prepare(`SELECT * FROM calendar_settings WHERE user_id = ?`).bind(userId).first<CalendarSettingsRow>();
  return (
    fresh ?? {
      user_id: userId,
      timezone: "",
      week_start: 1,
      night_start: 22,
      night_end: 6,
      collapse_night: 1,
      time_format: "12",
      default_view: "week",
      show_declined: 0,
      cover_art: 0,
      updated_at: now(),
    }
  );
}

/** Flags take a boolean from the API layer or the raw 0/1 of a row; both coerce the same way. */
export type SettingsPatch = Partial<{
  timezone: string;
  week_start: number;
  night_start: number;
  night_end: number;
  collapse_night: boolean | number;
  time_format: string;
  default_view: string;
  show_declined: boolean | number;
  cover_art: boolean | number;
}>;

export async function putSettings(db: Db, userId: string, patch: SettingsPatch): Promise<CalendarSettingsRow> {
  const cur = await getSettings(db, userId);
  const next: CalendarSettingsRow = {
    ...cur,
    timezone: patch.timezone !== undefined ? String(patch.timezone).trim().slice(0, 64) : cur.timezone,
    week_start: patch.week_start !== undefined ? clampInt(patch.week_start, 0, 6, cur.week_start) : cur.week_start,
    night_start: patch.night_start !== undefined ? clampInt(patch.night_start, 0, 23, cur.night_start) : cur.night_start,
    night_end: patch.night_end !== undefined ? clampInt(patch.night_end, 0, 23, cur.night_end) : cur.night_end,
    collapse_night: patch.collapse_night !== undefined ? (patch.collapse_night ? 1 : 0) : cur.collapse_night,
    time_format: patch.time_format !== undefined ? (String(patch.time_format) === "24" ? "24" : "12") : cur.time_format,
    default_view:
      patch.default_view !== undefined && ["days", "week", "month", "year"].includes(String(patch.default_view))
        ? String(patch.default_view)
        : cur.default_view,
    show_declined: patch.show_declined !== undefined ? (patch.show_declined ? 1 : 0) : cur.show_declined,
    cover_art: patch.cover_art !== undefined ? (patch.cover_art ? 1 : 0) : cur.cover_art,
    updated_at: now(),
  };
  await db
    .prepare(
      `UPDATE calendar_settings SET timezone = ?, week_start = ?, night_start = ?, night_end = ?, collapse_night = ?,
         time_format = ?, default_view = ?, show_declined = ?, cover_art = ?, updated_at = ? WHERE user_id = ?`
    )
    .bind(
      next.timezone,
      next.week_start,
      next.night_start,
      next.night_end,
      next.collapse_night,
      next.time_format,
      next.default_view,
      next.show_declined,
      next.cover_art,
      next.updated_at,
      userId
    )
    .run();
  return next;
}
