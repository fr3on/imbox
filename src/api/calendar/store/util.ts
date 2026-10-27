import { isValidDate } from "../dates";

export function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function str(v: unknown, max: number, fallback: string): string {
  return v === undefined || v === null ? fallback : String(v).slice(0, max);
}

/** UTC midnight of a YYYY-MM-DD, or null when it isn't one. */
export function utcMidnight(date: string | null | undefined): number | null {
  if (!date || !isValidDate(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** ICS basic UTC stamp, `YYYYMMDDTHHMMSSZ`. */
export function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
