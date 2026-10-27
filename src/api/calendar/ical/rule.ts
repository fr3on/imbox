import { weekdayOf, zonedTime } from "../dates";
import { parseDt } from "./datetime";

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export const MAX_PERIODS = 200000;

export const MAX_STEPS = 400000;

export interface Rule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number; // 0 = unbounded
  until: number; // Infinity = unbounded
  byDay: { nth: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  wkst: number;
}

export function parseRule(raw: string, zone: string): Rule | null {
  const body = raw.trim().replace(/^RRULE:/i, "");
  if (!body) return null;
  const parts: Record<string, string> = {};
  for (const piece of body.split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    parts[piece.slice(0, eq).trim().toUpperCase()] = piece.slice(eq + 1).trim();
  }
  const freq = (parts["FREQ"] ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const ints = (key: string, lo: number, hi: number): number[] => {
    const v = parts[key];
    if (!v) return [];
    const out: number[] = [];
    for (const piece of v.split(",")) {
      const n = parseInt(piece, 10);
      if (Number.isFinite(n) && n !== 0 && Math.abs(n) >= lo && Math.abs(n) <= hi && !out.includes(n)) out.push(n);
    }
    return out;
  };

  const byDay: Rule["byDay"] = [];
  for (const piece of (parts["BYDAY"] ?? "").split(",")) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(piece.trim().toUpperCase());
    if (!m) continue;
    const nth = m[1] ? parseInt(m[1], 10) : 0;
    byDay.push({ nth, wd: WEEKDAYS[m[2]] });
  }

  let until = Infinity;
  if (parts["UNTIL"]) {
    const dv = parseDt(parts["UNTIL"], {});
    // A date-only UNTIL is inclusive of the whole day.
    if (dv) until = dv.allDay ? zonedTime(dv.date, 0, zone) + 86400000 - 1 : dv.ms;
  }

  const count = Math.max(0, parseInt(parts["COUNT"] ?? "0", 10) || 0);
  const interval = Math.max(1, Math.min(parseInt(parts["INTERVAL"] ?? "1", 10) || 1, 1000));
  const wkst = WEEKDAYS[(parts["WKST"] ?? "MO").toUpperCase()] ?? 1;

  return {
    freq,
    interval,
    count,
    until,
    byDay,
    byMonthDay: ints("BYMONTHDAY", 1, 31),
    byMonth: ints("BYMONTH", 1, 12),
    bySetPos: ints("BYSETPOS", 1, 366),
    wkst,
  };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dstr(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

export function partsOfDate(date: string): [number, number, number] {
  return [+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10)];
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** All dates in [y-m-1 .. end of month] whose weekday is `wd`, honouring an ordinal (2TU, -1FR). */
function weekdaysInMonth(y: number, m: number, wd: number, nth: number): string[] {
  const len = daysInMonth(y, m);
  const firstWd = weekdayOf(dstr(y, m, 1));
  const firstMatch = 1 + ((wd - firstWd + 7) % 7);
  const all: string[] = [];
  for (let d = firstMatch; d <= len; d += 7) all.push(dstr(y, m, d));
  if (!nth) return all;
  const idx = nth > 0 ? nth - 1 : all.length + nth;
  return idx >= 0 && idx < all.length ? [all[idx]] : [];
}

/** The same, scoped to a whole year — YEARLY;BYDAY=20MO and friends. */
export function weekdaysInYear(y: number, wd: number, nth: number): string[] {
  const all: string[] = [];
  for (let m = 1; m <= 12; m++) all.push(...weekdaysInMonth(y, m, wd, 0));
  if (!nth) return all;
  const idx = nth > 0 ? nth - 1 : all.length + nth;
  return idx >= 0 && idx < all.length ? [all[idx]] : [];
}

/** BYMONTHDAY entries resolved against a month's real length; negatives count from the end. */
export function monthDays(y: number, m: number, list: number[]): string[] {
  const len = daysInMonth(y, m);
  const out: string[] = [];
  for (const n of list) {
    const d = n > 0 ? n : len + n + 1;
    if (d >= 1 && d <= len) out.push(dstr(y, m, d));
  }
  return out;
}

/** Every candidate date a MONTHLY-style month contributes, before BYSETPOS. */
export function monthCandidates(r: Rule, y: number, m: number, seedDay: number): string[] {
  if (r.byMonth.length && !r.byMonth.includes(m)) return [];
  let days: string[];
  if (r.byMonthDay.length) {
    days = monthDays(y, m, r.byMonthDay);
    if (r.byDay.length) {
      const wds = new Set(r.byDay.map((b) => b.wd));
      days = days.filter((d) => wds.has(weekdayOf(d)));
    }
  } else if (r.byDay.length) {
    days = [];
    for (const b of r.byDay) days.push(...weekdaysInMonth(y, m, b.wd, b.nth));
  } else {
    days = seedDay <= daysInMonth(y, m) ? [dstr(y, m, seedDay)] : [];
  }
  return days;
}

export function sortUnique(list: string[]): string[] {
  return [...new Set(list)].sort();
}

export function applySetPos(list: string[], positions: number[]): string[] {
  if (!positions.length) return list;
  const out: string[] = [];
  for (const p of positions) {
    const idx = p > 0 ? p - 1 : list.length + p;
    if (idx >= 0 && idx < list.length) out.push(list[idx]);
  }
  return sortUnique(out);
}
