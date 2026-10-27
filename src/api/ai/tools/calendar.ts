import { addDays, clockOf, dateKey, endOfDay, isValidDate, startOfDay, zonedTime } from "../../calendar/dates";
import { now, uid } from "../../db";
import type { AiEventProposal } from "@shared/types";
import { rangeFor } from "../../calendar/store";
import { userTimezone } from "../../timezone";
import { type Handler } from "./context";

export const list_events: Handler = async ({ ctx, input, db, ok, fail }) => {
  const tz = await userTimezone(db, ctx.user.id);
  const today = dateKey(now(), tz);
  const from = typeof input.from === "string" && isValidDate(input.from) ? input.from : today;
  const to = typeof input.to === "string" && isValidDate(input.to) ? input.to : addDays(from, 7);
  if (to < from) return fail("`to` date cannot be before `from` date");
  const limit = Math.min(50, Math.max(1, typeof input.limit === "number" ? input.limit : 25));

  const calRange = await rangeFor(ctx.env, ctx.user.id, from, to);

  const events = calRange.events
    .sort((a, b) => a.starts_at - b.starts_at)
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      title: e.title,
      all_day: e.all_day,
      date: e.start_date || dateKey(e.starts_at, tz),
      start_time: e.all_day ? "all-day" : clockOf(e.starts_at, tz),
      end_time: e.all_day ? "all-day" : clockOf(e.ends_at, tz),
      location: e.location || undefined,
      calendar: e.calendar_name,
      attendees: e.attendees.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
      status: e.status,
    }));

  return ok({ events, from, to, timezone: tz, total: events.length }, `Found ${events.length} event${events.length === 1 ? "" : "s"} between ${from} and ${to}`);
};

export const find_free_time: Handler = async ({ ctx, input, db, ok, fail }) => {
  const tz = await userTimezone(db, ctx.user.id);
  const fromDate = typeof input.from_date === "string" ? input.from_date : "";
  if (!isValidDate(fromDate)) return fail("Invalid from_date (expected YYYY-MM-DD)");
  const toDate = typeof input.to_date === "string" && isValidDate(input.to_date) ? input.to_date : fromDate;
  if (toDate < fromDate) return fail("`to_date` cannot be before `from_date`");
  const durMinutes = Math.min(480, Math.max(15, typeof input.duration_minutes === "number" ? input.duration_minutes : 30));
  const durMs = durMinutes * 60_000;
  const startHour = Math.min(23, Math.max(0, typeof input.start_hour === "number" ? input.start_hour : 9));
  const endHour = Math.min(24, Math.max(startHour + 1, typeof input.end_hour === "number" ? input.end_hour : 17));

  const calRange = await rangeFor(ctx.env, ctx.user.id, fromDate, toDate);
  const slot = (date: string, from: number, to: number) => ({
    date,
    start_time: clockOf(from, tz),
    end_time: clockOf(to, tz),
    duration_minutes: Math.round((to - from) / 60_000),
    starts_at: from,
    ends_at: to,
  });
  const freeSlots: ReturnType<typeof slot>[] = [];

  let cur = fromDate;
  for (let days = 0; cur <= toDate && days < 14; days++, cur = addDays(cur, 1)) {
    const dayStartMs = zonedTime(cur, startHour * 60, tz);
    const dayEndMs = zonedTime(cur, endHour * 60, tz);

    const busy: { start: number; end: number }[] = [];
    for (const e of calRange.events) {
      if (e.status === "cancelled" || e.rsvp === "declined" || !e.busy) continue;
      if (e.all_day) {
        const eDate = e.start_date || dateKey(e.starts_at, tz);
        if (cur >= eDate && cur <= (e.end_date || eDate)) busy.push({ start: dayStartMs, end: dayEndMs });
      } else if (e.ends_at > dayStartMs && e.starts_at < dayEndMs) {
        busy.push({ start: Math.max(dayStartMs, e.starts_at), end: Math.min(dayEndMs, e.ends_at) });
      }
    }

    // Walk the day's busy stretches in order, taking the gap before each one; the end of the day closes the last gap.
    busy.sort((a, b) => a.start - b.start);
    let point = dayStartMs;
    for (const b of [...busy, { start: dayEndMs, end: dayEndMs }]) {
      if (b.start - point >= durMs) freeSlots.push(slot(cur, point, b.start));
      if (b.end > point) point = b.end;
    }
  }

  return ok({ free_slots: freeSlots, timezone: tz, total: freeSlots.length }, `Found ${freeSlots.length} available slot${freeSlots.length === 1 ? "" : "s"}`);
};

export const propose_event: Handler = async ({ ctx, input, db, ok, fail }) => {
  const title = String(input.title ?? "").trim();
  if (!title) return fail("title is required");
  const dateStr = String(input.date ?? "").trim();
  if (!isValidDate(dateStr)) return fail("Invalid date (expected YYYY-MM-DD)");

  const tz = await userTimezone(db, ctx.user.id);
  const allDay = !!input.all_day;

  let startsAt: number;
  let endsAt: number;

  if (allDay) {
    startsAt = startOfDay(dateStr, tz);
    endsAt = endOfDay(dateStr, tz);
  } else {
    const clock = (v: unknown): number | null => {
      const m = typeof v === "string" ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
      return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
    };
    startsAt = zonedTime(dateStr, clock(input.start_time) ?? 9 * 60, tz);
    const endMins = clock(input.end_time);
    const dur = typeof input.duration_minutes === "number" ? input.duration_minutes : 30;
    endsAt = endMins !== null ? zonedTime(dateStr, endMins, tz) : startsAt + dur * 60_000;
  }

  const proposal: AiEventProposal = {
    id: uid(),
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    start_date: dateStr,
    end_date: dateStr,
    location: typeof input.location === "string" ? input.location.trim() : undefined,
    description: typeof input.description === "string" ? input.description.trim() : undefined,
    attendees: Array.isArray(input.attendees) ? input.attendees.map(String).filter((s) => s.includes("@")) : undefined,
    calendar_id: typeof input.calendar_id === "string" ? input.calendar_id : undefined,
  };

  ctx.emit({ type: "event_proposal", proposal });
  return ok(
    { ...proposal, note: "The event proposal card has been presented to the user to review and confirm." },
    `Proposed event “${title}” on ${dateStr}`
  );
};
