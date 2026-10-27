import { addDays, dateKey, daysBetween, isValidZone, minutesOfDay, weekStartOf, weekdayOf, zonedTime } from "../dates";
import { MAX_PERIODS, MAX_STEPS, applySetPos, monthCandidates, monthDays, parseRule, partsOfDate, sortUnique, weekdaysInYear, type Rule } from "./rule";

/** The seed date taken apart once: its year, month, day, and the start of its week. */
interface Seed {
  date: string;
  y: number;
  m: number;
  d: number;
  week: string;
}

function seedOf(date: string, r: Rule): Seed {
  const [y, m, d] = partsOfDate(date);
  return { date, y, m, d, week: weekStartOf(date, r.wkst) };
}

/** The period to start from. Without COUNT nothing before the window can matter, so whole periods are skipped rather than walked one at a time. */
function firstPeriod(r: Rule, seed: Seed, startsAt: number, from: number, zone: string): number {
  if (r.count || from <= startsAt) return 0;
  const fromDate = dateKey(from, zone);
  if (!fromDate) return 0;
  const [fy, fm] = partsOfDate(fromDate);
  let skip: number;
  if (r.freq === "DAILY") skip = Math.floor(daysBetween(seed.date, fromDate) / r.interval);
  else if (r.freq === "WEEKLY") skip = Math.floor(daysBetween(seed.week, weekStartOf(fromDate, r.wkst)) / (7 * r.interval));
  else if (r.freq === "MONTHLY") skip = Math.floor(((fy - seed.y) * 12 + (fm - seed.m)) / r.interval);
  else skip = Math.floor((fy - seed.y) / r.interval);
  return Math.max(0, skip - 1); // one period of slack; cheaper than reasoning about edges
}

/** The dates one period (a day, week, month or year of the rule) contributes, before BYSETPOS. */
function periodDates(r: Rule, idx: number, seed: Seed): string[] {
  let list: string[];
  if (r.freq === "DAILY") {
    const d = addDays(seed.date, idx * r.interval);
    const [y, m] = partsOfDate(d);
    const okMonth = !r.byMonth.length || r.byMonth.includes(m);
    const okDay = !r.byDay.length || r.byDay.some((b) => b.wd === weekdayOf(d));
    const okMd = !r.byMonthDay.length || monthDays(y, m, r.byMonthDay).includes(d);
    list = okMonth && okDay && okMd ? [d] : [];
  } else if (r.freq === "WEEKLY") {
    const anchor = addDays(seed.week, idx * r.interval * 7);
    const wds = r.byDay.length ? r.byDay.map((b) => b.wd) : [weekdayOf(seed.date)];
    list = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(anchor, i);
      if (!wds.includes(weekdayOf(d))) continue;
      const [y, m] = partsOfDate(d);
      if (r.byMonth.length && !r.byMonth.includes(m)) continue;
      if (r.byMonthDay.length && !monthDays(y, m, r.byMonthDay).includes(d)) continue;
      list.push(d);
    }
  } else if (r.freq === "MONTHLY") {
    const total = seed.y * 12 + (seed.m - 1) + idx * r.interval;
    list = monthCandidates(r, Math.floor(total / 12), (total % 12) + 1, seed.d);
  } else {
    const y = seed.y + idx * r.interval;
    if (!r.byMonth.length && r.byDay.length) {
      // YEARLY;BYDAY without BYMONTH is scoped to the whole year (RFC 5545 §3.3.10).
      list = [];
      for (const b of r.byDay) list.push(...weekdaysInYear(y, b.wd, b.nth));
      if (r.byMonthDay.length) {
        list = list.filter((d) => {
          const [dy, dm] = partsOfDate(d);
          return monthDays(dy, dm, r.byMonthDay).includes(d);
        });
      }
    } else {
      const months = r.byMonth.length ? r.byMonth : [seed.m];
      list = [];
      for (const m of months) list.push(...monthCandidates(r, y, m, seed.d));
    }
  }
  return list;
}

/**
 * Expand an RRULE into occurrence start instants intersecting [from, to].
 *
 * The wall-clock time of the seed is preserved across DST: we generate the occurrence *date* with
 * pure calendar arithmetic and only then re-resolve the seed's local time-of-day on that date, so a
 * 09:00 daily meeting stays at 09:00 the morning the clocks move.
 *
 * All-day rules are anchored in UTC (matching how parseIcs stores all-day instants) so a birthday
 * never drifts a day. An unparseable rule degrades to the single seed occurrence.
 */
export function expandRRule(
  rrule: string,
  startsAt: number,
  opts: { tz: string; allDay: boolean; from: number; to: number; exdates?: string[]; limit?: number },
): number[] {
  const { from, to } = opts;
  const limit = Math.max(1, Math.min(opts.limit ?? 1000, 10000));
  const zone = opts.allDay ? "UTC" : opts.tz && isValidZone(opts.tz) ? opts.tz : "UTC";
  const bare = Number.isFinite(startsAt) && startsAt >= from && startsAt <= to ? [startsAt] : [];
  if (!Number.isFinite(startsAt) || !Number.isFinite(from) || !Number.isFinite(to) || to < from) return bare;

  const r = parseRule(rrule ?? "", zone);
  if (!r) return bare;

  const seedDate = dateKey(startsAt, zone);
  if (!seedDate) return bare;
  const minutes = opts.allDay ? 0 : minutesOfDay(startsAt, zone);
  const seed = seedOf(seedDate, r);
  const ex = new Set(opts.exdates ?? []);

  // Dates a whole day clear of the window (and of UNTIL) still consume a COUNT slot but never need
  // their exact instant — and resolving an instant is where all the Intl cost lives. A day of slack
  // keeps the shortcut safe in the zones that shift at midnight.
  const fromDate = dateKey(from, zone);
  const cheapBefore = fromDate ? addDays(fromDate, -1) : "";
  const untilDate = Number.isFinite(r.until) ? dateKey(r.until, zone) : "";
  const cheapUntil = untilDate ? addDays(untilDate, -1) : "";

  const results: number[] = [];
  let counted = 0;
  let steps = 0;
  let done = false;

  for (let idx = firstPeriod(r, seed, startsAt, from, zone); idx < MAX_PERIODS && !done; idx++) {
    if (++steps > MAX_STEPS) break;

    let list = applySetPos(sortUnique(periodDates(r, idx, seed)), r.bySetPos);
    // RFC 5545: DTSTART is always the first instance, even when the rule alone wouldn't emit it.
    if (idx === 0 && !list.includes(seedDate)) list = sortUnique([seedDate, ...list]);

    for (const d of list) {
      if (d < seedDate) continue;
      if (d < cheapBefore && (!cheapUntil || d < cheapUntil)) {
        counted++;
        if (r.count && counted >= r.count) {
          done = true;
          break;
        }
        continue;
      }
      const t = opts.allDay ? zonedTime(d, 0, "UTC") : zonedTime(d, minutes, zone);
      if (!Number.isFinite(t) || t < startsAt) continue;
      if (t > r.until) {
        done = true;
        break;
      }
      counted++;
      if (r.count && counted > r.count) {
        done = true;
        break;
      }
      if (t > to) {
        done = true;
        break;
      }
      if (t >= from && !ex.has(d)) results.push(t);
      if (results.length >= limit) {
        done = true;
        break;
      }
    }
    if (r.count && counted >= r.count) done = true;
  }

  results.sort((a, b) => a - b);
  return results;
}
