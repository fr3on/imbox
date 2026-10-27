import type { AccountRow } from "../../db";
import { chunk, LOOKUP_CHUNK, logSync, now, placeholders, runBatch, uid } from "../../db";
import { insertRows } from "../../sqlRows";
import type { Env } from "../../env";
import { GmailError } from "../../google";
import type { CalendarRow } from "../types";
import {
  API,
  DAY,
  WINDOW_BACK_DAYS,
  WINDOW_FWD_DAYS,
  PAGE_LIMIT,
  BATCH_SIZE,
  HEARTBEAT_MS,
  FULL_RESYNC_MS,
  type GEvent,
  type GEventList,
  type GCalendarList,
  type RemoteCalendar,
} from "./types";
import { requireScope, remoteCalendarId, eventsUrl, calJson } from "./client";
import { mapEvent } from "./map";

/** GET users/me/calendarList. Throws GmailError; a 403 for a missing scope surfaces clearly. */
export async function listRemoteCalendars(env: Env, account: AccountRow): Promise<RemoteCalendar[]> {
  requireScope(account);
  const out: RemoteCalendar[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const u = new URL(`${API}/users/me/calendarList`);
    u.searchParams.set("maxResults", "250");
    u.searchParams.set("showHidden", "true");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const j = await calJson<GCalendarList>(env, account, u.toString());
    for (const c of j.items ?? []) {
      if (!c.id || c.deleted) continue;
      out.push({
        remote_id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        description: c.description ?? "",
        color: c.backgroundColor ?? "",
        timezone: c.timeZone ?? "",
        writable: c.accessRole === "owner" || c.accessRole === "writer",
        primary: !!c.primary,
      });
    }
    pageToken = j.nextPageToken;
    pages++;
  } while (pageToken && pages < PAGE_LIMIT);
  return out;
}

const UPSERT_TAIL = `
ON CONFLICT(calendar_id, remote_id) DO UPDATE SET
  ical_uid = excluded.ical_uid,
  title = excluded.title,
  description = excluded.description,
  location = excluded.location,
  all_day = excluded.all_day,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  timezone = excluded.timezone,
  status = excluded.status,
  busy = excluded.busy,
  organizer_email = excluded.organizer_email,
  organizer_name = excluded.organizer_name,
  attendees_json = excluded.attendees_json,
  rsvp = excluded.rsvp,
  conference_url = excluded.conference_url,
  url = excluded.url,
  reminders_json = excluded.reminders_json,
  etag = excluded.etag,
  rrule = NULL,
  master_id = NULL,
  occurrence_date = NULL,
  updated_at = excluded.updated_at`;

/** The etag we hold for each of these remote ids — what a page would rewrite if nobody looked. */
async function existingEtags(db: Db, calendarId: string, remoteIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const part of chunk(remoteIds, LOOKUP_CHUNK)) {
    const rows = await db
      .prepare(`SELECT remote_id, etag FROM events WHERE calendar_id = ? AND remote_id IN (${placeholders(part.length)})`)
      .bind(calendarId, ...part)
      .all<{ remote_id: string; etag: string | null }>();
    for (const r of rows.results) out.set(r.remote_id, r.etag);
  }
  return out;
}

const EVENT_COLUMNS = [
  "id", "user_id", "calendar_id", "remote_id", "ical_uid", "kind", "title", "description", "location", "all_day", "starts_at", "ends_at", "start_date", "end_date", "timezone", "status", "busy",
  "organizer_email", "organizer_name", "attendees_json", "rsvp", "conference_url", "url", "reminders_json", "etag", "created_at", "updated_at",
];

/** Write one page of instances: upsert the live ones, delete the cancelled ones. */
async function applyPage(env: Env, cal: CalendarRow, items: GEvent[]): Promise<{ changed: number; deleted: number }> {
  const db = env.DB;
  const ids = items.map((g) => g.id).filter((id): id is string => !!id);
  const existing = await existingEtags(db, cal.id, ids);
  const horizon = now() + WINDOW_FWD_DAYS * DAY;

  // What becomes of each instance: the last word of the page wins, as it did when each was written in turn, and a statement may not touch a row twice.
  const gone = new Set<string>();
  const live = new Map<string, ReturnType<typeof mapEvent>>();
  for (const g of items) {
    if (!g.id) continue;
    // In an incremental response a cancelled instance means the occurrence is gone. One we never
    // stored has nothing to delete.
    if (g.status === "cancelled") {
      live.delete(g.id);
      if (existing.has(g.id)) gone.add(g.id);
      continue;
    }
    // A token poll only carries what changed, but a full pull — the first sync, an expired token,
    // the periodic refresh — carries everything, and every row it carries would be rewritten along
    // with each of its indexes whether or not a byte differed. Google's etag says whether one did.
    // This is what makes a full pull affordable: an unchanged calendar costs reads, not writes.
    if (g.etag && existing.get(g.id) === g.etag) continue;
    const r = mapEvent(cal, g);
    // A token minted before the window existed keeps reporting instances years out. They are not
    // worth a row each until the calendar can reach them; the periodic refresh brings them in then.
    if (r.starts_at > horizon && !existing.has(g.id)) continue;
    gone.delete(g.id);
    live.set(g.id, r);
  }

  const rows = [...live.values()].map((r) => [
    uid(), r.user_id, r.calendar_id, r.remote_id, r.ical_uid, r.kind, r.title, r.description, r.location, r.all_day, r.starts_at, r.ends_at, r.start_date, r.end_date, r.timezone, r.status, r.busy,
    r.organizer_email, r.organizer_name, r.attendees_json, r.rsvp, r.conference_url, r.url, r.reminders_json, r.etag, r.created_at, r.updated_at,
  ]);
  const deletes = chunk([...gone], LOOKUP_CHUNK).map((part) => db.prepare(`DELETE FROM events WHERE calendar_id = ? AND remote_id IN (${placeholders(part.length)})`).bind(cal.id, ...part));
  await runBatch(db, [...deletes, ...insertRows(db, "events", EVENT_COLUMNS, rows, UPSERT_TAIL, (r) => String(r[7]).length + String(r[19]).length)], BATCH_SIZE);
  return { changed: live.size, deleted: gone.size };
}

