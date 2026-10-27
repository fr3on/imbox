import { dateKey, keyToDate, msAt, todayKey, weekdayLabel } from "@/lib/caldate";
import { DAY_MIN } from "./time";

export type RepeatKind = "never" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

export type RepeatEnd = "never" | "until" | "count";

export const REPEAT_KINDS: Exclude<RepeatKind, "never" | "custom">[] = ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];

export const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The rule body for one of the preset cases, anchored on the event's start day. */
export function baseRule(kind: Exclude<RepeatKind, "never" | "custom">, startKey: string): string {
  const d = keyToDate(startKey);
  switch (kind) {
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${BYDAY[d.getDay()]}`;
    case "biweekly":
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${BYDAY[d.getDay()]}`;
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}`;
    default:
      return "FREQ=YEARLY";
  }
}

export function repeatLabel(kind: RepeatKind, startKey: string): string {
  switch (kind) {
    case "never":
      return "Does not repeat";
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      return `Weekly on ${weekdayLabel(startKey)}`;
    case "biweekly":
      return "Every two weeks";
    case "monthly":
      return `Monthly on the ${ordinal(keyToDate(startKey).getDate())}`;
    case "yearly":
      return "Every year";
    default:
      return "Custom…";
  }
}

/** `FREQ=DAILY;COUNT=5` → `{ FREQ: "DAILY", COUNT: "5" }`, upper-cased, `RRULE:` prefix tolerated. */
export function ruleParts(rrule: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out.set(part.slice(0, i).trim().toUpperCase(), part.slice(i + 1).trim().toUpperCase());
  }
  return out;
}

/** The rule without its ending clause — the ending lives in its own controls. */
export function stripEnd(rrule: string): string {
  return rrule
    .replace(/^RRULE:/i, "")
    .split(";")
    .filter((p) => p.trim() && !/^(UNTIL|COUNT)\s*=/i.test(p))
    .join(";");
}

/**
 * A comparable form of a rule body, so two rules that mean the same thing compare equal:
 * parts sorted, `INTERVAL=1` (the default) dropped, `BYDAY` order ignored, `WKST` ignored.
 * Without this, `FREQ=WEEKLY;BYDAY=MO;WKST=SU` from Google would never match our `FREQ=WEEKLY;BYDAY=MO`
 * and every synced weekly event would show as "Custom".
 */
export function canon(rrule: string): string {
  const m = ruleParts(stripEnd(rrule));
  m.delete("WKST");
  if (m.get("INTERVAL") === "1") m.delete("INTERVAL");
  const byday = m.get("BYDAY");
  if (byday) m.set("BYDAY", byday.split(",").map((s) => s.trim()).sort().join(","));
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}

/**
 * `UNTIL` is an instant, not a date: RFC 5545 writes it in UTC. Reading it back through the
 * local clock is what makes "ends on the 5th" still say the 5th after a round trip, because
 * that is exactly how `untilStamp` wrote it.
 */
export function untilKey(raw: string): string {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return todayKey();
  if (m[7]) return dateKey(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** The last minute of `key` in local time, as a UTC stamp: `20260905T225900Z`. */
export function untilStamp(key: string): string {
  return `${new Date(msAt(key, DAY_MIN - 1)).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

export interface RepeatState {
  repeat: RepeatKind;
  /** Only meaningful for `custom`: the rule body the user typed, ending clause removed. */
  rruleText: string;
  repeatEnd: RepeatEnd;
  until: string;
  count: number;
}

/**
 * Recognise a stored RRULE as one of the offered cases so the select shows a real label.
 * Anything we don't know falls through to "custom" with the rule intact — nothing is ever
 * silently rewritten, which matters because the round trip has to survive an edit that
 * never touches the repeat field.
 */
export function parseRepeat(rrule: string | null | undefined, startKey: string): RepeatState {
  const blank: RepeatState = { repeat: "never", rruleText: "", repeatEnd: "never", until: startKey, count: 10 };
  if (!rrule?.trim()) return blank;
  const parts = ruleParts(rrule);
  const untilRaw = parts.get("UNTIL");
  const countRaw = parts.get("COUNT");
  const ending: Pick<RepeatState, "repeatEnd" | "until" | "count"> = {
    repeatEnd: untilRaw ? "until" : countRaw ? "count" : "never",
    until: untilRaw ? untilKey(untilRaw) : startKey,
    count: countRaw ? Math.max(1, Number(countRaw) || 1) : 10,
  };
  const body = canon(rrule);
  for (const kind of REPEAT_KINDS) {
    if (canon(baseRule(kind, startKey)) === body) return { repeat: kind, rruleText: "", ...ending };
  }
  return { repeat: "custom", rruleText: stripEnd(rrule), ...ending };
}
