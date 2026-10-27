import type { Context } from "hono";
import type { AppEnv } from "../../env";
import type { CalendarSettingsRow } from "../../calendar/types";
import { dateKey, isValidDate } from "../../calendar/dates";
import { getSettings, type EventInput } from "../../calendar/store";
import { now } from "../../db";
import { pickZone } from "../../timezone";
import { looksInternal } from "../../input";

/* ---------- small shared helpers ---------- */

export const HEX = /^#[0-9a-fA-F]{6}$/;
export const MAX_SPAN_DAYS = 400;

export const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
export const trimmed = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const int = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
export const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
export const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

export async function body<T>(c: Context<AppEnv>): Promise<Partial<T>> {
  return (await c.req.json<T>().catch(() => ({}) as T)) as Partial<T>;
}

/** Settings + the timezone/today pair almost every handler needs. */
export async function ctx(c: Context<AppEnv>): Promise<{ userId: string; settings: CalendarSettingsRow; tz: string; today: string }> {
  const userId = c.get("user").id;
  const settings = await getSettings(c.env.DB, userId);
  // The signed-in user's row already says where their browser last was, so the zone costs no read of its own.
  const tz = pickZone(settings.timezone, c.get("user").detected_timezone);
  return { userId, settings, tz, today: dateKey(now(), tz) };
}

/**
 * The calendar store signals refusals by message: a read-only (Google-without-scope, or an ICS
 * feed) calendar is a 403, a malformed or unplaceable event is a 400, and anything left is a
 * failure talking to Google.
 */
export const BAD_REQUEST = new Set(["no_calendar", "no_account", "bad_time", "bad_range", "bad_rsvp", "bad_date"]);

export function fail(c: Context<AppEnv>, e: unknown): Response {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).slice(0, 300);
  if (msg === "read_only") return c.json({ error: "read_only" }, 403);
  if (msg === "not_found") return c.json({ error: "not_found" }, 404);
  if (BAD_REQUEST.has(msg)) return c.json({ error: msg }, 400);
  // What Google said is worth passing on; what the database said is not.
  if (looksInternal(msg)) {
    console.error("calendar route failed", e);
    return c.json({ error: "calendar_failed", message: "The calendar could not be updated." }, 500);
  }
  return c.json({ error: "calendar_failed", message: msg }, 502);
}

/* ---------- events input parsing ---------- */

export function readEventInput(b: Partial<EventInput>): EventInput {
  const input: EventInput = {};
  if (typeof b.calendar_id === "string") input.calendar_id = b.calendar_id.slice(0, 64);
  if (typeof b.kind === "string" && ["event", "birthday", "anniversary", "todo"].includes(b.kind)) input.kind = b.kind;
  if (typeof b.title === "string") input.title = b.title.trim().slice(0, 500);
  if (typeof b.description === "string") input.description = b.description.slice(0, 50_000);
  if (typeof b.location === "string") input.location = b.location.slice(0, 500);
  if (typeof b.emoji === "string") input.emoji = b.emoji.slice(0, 16);
  if (typeof b.all_day === "boolean") input.all_day = b.all_day;
  if (ms(b.starts_at) !== null) input.starts_at = ms(b.starts_at)!;
  if (ms(b.ends_at) !== null) input.ends_at = ms(b.ends_at)!;
  if (b.start_date === null || (typeof b.start_date === "string" && isValidDate(b.start_date))) input.start_date = b.start_date;
  if (b.end_date === null || (typeof b.end_date === "string" && isValidDate(b.end_date))) input.end_date = b.end_date;
  if (typeof b.timezone === "string") input.timezone = b.timezone.slice(0, 80);
  if (b.rrule === null || typeof b.rrule === "string") input.rrule = b.rrule === null ? null : String(b.rrule).slice(0, 1000);
  if (typeof b.status === "string" && ["confirmed", "tentative", "cancelled"].includes(b.status)) input.status = b.status;
  if (typeof b.busy === "boolean") input.busy = b.busy;
  if (typeof b.countdown === "boolean") input.countdown = b.countdown;
  if (typeof b.circled === "boolean") input.circled = b.circled;
  if (Array.isArray(b.attendees)) {
    input.attendees = b.attendees
      .filter((a): a is { email: string; name?: string; optional?: boolean } => !!a && typeof (a as any).email === "string")
      .slice(0, 200)
      .map((a) => ({ email: a.email.trim().slice(0, 320), name: trimmed(a.name, 200) || undefined, optional: bool(a.optional) }))
      .filter((a) => !!a.email);
  }
  if (typeof b.conference_url === "string") input.conference_url = b.conference_url.trim().slice(0, 2000);
  if (typeof b.url === "string") input.url = b.url.trim().slice(0, 2000);
  if (Array.isArray(b.reminders)) {
    input.reminders = b.reminders
      .filter((r): r is { minutes: number } => !!r && typeof (r as any).minutes === "number" && Number.isFinite((r as any).minutes))
      .slice(0, 10)
      .map((r) => ({ minutes: int(r.minutes, 0, 40320, 0) }));
  }
  if (b.thread_id === null || typeof b.thread_id === "string") input.thread_id = b.thread_id === null ? null : String(b.thread_id).slice(0, 64);
  if (b.message_id === null || typeof b.message_id === "string") input.message_id = b.message_id === null ? null : String(b.message_id).slice(0, 64);
  return input;
}

export type Scope = "this" | "following" | "all";

/** `?scope=` if it names one, else "all" for a master and "this" for one addressed occurrence. */
export function scopeFor(c: Context<AppEnv>, occurrence: string | null): Scope {
  const q = c.req.query("scope") ?? "";
  if (q === "this" || q === "following" || q === "all") return q;
  return occurrence ? "this" : "all";
}
