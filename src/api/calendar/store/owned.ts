import type { CalendarRow, EventRow } from "../types";

export async function listCalendars(db: Db, userId: string): Promise<CalendarRow[]> {
  const r = await db.prepare(`SELECT * FROM calendars WHERE user_id = ? ORDER BY position, created_at, name NULLS FIRST`).bind(userId).all<CalendarRow>();
  return r.results ?? [];
}

export async function ownedCalendar(db: Db, userId: string, id: string): Promise<CalendarRow | null> {
  return (await db.prepare(`SELECT * FROM calendars WHERE id = ? AND user_id = ?`).bind(id, userId).first<CalendarRow>()) ?? null;
}

export async function ownedEvent(db: Db, userId: string, id: string): Promise<EventRow | null> {
  return (await db.prepare(`SELECT * FROM events WHERE id = ? AND user_id = ?`).bind(id, userId).first<EventRow>()) ?? null;
}
