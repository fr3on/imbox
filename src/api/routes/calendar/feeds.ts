import { Hono } from "hono";
import { importIcs, subscribeIcs } from "../../calendar/sources";
import { listCalendars, ownedCalendar, toCalendar } from "../../calendar/store";
import type { CalendarRow } from "../../calendar/types";
import type { AppEnv } from "../../env";
import { body, HEX, trimmed } from "./input";

const feeds = new Hono<AppEnv>();

feeds.post("/sources/subscribe", async (c) => {
  const userId = c.get("user").id;
  const b = await body<{ url: string; name: string; color: string }>(c);
  const url = trimmed(b.url, 2000);
  if (!/^(https?|webcal):\/\//i.test(url)) return c.json({ error: "bad_url" }, 400);
  const name = trimmed(b.name, 120);
  const color = trimmed(b.color, 7);
  if (color && !HEX.test(color)) return c.json({ error: "bad_color" }, 400);
  try {
    const row = await subscribeIcs(c.env, userId, url, { name: name || undefined, color: color || undefined });
    return c.json(toCalendar(row));
  } catch (e) {
    // A feed that 404s or isn't iCalendar is the caller's problem, not a server fault.
    return c.json({ error: "bad_feed", message: (e instanceof Error ? e.message : String(e ?? "")).slice(0, 300) }, 400);
  }
});

// An uploaded .ics body becomes editable local events on one of the owner's calendars.
feeds.post("/sources/import", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const LIMIT = 8 * 1024 * 1024;
  if (Number(c.req.header("content-length") ?? 0) > LIMIT) return c.json({ error: "too_large" }, 413);
  // Accept either a raw `text/calendar` body or the JSON envelope the web client sends.
  const raw = await c.req.text().catch(() => "");
  if (raw.length > LIMIT) return c.json({ error: "too_large" }, 413);
  let text = raw;
  let bodyCalendarId = "";
  if (raw.trimStart().startsWith("{")) {
    try {
      const j = JSON.parse(raw) as { ics?: string; calendar_id?: string };
      if (typeof j.ics === "string") text = j.ics;
      if (typeof j.calendar_id === "string") bodyCalendarId = j.calendar_id;
    } catch {
      /* not JSON after all — treat the body as iCalendar text */
    }
  }
  if (!text.trim()) return c.json({ error: "empty_body" }, 400);

  const wanted = c.req.query("calendar_id") || bodyCalendarId;
  let target: CalendarRow | null = null;
  if (wanted) {
    target = await ownedCalendar(db, userId, wanted);
    if (!target) return c.json({ error: "not_found" }, 404);
  } else {
    const rows = await listCalendars(db, userId);
    target = rows.find((r) => r.source === "local" && r.is_default) ?? rows.find((r) => r.source === "local") ?? null;
  }
  if (!target) return c.json({ error: "no_calendar" }, 400);
  if (!target.writable) return c.json({ error: "read_only" }, 403);
  try {
    const r = await importIcs(c.env, userId, target.id, text);
    return c.json({ ok: true, imported: r.added, added: r.added, calendar: toCalendar(target) });
  } catch (e) {
    return c.json({ error: "bad_ics", message: (e instanceof Error ? e.message : String(e ?? "")).slice(0, 300) }, 400);
  }
});

export default feeds;
