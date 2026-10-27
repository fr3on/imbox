import type { CalEvent, CalendarDay, CalendarRange } from "@shared/types";
import { chunk, inClause, LOOKUP_CHUNK } from "../../db";
import type { Env } from "../../env";
import { addDays, dateKey, endOfDay, isValidDate, startOfDay } from "../dates";
import { expandRRule } from "../ical";
import type { CalendarDayRow, CalendarSettingsRow, EventRow } from "../types";
import { toCalendarDay, toEvent } from "./mappers";
import { listCalendars } from "./owned";
import { getSettings } from "./settings";
import { userTimezone } from "../../timezone";

/** Hard ceiling on expanded occurrences per request, so a decade-wide window can't blow up. */
const MAX_OCCURRENCES = 5000;

export async function rangeFor(env: Env, userId: string, from: string, to: string, opts?: { all?: boolean; settings?: CalendarSettingsRow; tz?: string }): Promise<CalendarRange> {
  const db = env.DB;
  if (!isValidDate(from) || !isValidDate(to) || to < from) throw new Error("bad_range");
  // A caller that has already read them passes them in; they are one row each, but every request asked twice.
  const settings = opts?.settings ?? (await getSettings(db, userId));
  const tz = opts?.tz ?? (await userTimezone(db, userId));

  // Widen by a day on each side: an event that starts late on the day before, or an all-day item
  // whose UTC midnight lands outside a far-from-UTC local day, still has to be drawn.
  const wFrom = addDays(from, -1);
  const wTo = addDays(to, 1);
  const windowStart = startOfDay(wFrom, tz);
  const windowEnd = endOfDay(wTo, tz);

  const allCals = await listCalendars(db, userId);
  const cals = opts?.all ? allCals : allCals.filter((c) => !!c.visible);
  const calById = new Map(cals.map((c) => [c.id, c]));
  const events: CalEvent[] = [];

  if (cals.length) {
    const ic = inClause(cals.map((c) => c.id));
    // Cancelled never draws; declined only when the user asked to see it.
    const hide = `AND status <> 'cancelled'${settings.show_declined ? "" : " AND rsvp <> 'declined'"}`;

    // 1. Plain rows overlapping the window. Per-occurrence override rows (master_id set, rrule null)
    //    come through here too, which is exactly where they belong.
    const plain = await db
      .prepare(
        `SELECT * FROM events WHERE user_id = ? AND calendar_id IN ${ic.sql} AND rrule IS NULL
           AND starts_at <= ? AND ends_at >= ? ${hide}`
      )
      .bind(userId, ...ic.params, windowEnd, windowStart)
      .all<EventRow>();

    // 2. Recurring masters that could reach into the window. There is no upper bound on a series,
    //    so anything that started by the end of the window is a candidate.
    const masters = await db
      .prepare(`SELECT * FROM events WHERE user_id = ? AND calendar_id IN ${ic.sql} AND rrule IS NOT NULL AND starts_at <= ? ${hide}`)
      .bind(userId, ...ic.params, windowEnd)
      .all<EventRow>();

    const masterRows = masters.results ?? [];
    const masterIds = masterRows.map((m) => m.id);

    // Occurrences replaced by an override row, and completions for repeating todos. Overrides are
    // loaded regardless of the window: one that was *moved* out of it still suppresses its slot.
    const overridden = new Set<string>();
    const completed = new Set<string>();
    for (const part of chunk(masterIds, LOOKUP_CHUNK)) {
      const oc = inClause(part);
      const ov = await db
        // No `user_id = ?` here on purpose: the masters are the user's own rows, so the filter adds
        // nothing — and its presence made SQLite walk every event of the user's on the user_id index
        // instead of probing the partial master_id index it was written for.
        .prepare(`SELECT master_id, occurrence_date FROM events WHERE master_id IN ${oc.sql} AND occurrence_date IS NOT NULL`)
        .bind(...oc.params)
        .all<{ master_id: string; occurrence_date: string }>();
      for (const o of ov.results ?? []) overridden.add(`${o.master_id}|${o.occurrence_date}`);
      const cp = await db
        .prepare(`SELECT event_id, date FROM event_completions WHERE event_id IN ${oc.sql} AND date >= ? AND date <= ?`)
        .bind(...oc.params, wFrom, wTo)
        .all<{ event_id: string; date: string }>();
      for (const c of cp.results ?? []) completed.add(`${c.event_id}|${c.date}`);
    }

    for (const r of plain.results ?? []) {
      const cal = calById.get(r.calendar_id);
      if (cal) events.push(toEvent(r, cal));
    }

    let budget = MAX_OCCURRENCES;
    for (const m of masterRows) {
      if (budget <= 0) break;
      const cal = calById.get(m.calendar_id);
      if (!cal || !m.rrule) continue;
      const dur = Math.max(0, m.ends_at - m.starts_at);
      const ex = (m.exdates ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      // All-day series are anchored to UTC midnights, so their instance dates key off UTC.
      const keyTz = m.all_day ? "UTC" : tz;
      let starts: number[] = [];
      try {
        // Start the scan a duration early so a long occurrence that began before the window still lands.
        starts = expandRRule(m.rrule, m.starts_at, { tz: m.timezone || tz, allDay: !!m.all_day, from: windowStart - dur, to: windowEnd, exdates: ex, limit: budget });
      } catch {
        continue; // A malformed RRULE drops that series, never the whole request.
      }
      for (const s of starts) {
        if (budget <= 0) break;
        const date = dateKey(s, keyTz);
        if (ex.includes(date)) continue;
        if (overridden.has(`${m.id}|${date}`)) continue;
        budget--;
        events.push(toEvent(m, cal, { date, startsAt: s, endsAt: s + dur, done: completed.has(`${m.id}|${date}`) }));
      }
    }
  }

  // All-day items head their day; everything else is chronological.
  const dayOf = (e: CalEvent) => dateKey(e.starts_at, e.all_day ? "UTC" : tz);
  events.sort((a, b) => {
    const da = dayOf(a);
    const dbk = dayOf(b);
    if (da !== dbk) return da < dbk ? -1 : 1;
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
    if (a.starts_at !== b.starts_at) return a.starts_at - b.starts_at;
    return a.title.localeCompare(b.title);
  });

  const days = await loadDays(db, userId, from, to);

  return { from, to, events, days };
}

async function loadDays(db: Db, userId: string, from: string, to: string): Promise<CalendarDay[]> {
  const r = await db
    .prepare(`SELECT * FROM calendar_days WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`)
    .bind(userId, from, to)
    .all<CalendarDayRow>();
  return (r.results ?? []).map(toCalendarDay);
}
