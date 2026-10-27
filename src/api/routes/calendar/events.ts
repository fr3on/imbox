import type { Address, CalEvent } from "@shared/types";
import { Hono } from "hono";
import { addDays, dateKey, daysBetween, isValidDate, weekStartOf } from "../../calendar/dates";
import {
  createEvent,
  deleteEvent,
  duplicateEvent,
  eventIcs,
  ownedCalendar,
  ownedEvent,
  parseEventId,
  rangeFor,
  setDone,
  setRsvp,
  updateEvent,
  type EventInput,
} from "../../calendar/store";
import type { AccountRow, MessageRow, ThreadRow } from "../../db";
import { accountForThread, now, safeJson } from "../../db";
import type { AppEnv } from "../../env";
import { body, ctx, fail, MAX_SPAN_DAYS, readEventInput, scopeFor, trimmed } from "./input";

const events = new Hono<AppEnv>();

/* ---------- range ---------- */

// Everything needed to draw a window of days. `from`/`to` default to the current week.
events.get("/events", async (c) => {
  const { userId, settings, tz, today } = await ctx(c);
  const qFrom = c.req.query("from") ?? "";
  const qTo = c.req.query("to") ?? "";
  if ((qFrom && !isValidDate(qFrom)) || (qTo && !isValidDate(qTo))) return c.json({ error: "bad_date" }, 400);
  const week = weekStartOf(today, settings.week_start);
  const from = qFrom || (qTo ? addDays(qTo, -6) : week);
  const to = qTo || addDays(from, 6);
  const span = daysBetween(from, to);
  if (span < 0) return c.json({ error: "bad_range" }, 400);
  if (span > MAX_SPAN_DAYS) return c.json({ error: "range_too_wide" }, 400);
  return c.json(await rangeFor(c.env, userId, from, to, { all: c.req.query("all") === "1", settings, tz }));
});

// The next days as a short agenda, kept small for the browser extension's side panel: a title, a time, the calendar's colour and a join link.
// No description, location or guests. Days run in the person's own time zone, and a day with nothing on it is still listed so the panel can say so.
events.get("/agenda", async (c) => {
  const { userId, settings, tz, today } = await ctx(c);
  const days = Math.min(21, Math.max(1, Math.floor(Number(c.req.query("days"))) || 14));
  const to = addDays(today, days - 1);
  const range = await rangeFor(c.env, userId, today, to, { settings, tz });
  const byDay = new Map<string, ReturnType<typeof agendaItem>[]>();
  for (let i = 0; i < days; i++) byDay.set(addDays(today, i), []);
  for (const e of range.events) {
    if (e.kind === "todo") continue;
    const first = e.all_day ? (e.start_date ?? dateKey(e.starts_at, tz)) : dateKey(e.starts_at, tz);
    const last = e.all_day ? (e.end_date ?? first) : first;
    for (let d = first < today ? today : first; d <= last && d <= to; d = addDays(d, 1)) byDay.get(d)?.push(agendaItem(e));
  }
  return c.json({
    today,
    tz,
    days: [...byDay.entries()].map(([date, eventsList]) => ({
      date,
      events: eventsList.sort((a, b) => Number(b.all_day) - Number(a.all_day) || a.starts_at - b.starts_at).slice(0, 30),
    })),
  });
});

export function agendaItem(e: CalEvent) {
  return {
    id: e.id,
    title: e.title,
    all_day: e.all_day,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    color: e.calendar_color,
    calendar: e.calendar_name,
    tentative: e.status === "tentative" || e.rsvp === "tentative",
    join: e.conference_url,
  };
}

/* ---------- events ---------- */

events.post("/events", async (c) => {
  const userId = c.get("user").id;
  const input = readEventInput(await body<EventInput>(c));
  if (input.calendar_id) {
    const cal = await ownedCalendar(c.env.DB, userId, input.calendar_id);
    if (!cal) return c.json({ error: "not_found" }, 404);
  }
  try {
    return c.json(await createEvent(c.env, userId, input));
  } catch (e) {
    return fail(c, e);
  }
});

/**
 * Prefill for "make a meeting out of this email" — deliberately *not* saved. The client opens its
 * composer with this and the user picks a calendar and a real time.
 */