/**
 * Walk every page of one pull and apply it as we go.
 * `syncToken` may not be combined with timeMin/timeMax/orderBy — Google rejects that outright —
 * so the two request shapes stay strictly separate.
 */
async function pull(
  env: Env,
  cal: CalendarRow,
  account: AccountRow,
  syncToken: string | null
): Promise<{ changed: number; deleted: number; nextSyncToken: string | null }> {
  let changed = 0;
  let deleted = 0;
  let nextSyncToken: string | null = null;
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const u = new URL(eventsUrl(cal));
    u.searchParams.set("singleEvents", "true");
    u.searchParams.set("maxResults", "2500");
    if (syncToken) {
      u.searchParams.set("syncToken", syncToken);
    } else {
      const t = now();
      u.searchParams.set("showDeleted", "false");
      u.searchParams.set("timeMin", new Date(t - WINDOW_BACK_DAYS * DAY).toISOString());
      u.searchParams.set("timeMax", new Date(t + WINDOW_FWD_DAYS * DAY).toISOString());
    }
    if (pageToken) u.searchParams.set("pageToken", pageToken);

    const j = await calJson<GEventList>(env, account, u.toString());
    const applied = await applyPage(env, cal, j.items ?? []);
    changed += applied.changed;
    deleted += applied.deleted;
    if (j.nextSyncToken) nextSyncToken = j.nextSyncToken;
    pageToken = j.nextPageToken;
    pages++;
  } while (pageToken && pages < PAGE_LIMIT);

  return { changed, deleted, nextSyncToken };
}

/** Pull this calendar's events into the `events` table. Incremental when `sync_token` is set. */
export async function syncGoogleCalendar(
  env: Env,
  cal: CalendarRow,
  account: AccountRow,
  opts: { allowFull?: boolean } = {}
): Promise<{ changed: number; deleted: number; full: boolean }> {
  requireScope(account);
  const db = env.DB;
  remoteCalendarId(cal);
  // A calendar with no token has to be pulled whole. One whose last full pull is a month old is
  // pulled whole only when the cron says so — it hands that out once per tick, so twenty calendars
  // coming due together do not all do it in the same minute.
  const overdue = now() - (cal.full_synced_at ?? 0) > FULL_RESYNC_MS;
  let full = !cal.sync_token || (overdue && !!opts.allowFull);

  // No 'syncing' marker on the way in: a token-based poll answers in well under a second, and the
  // cron is the only caller that runs often enough to care. Marking it would cost a row a minute
  // per calendar to describe a state nobody is ever fast enough to observe.
  try {
    let res: { changed: number; deleted: number; nextSyncToken: string | null };
    try {
      res = await pull(env, cal, account, full ? null : cal.sync_token);
    } catch (e) {
      // 410 Gone: the sync token expired. Drop it and do one full sync — once, never in a loop.
      if (cal.sync_token && e instanceof GmailError && e.status === 410) {
        await logSync(db, cal.account_id, "warn", `Calendar "${cal.name}": sync token expired, doing a full sync`);
        cal.sync_token = null;
        full = true;
        await db.prepare(`UPDATE calendars SET sync_token = NULL WHERE id = ?`).bind(cal.id).run();
        res = await pull(env, cal, account, null);
      } else {
        throw e;
      }
    }

    const t = now();
    const token = res.nextSyncToken ?? cal.sync_token;
    // Google issues a fresh sync token on every poll, but the previous one stays valid until it
    // expires — so a poll that found nothing has nothing worth persisting. Storing the new token
    // anyway, along with a timestamp, is a write per calendar per minute that changes no answer
    // this app can give. The heartbeat keeps "last synced" honest without paying that every tick.
    const quiet = res.changed === 0 && res.deleted === 0;
    const stale = t - (cal.last_synced_at ?? 0) > HEARTBEAT_MS;
    // Read the row's previous state before overwriting it: a calendar coming back from an error
    // has to be written even on a poll that found nothing, or the UI keeps showing the old failure.
    const recovering = cal.sync_status !== "idle" || !!cal.sync_error;
    cal.sync_status = "idle";
    cal.sync_error = null;
    if (!quiet || stale || recovering || full) {
      cal.sync_token = token;
      cal.last_synced_at = t;
      if (full) cal.full_synced_at = t;
      await db
        .prepare(`UPDATE calendars SET sync_token = ?, sync_status = 'idle', sync_error = NULL, last_synced_at = ?, full_synced_at = ?, updated_at = ? WHERE id = ?`)
        .bind(cal.sync_token, t, cal.full_synced_at, t, cal.id)
        .run();
    }
    return { changed: res.changed, deleted: res.deleted, full };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const t = now();
    cal.sync_status = "error";
    cal.sync_error = msg.slice(0, 1000);
    cal.last_synced_at = t;
    await db
      .prepare(`UPDATE calendars SET sync_status = 'error', sync_error = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`)
      .bind(cal.sync_error, t, t, cal.id)
      .run();
    await logSync(db, cal.account_id, "error", `Calendar sync failed for "${cal.name}": ${msg}`);
    throw e;
  }
}
