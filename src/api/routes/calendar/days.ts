import { Hono } from "hono";
import { isValidDate } from "../../calendar/dates";
import { toCalendarDay } from "../../calendar/store";
import type { CalendarDayRow, DayCoverRow } from "../../calendar/types";
import { now, uid } from "../../db";
import type { AppEnv } from "../../env";
import { body } from "./input";

const days = new Hono<AppEnv>();

/* ---------- days ---------- */

function emptyDay(userId: string, date: string): CalendarDayRow {
  return { user_id: userId, date, label: "", cover_url: "", journal_html: "", journal_updated_at: null, cover_id: null, cover_position: "50% 50%", updated_at: 0 };
}

async function dayRow(db: Db, userId: string, date: string): Promise<CalendarDayRow> {
  const row = await db.prepare(`SELECT * FROM calendar_days WHERE user_id = ? AND date = ?`).bind(userId, date).first<CalendarDayRow>();
  return row ?? emptyDay(userId, date);
}

days.get("/days/:date", async (c) => {
  const userId = c.get("user").id;
  const date = c.req.param("date");
  if (!isValidDate(date)) return c.json({ error: "bad_date" }, 400);
  return c.json(toCalendarDay(await dayRow(c.env.DB, userId, date)));
});

// Label and photo. Absent fields are left alone, so this doubles as a PATCH. Passing an empty
// string for `cover_url` (or null for `cover_id`) is how you take a day's photo back off.
days.put("/days/:date", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const date = c.req.param("date");
  if (!isValidDate(date)) return c.json({ error: "bad_date" }, 400);
  const b = await body<{ label: string; cover_url: string; cover_id: string | null; cover_position: string }>(c);
  const label = typeof b.label === "string" ? b.label.trim().slice(0, 200) : null;
  let cover = typeof b.cover_url === "string" ? b.cover_url.trim().slice(0, 2000) : null;
  let coverId = b.cover_id === null ? "" : typeof b.cover_id === "string" ? b.cover_id.trim().slice(0, 64) : null;
  const position = typeof b.cover_position === "string" && /^[\d.]+% [\d.]+%$/.test(b.cover_position) ? b.cover_position : null;

  const previous = (await dayRow(db, userId, date)).cover_id;

  if (coverId) {
    const own = await db.prepare(`SELECT id FROM day_covers WHERE id = ? AND user_id = ?`).bind(coverId, userId).first<{ id: string }>();
    if (!own) return c.json({ error: "not_found" }, 404);
    cover = `/api/calendar/covers/${coverId}`;
  } else if (coverId === "") {
    // Clearing the stored photo clears the URL with it, unless one was supplied in the same call.
    if (cover === null) cover = "";
  }
  // An external URL replaces any stored photo, so the two can't disagree.
  if (cover !== null && coverId === null && !cover.startsWith("/api/calendar/covers/")) coverId = "";

  await db
    .prepare(
      `INSERT INTO calendar_days (user_id, date, label, cover_url, cover_id, cover_position, journal_html, journal_updated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         label = COALESCE(?, calendar_days.label),
         cover_url = COALESCE(?, calendar_days.cover_url),
         cover_id = COALESCE(?, calendar_days.cover_id),
         cover_position = COALESCE(?, calendar_days.cover_position),
         updated_at = excluded.updated_at`
    )
    .bind(userId, date, label ?? "", cover ?? "", coverId || null, position ?? "50% 50%", now(), label, cover, coverId === "" ? null : coverId, position)
    .run();

  // A picture that no day points at any more is just dead weight.
  if (previous && previous !== coverId) {
    const still = await db.prepare(`SELECT 1 AS n FROM calendar_days WHERE user_id = ? AND cover_id = ? LIMIT 1`).bind(userId, previous).first<{ n: number }>();
    if (!still) c.executionCtx.waitUntil(db.prepare(`DELETE FROM day_covers WHERE id = ? AND user_id = ?`).bind(previous, userId).run().then(() => {}));
  }
  return c.json(toCalendarDay(await dayRow(db, userId, date)));
});

/* ---------- day photos ---------- */

export const COVER_LIMIT = 1_500_000;
export const COVER_TYPES = /^image\/(jpeg|png|webp|gif|avif)$/i;

/** A bytea column comes back as an ArrayBuffer. */
export function blobBytes(raw: unknown): Uint8Array | null {
  return raw instanceof ArrayBuffer ? new Uint8Array(raw) : null;
}

// The photo library: every picture the owner has stuck on a day, newest first, so one can be reused.
days.get("/covers", async (c) => {
  const userId = c.get("user").id;
  const rows = await c.env.DB.prepare(
    `SELECT id, mime, width, height, size, name, created_at FROM day_covers WHERE user_id = ? ORDER BY created_at DESC LIMIT 120`
  )
    .bind(userId)
    .all<DayCoverRow>();
  return c.json(
    rows.results.map((r) => ({ id: r.id, url: `/api/calendar/covers/${r.id}`, width: r.width, height: r.height, size: r.size, name: r.name, created_at: r.created_at }))
  );
});

// Raw image bytes in the body; the client downscales first, so this only has to guard the ceiling.
days.post("/covers", async (c) => {
  const userId = c.get("user").id;
  const mime = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!COVER_TYPES.test(mime)) return c.json({ error: "bad_image_type", message: "Upload a JPEG, PNG, WebP, GIF or AVIF." }, 400);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > COVER_LIMIT) return c.json({ error: "image_too_large" }, 413);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength === 0) return c.json({ error: "empty_body" }, 400);
  if (buf.byteLength > COVER_LIMIT) return c.json({ error: "image_too_large" }, 413);
  const id = uid();
  const width = Number(c.req.header("x-image-width") ?? 0) || 0;
  const height = Number(c.req.header("x-image-height") ?? 0) || 0;
  const name = (c.req.header("x-image-name") ?? "").slice(0, 120);
  await c.env.DB.prepare(`INSERT INTO day_covers (id, user_id, mime, width, height, size, name, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, userId, mime, width, height, buf.byteLength, name, buf, now())
    .run();
  return c.json({ id, url: `/api/calendar/covers/${id}`, width, height, size: buf.byteLength, name, created_at: now() });
});

days.get("/covers/:id", async (c) => {
  const userId = c.get("user").id;
  const row = await c.env.DB.prepare(`SELECT mime, data FROM day_covers WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), userId).first<{ mime: string; data: unknown }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const bytes = blobBytes(row.data);
  if (!bytes) return c.json({ error: "not_found" }, 404);
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": COVER_TYPES.test(row.mime) ? row.mime : "application/octet-stream",
      "content-length": String(bytes.byteLength),
      // The id is content-addressed by creation, so a stored photo never changes under its URL.
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
});

days.delete("/covers/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const id = c.req.param("id");
  const row = await db.prepare(`SELECT id FROM day_covers WHERE id = ? AND user_id = ?`).bind(id, userId).first<{ id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  await db.batch([
    db.prepare(`UPDATE calendar_days SET cover_id = NULL, cover_url = '' WHERE user_id = ? AND cover_id = ?`).bind(userId, id),
    db.prepare(`DELETE FROM day_covers WHERE id = ? AND user_id = ?`).bind(id, userId),
  ]);
  return c.json({ ok: true });
});

export default days;