events.post("/events/from-thread", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const b = await body<{ thread_id: string }>(c);
  const threadId = trimmed(b.thread_id, 64);
  if (!threadId) return c.json({ error: "thread_id_required" }, 400);
  // Ownership rides on the account: accountForThread only resolves threads under this user.
  const acc = await accountForThread(db, user.id, threadId);
  if (!acc) return c.json({ error: "not_found" }, 404);
  const thread = await db.prepare(`SELECT * FROM threads WHERE id = ? AND account_id = ?`).bind(threadId, acc.id).first<ThreadRow>();
  if (!thread) return c.json({ error: "not_found" }, 404);
  const msg = await db.prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY date DESC LIMIT 1`).bind(threadId).first<MessageRow>();

  const mine = new Set<string>();
  const accounts = await db.prepare(`SELECT * FROM accounts WHERE user_id = ?`).bind(user.id).all<AccountRow>();
  for (const a of accounts.results) if (a.email) mine.add(a.email.toLowerCase());

  const seen = new Set<string>();
  const attendees: { email: string; name?: string }[] = [];
  const add = (p: Address | null | undefined) => {
    const email = (p?.email ?? "").trim().toLowerCase();
    if (!email || mine.has(email) || seen.has(email)) return;
    seen.add(email);
    attendees.push({ email, name: (p?.name ?? "").trim().slice(0, 200) || undefined });
  };
  if (msg) {
    add({ email: msg.from_email, name: msg.from_name });
    for (const p of safeJson<Address[]>(msg.to_json, [])) add(p);
    for (const p of safeJson<Address[]>(msg.cc_json, [])) add(p);
  }
  for (const p of safeJson<Address[]>(thread.participants_json, [])) add(p);

  // Next half-hour boundary, for an hour.
  const half = 30 * 60_000;
  const starts_at = Math.ceil(now() / half) * half;
  return c.json({
    title: (thread.custom_subject ?? thread.subject ?? "").trim().slice(0, 500),
    description: (msg?.snippet ?? thread.snippet ?? "").trim().slice(0, 2000),
    attendees: attendees.slice(0, 100),
    thread_id: thread.id,
    starts_at,
    ends_at: starts_at + 60 * 60_000,
  });
});

// One event as a downloadable .ics.
events.get("/events/:file{.+\\.ics}", async (c) => {
  const userId = c.get("user").id;
  const id = c.req.param("file").replace(/\.ics$/i, "");
  const row = await ownedEvent(c.env.DB, userId, parseEventId(id).id);
  if (!row) return c.json({ error: "not_found" }, 404);
  let ics: string;
  try {
    ics = await eventIcs(c.env, userId, id);
  } catch (e) {
    return fail(c, e);
  }
  const name = (row.title || "event").replace(/[^A-Za-z0-9 _-]+/g, " ").trim().replace(/\s+/g, "-").slice(0, 60) || "event";
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.ics"`,
      "cache-control": "no-store",
    },
  });
});

events.patch("/events/:id", async (c) => {
  const userId = c.get("user").id;
  const id = c.req.param("id");
  const parsed = parseEventId(id);
  if (!(await ownedEvent(c.env.DB, userId, parsed.id))) return c.json({ error: "not_found" }, 404);
  const patch = readEventInput(await body<EventInput>(c));
  if (patch.calendar_id && !(await ownedCalendar(c.env.DB, userId, patch.calendar_id))) return c.json({ error: "not_found" }, 404);
  try {
    return c.json(await updateEvent(c.env, userId, id, patch, scopeFor(c, parsed.occurrence)));
  } catch (e) {
    return fail(c, e);
  }
});

events.delete("/events/:id", async (c) => {
  const userId = c.get("user").id;
  const id = c.req.param("id");
  const parsed = parseEventId(id);
  if (!(await ownedEvent(c.env.DB, userId, parsed.id))) return c.json({ error: "not_found" }, 404);
  try {
    await deleteEvent(c.env, userId, id, scopeFor(c, parsed.occurrence));
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

events.post("/events/:id/duplicate", async (c) => {
  try {
    return c.json(await duplicateEvent(c.env, c.get("user").id, c.req.param("id")));
  } catch (e) {
    return fail(c, e);
  }
});

events.post("/events/:id/rsvp", async (c) => {
  const userId = c.get("user").id;
  const id = c.req.param("id");
  if (!(await ownedEvent(c.env.DB, userId, parseEventId(id).id))) return c.json({ error: "not_found" }, 404);
  const b = await body<{ rsvp: string }>(c);
  const rsvp = trimmed(b.rsvp, 20);
  if (!["needsAction", "accepted", "declined", "tentative"].includes(rsvp)) return c.json({ error: "bad_rsvp" }, 400);
  try {
    return c.json(await setRsvp(c.env, userId, id, rsvp));
  } catch (e) {
    return fail(c, e);
  }
});

events.post("/events/:id/done", async (c) => {
  const userId = c.get("user").id;
  const id = c.req.param("id");
  if (!(await ownedEvent(c.env.DB, userId, parseEventId(id).id))) return c.json({ error: "not_found" }, 404);
  const b = await body<{ done: boolean; date: string }>(c);
  const done = b.done !== false;
  const date = typeof b.date === "string" ? b.date : "";
  if (date && !isValidDate(date)) return c.json({ error: "bad_date" }, 400);
  try {
    return c.json(await setDone(c.env, userId, id, done, date || undefined));
  } catch (e) {
    return fail(c, e);
  }
});

export default events;
