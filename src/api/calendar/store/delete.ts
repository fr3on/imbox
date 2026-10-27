import { chunk, inClause, LOOKUP_CHUNK, now } from "../../db";
import type { Env } from "../../env";
import { recordCaldavDelete } from "../caldav";
import { deleteRemoteEvent, updateRemoteEvent } from "../google";
import type { EventRow } from "../types";
import { parseEventId, seriesMasterId } from "./ids";
import { assertWritable, occurrenceStart, withUntil } from "./input";
import { ownedCalendar, ownedEvent } from "./owned";
import { mirrorGoogle } from "./remote";
import { userTimezone } from "../../timezone";

/** Deleting more instances than this one at a time is a mistake, not an intention. */
const SERIES_DELETE_CAP = 400;

export async function deleteEvent(env: Env, userId: string, id: string, scope: "this" | "following" | "all" = "all"): Promise<void> {
  const db = env.DB;
  const parsed = parseEventId(id);
  const row = await ownedEvent(db, userId, parsed.id);
  if (!row) return; // deleting what isn't there is a success
  const cal = await ownedCalendar(db, userId, row.calendar_id);
  if (!cal) throw new Error("not_found");
  assertWritable(cal);
  const tz = row.timezone || cal.timezone || (await userTimezone(db, userId));
  const occ = parsed.occurrence;

  if (row.rrule && occ && scope === "this") {
    // Punch a hole in the series rather than dropping it, and clear any override for that slot.
    const ex = new Set((row.exdates ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    ex.add(occ);
    const exdates = [...ex].sort().join(",");
    const next: EventRow = { ...row, exdates, updated_at: now() };
    await db.prepare(`UPDATE events SET exdates = ?, updated_at = ? WHERE id = ?`).bind(exdates, next.updated_at, row.id).run();
    await db.prepare(`DELETE FROM events WHERE user_id = ? AND master_id = ? AND occurrence_date = ?`).bind(userId, row.id, occ).run();
    await db.prepare(`DELETE FROM event_completions WHERE event_id = ? AND date = ?`).bind(row.id, occ).run();
    await mirrorGoogle(env, cal, "update", (account) => updateRemoteEvent(env, cal, account, next));
    return;
  }

  if (row.rrule && occ && scope === "following") {
    const next: EventRow = { ...row, rrule: withUntil(row.rrule, occurrenceStart(row, occ, tz) - 1), updated_at: now() };
    await db.prepare(`UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?`).bind(next.rrule, next.updated_at, row.id).run();
    await mirrorGoogle(env, cal, "update", (account) => updateRemoteEvent(env, cal, account, next));
    return;
  }

  // A Google-expanded series has no RRULE to narrow, so the reach of the delete is expressed as a
  // set of sibling rows instead: all of them, or every one from this occurrence onward.
  const master = seriesMasterId(row.remote_id);
  if (!row.rrule && master && scope !== "this") {
    const from = scope === "following" ? row.starts_at : 0;
    // iCalUID is the reliable link; the id prefix is the fallback for a row that arrived without one.
    const doomed = row.ical_uid
      ? await db
        .prepare(`SELECT id, remote_id FROM events WHERE user_id = ? AND calendar_id = ? AND ical_uid = ? AND starts_at >= ? LIMIT ?`)
        .bind(userId, row.calendar_id, row.ical_uid, from, SERIES_DELETE_CAP)
        .all<{ id: string; remote_id: string | null }>()
      : await db
        .prepare(`SELECT id, remote_id FROM events WHERE user_id = ? AND calendar_id = ? AND remote_id ILIKE ? AND starts_at >= ? LIMIT ?`)
        .bind(userId, row.calendar_id, `${master}_%`, from, SERIES_DELETE_CAP)
        .all<{ id: string; remote_id: string | null }>();
    const ids = (doomed.results ?? []).map((r) => r.id);
    for (const part of chunk(ids, LOOKUP_CHUNK)) {
      const ic = inClause(part);
      await db.batch([
        db.prepare(`DELETE FROM event_completions WHERE event_id IN ${ic.sql}`).bind(...ic.params),
        db.prepare(`DELETE FROM events WHERE user_id = ? AND id IN ${ic.sql}`).bind(userId, ...ic.params),
      ]);
    }
    await mirrorGoogle(env, cal, "delete", async (account) => {
      // Dropping the master removes the whole series in one call. "Following" has no such shortcut,
      // so each occurrence from here on is cancelled in turn — the same thing done by hand.
      if (scope === "all") return deleteRemoteEvent(env, cal, account, master);
      for (const r of doomed.results ?? []) {
        if (r.remote_id) await deleteRemoteEvent(env, cal, account, r.remote_id);
      }
    });
    return;
  }

  // A calendar kept on the mail server must be told, or the event comes straight back on the next pull.
  if (cal.source === "caldav") await recordCaldavDelete(db, cal.id, row.href ?? null);

  // Overrides and completions have no ON DELETE for master_id, so clear them by hand.
  await db.prepare(`DELETE FROM events WHERE user_id = ? AND master_id = ?`).bind(userId, row.id).run();
  await db.prepare(`DELETE FROM event_completions WHERE event_id = ?`).bind(row.id).run();
  await db.prepare(`DELETE FROM events WHERE id = ? AND user_id = ?`).bind(row.id, userId).run();
  if (row.remote_id) await mirrorGoogle(env, cal, "delete", (account) => deleteRemoteEvent(env, cal, account, row.remote_id!));
}
