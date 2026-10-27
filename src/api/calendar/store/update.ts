import type { CalEvent } from "@shared/types";
import type { AccountRow } from "../../db";
import { logSync, now } from "../../db";
import type { Env } from "../../env";
import { createRemoteEvent, updateRemoteEvent } from "../google";
import type { EventRow } from "../types";
import { parseEventId } from "./ids";
import { assertWritable, fieldsFrom, occurrenceStart, shiftToOccurrence, withUntil, type EventInput } from "./input";
import { toEvent } from "./mappers";
import { ownedCalendar, ownedEvent } from "./owned";
import { googleRefusal, mirrorGoogle } from "./remote";
import { insertEvent, updateEventRow } from "./rows";
import { userTimezone } from "../../timezone";

/**
 * `scope: "this"` splits one occurrence into an override row; `"following"` closes the master with
 * UNTIL and starts a new series at the occurrence; `"all"` (the default) edits the master itself.
 * Scope only means anything for a row we expand ourselves — a plain row always takes the `"all"` path.
 */
export async function updateEvent(
  env: Env,
  userId: string,
  id: string,
  patch: EventInput,
  scope: "this" | "following" | "all" = "all"
): Promise<CalEvent> {
  const db = env.DB;
  const parsed = parseEventId(id);
  const row = await ownedEvent(db, userId, parsed.id);
  if (!row) throw new Error("not_found");
  const cal = await ownedCalendar(db, userId, row.calendar_id);
  if (!cal) throw new Error("not_found");
  assertWritable(cal);
  const tz = row.timezone || cal.timezone || (await userTimezone(db, userId));
  const occ = parsed.occurrence;

  if (row.rrule && occ && scope === "this") {
    // An override may already exist (this occurrence was edited before); patch it rather than fork again.
    const existing = await db
      .prepare(`SELECT * FROM events WHERE user_id = ? AND master_id = ? AND occurrence_date = ?`)
      .bind(userId, row.id, occ)
      .first<EventRow>();
    const seed = shiftToOccurrence(row, occ, tz);
    const f = fieldsFrom(patch, existing ?? seed, tz);
    f.rrule = null; // an override is a single instance, never a series
    if (existing) {
      const next = await updateEventRow(db, existing, f);
      await mirrorGoogle(env, cal, "update", (account) => updateRemoteEvent(env, cal, account, next));
      return toEvent(next, cal);
    }
    let fresh = await insertEvent(db, userId, cal.id, f, {
      master_id: row.id,
      occurrence_date: occ,
      ical_uid: row.ical_uid,
      organizer_email: row.organizer_email,
      organizer_name: row.organizer_name,
      rsvp: row.rsvp,
    });
    const remote = await mirrorGoogle(env, cal, "create", (account) => createRemoteEvent(env, cal, account, fresh));
    if (remote?.remote_id) {
      fresh = { ...fresh, remote_id: remote.remote_id, etag: remote.etag ?? null };
      await db.prepare(`UPDATE events SET remote_id = ?, etag = ? WHERE id = ?`).bind(fresh.remote_id, fresh.etag, fresh.id).run();
    }
    return toEvent(fresh, cal);
  }

  if (row.rrule && occ && scope === "following") {
    const occStart = occurrenceStart(row, occ, tz);
    // Close the old series just before this occurrence …
    const closed: EventRow = { ...row, rrule: withUntil(row.rrule, occStart - 1), updated_at: now() };
    await db.prepare(`UPDATE events SET rrule = ?, updated_at = ? WHERE id = ?`).bind(closed.rrule, closed.updated_at, closed.id).run();
    await mirrorGoogle(env, cal, "update", (account) => updateRemoteEvent(env, cal, account, closed));
    // … and start a fresh one here, carrying the patch and the original recurrence.
    const seed = shiftToOccurrence(row, occ, tz);
    const f = fieldsFrom(patch, seed, tz);
    if (patch.rrule === undefined) f.rrule = row.rrule;
    let fresh = await insertEvent(db, userId, cal.id, f, {
      ical_uid: row.ical_uid,
      organizer_email: row.organizer_email,
      organizer_name: row.organizer_name,
      rsvp: row.rsvp,
    });
    const remote = await mirrorGoogle(env, cal, "create", (account) => createRemoteEvent(env, cal, account, fresh));
    if (remote?.remote_id) {
      fresh = { ...fresh, remote_id: remote.remote_id, etag: remote.etag ?? null };
      await db.prepare(`UPDATE events SET remote_id = ?, etag = ? WHERE id = ?`).bind(fresh.remote_id, fresh.etag, fresh.id).run();
    }
    return toEvent(fresh, cal);
  }

  const next = await updateEventRow(db, row, fieldsFrom(patch, row, tz));

  // Google is the authority for its own events, and it does refuse things: a birthday cannot be
  // moved off its date, and some event types will not take an edit at all. Swallowing that refusal
  // would change the row here, the next sync would pull Google's unchanged copy back over it,
  // and the edit would undo itself a minute later with nothing said. Put the row back at once instead,
  // and report what Google actually objected to, so the failure lands where the change was made.
  if (cal.source === "google") {
    const account = cal.account_id ? await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(cal.account_id).first<AccountRow>() : null;
    try {
      if (!account) throw new Error("That calendar's Google account is no longer connected.");
      const r = await updateRemoteEvent(env, cal, account, next);
      await db.prepare(`UPDATE events SET etag = ? WHERE id = ?`).bind(r.etag ?? null, next.id).run();
    } catch (e) {
      await updateEventRow(db, next, fieldsFrom({}, row, tz));
      const why = googleRefusal(e);
      await logSync(db, cal.account_id, "error", `calendar update (${cal.name || cal.id}): ${(e as Error)?.message ?? String(e)}`);
      throw new Error(why);
    }
    return toEvent(next, cal);
  }

  const remote = await mirrorGoogle(env, cal, "update", (account) => updateRemoteEvent(env, cal, account, next));
  if (remote && "etag" in remote) {
    await db.prepare(`UPDATE events SET etag = ? WHERE id = ?`).bind(remote.etag ?? null, next.id).run();
    next.etag = remote.etag ?? null;
  }
  return toEvent(next, cal);
}
