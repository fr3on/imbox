// Where calendars come from: the Google list mirrored per account, subscribed .ics/webcal feeds,
// uploaded .ics files, and inbox's own local calendars. Google events are fetched by ./google;
// this module owns the `calendars` rows, the ICS fetch (and its SSRF guard) and the ICS → events write.

import { muteHex } from "@shared/color";
import { fetchTimeout, TIMEOUT } from "../http";
import { VERSION } from "@shared/buildInfo";
import type { AccountRow, UserRow } from "../db";
import { chunk, LOOKUP_CHUNK, logSync, now, placeholders, runBatch, uid } from "../db";
import { insertRows, updateRows } from "../sqlRows";
import type { Env } from "../env";
import { hasCalendarScope } from "../google";
import { isPrivateHost } from "../netguard";
import { syncCaldavCalendar } from "./caldav";
import { dateKey } from "./dates";
import { listRemoteCalendars, syncGoogleCalendar } from "./google";
import { parseIcs, type IcsEvent } from "./ical";
import { MAILBOX_REMOTE_ID } from "./mailbox";
import type { CalendarRow } from "./types";

/** A feed bigger than this is somebody's mistake, not a calendar. */
const MAX_ICS_BYTES = 8 * 1024 * 1024;
/** An uploaded .ics can be a decade of history; past this we stop rather than melt the CPU budget. */
const MAX_IMPORT_EVENTS = 5000;
/** An event row binds about 35 parameters, so a batch of this many statements keeps one transaction a sensible size. */
export const BATCH_SIZE = 50;
const USER_AGENT = `inbox/${VERSION} (calendar feed sync)`;

// ---------- URL safety ----------

/**
 * Normalise a user-supplied feed URL and refuse anything that would let the API fetch something
 * private on our behalf. `webcal://` is just `https://` with a nicer icon.
 */
export function safeFeedUrl(input: string): string {
  const raw = (input ?? "").trim();
  if (!raw) throw new Error("A calendar URL is required");
  const swapped = raw.replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(swapped);
  } catch {
    throw new Error("That does not look like a calendar URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) and webcal calendar URLs can be subscribed to");
  if (isPrivateHost(u.hostname)) throw new Error("That host is not reachable from inbox");
  return u.toString();
}

/** Read a response body, giving up as soon as it goes over `max` bytes. */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error("That feed is too large (over 8 MB)");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => { });
      throw new Error("That feed is too large (over 8 MB)");
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

interface FeedResponse {
  /** 304 means the feed is unchanged and `text` is empty. */
  status: number;
  text: string;
  etag: string | null;
}

/**
 * Fetch an ICS feed. Redirects are followed by hand so every hop goes back through the SSRF guard —
 * a public URL that 302s to 169.254.169.254 is the whole point of the attack.
 */
async function fetchFeed(url: string, etag?: string | null): Promise<FeedResponse> {
  let target = safeFeedUrl(url);
  for (let hop = 0; hop < 4; hop++) {
    const headers: Record<string, string> = {
      accept: "text/calendar, text/plain;q=0.8, */*;q=0.5",
      "user-agent": USER_AGENT,
    };
    if (etag) headers["if-none-match"] = etag;
    const res = await fetchTimeout(target, { headers, redirect: "manual" }, TIMEOUT.feed);
    if (res.status === 304) return { status: 304, text: "", etag: etag ?? null };
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`That feed redirected without a Location header (${res.status})`);
      target = safeFeedUrl(new URL(loc, target).toString());
      continue;
    }
    if (!res.ok) throw new Error(`That feed returned ${res.status}`);
    const text = await readCapped(res, MAX_ICS_BYTES);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That URL did not return an iCalendar feed");
    return { status: res.status, text, etag: res.headers.get("etag") };
  }
  throw new Error("That feed redirected too many times");
}

// ---------- Google calendar list ----------

async function nextPosition(db: Db, userId: string): Promise<number> {
  const r = await db.prepare(`SELECT COALESCE(MAX(position), -1) AS p FROM calendars WHERE user_id = ?`).bind(userId).first<{ p: number }>();
  return (r?.p ?? -1) + 1;
}

async function mirrorGoogleCalendars(env: Env, userId: string, account: AccountRow): Promise<void> {
  const db = env.DB;
  const remote = await listRemoteCalendars(env, account);
  const existing = await db
    .prepare(`SELECT id, remote_id, color FROM calendars WHERE user_id = ? AND account_id = ? AND source = 'google'`)
    .bind(userId, account.id)
    .all<{ id: string; remote_id: string | null; color: string }>();
  // Deliberately removed from the settings page: not Google's list to resurrect on the next pass.
  const removed = new Set(
    (await db.prepare(`SELECT remote_id FROM removed_calendars WHERE account_id = ?`).bind(account.id).all<{ remote_id: string }>()).results.map((r) => r.remote_id)
  );
  const seen = new Set(remote.map((r) => r.remote_id));
  // The same shared calendar — a holidays feed, a team's calendar — reaches the user through every
  // account it is shared with, and would land once per account: five copies of every holiday,
  // five polls a minute, five rows written for every change. A copy that already exists under
  // another account arrives hidden. Hidden calendars poll every six hours and draw nothing;
  // the user can still turn one on if that is the copy they want.
  const mine = new Set(existing.results.map((r) => r.remote_id));
  const elsewhere = new Set(
    (await db.prepare(`SELECT remote_id FROM calendars WHERE user_id = ? AND source = 'google' AND account_id <> ?`).bind(userId, account.id).all<{ remote_id: string }>()).results.map(
      (r) => r.remote_id
    )
  );
  const t = now();
  let position = await nextPosition(db, userId);
  const stmts: DbStatement[] = [];
  for (const rc of remote) {
    if (!rc.remote_id || removed.has(rc.remote_id)) continue;
    const visible = mine.has(rc.remote_id) || !elsewhere.has(rc.remote_id) ? 1 : 0;
    stmts.push(
      db
        .prepare(
          // Only the columns Google owns are refreshed: name, colour and visibility are the user's
          // once inbox has them, so they are filled in on insert and never overwritten after.
          `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, created_at, updated_at)
           VALUES (?, ?, ?, 'google', ?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
           ON CONFLICT(account_id, remote_id) DO UPDATE SET
             description = excluded.description,
             timezone = excluded.timezone,
             writable = excluded.writable,
             updated_at = excluded.updated_at`
        )
        .bind(
          uid(),
          userId,
          account.id,
          rc.remote_id,
          rc.name || account.email,
          rc.description ?? "",
          muteHex(rc.color) ?? "#3d3d3d",
          rc.timezone ?? "",
          visible,
          rc.writable ? 1 : 0,
          position++,
          t,
          t
        )
    );
  }
  await runBatch(db, stmts, BATCH_SIZE);

  // Google's palette is built for pale chips with dark text; inbox fills the whole block. Any
  // calendar still carrying the raw colour Google sent is one the owner has not chosen for
  // themselves, so quiet it down. A colour they picked never matches the remote one and is left be.
  const quieted = existing.results.flatMap((row) => {
    const rc = remote.find((r) => r.remote_id === row.remote_id);
    const muted = muteHex(rc?.color);
    if (!rc || !muted || row.color === muted) return [];
    if (row.color.toLowerCase() !== (rc.color ?? "").toLowerCase()) return [];
    return [[row.id, muted, t]];
  });
  await runBatch(db, updateRows(db, "calendars", ["id", "color", "updated_at"], ["TEXT", "TEXT", "BIGINT"], quieted), BATCH_SIZE);

  // Unsubscribed or deleted on Google's side: drop it here too, events and all.
  for (const row of existing.results) {
    if (row.remote_id && seen.has(row.remote_id)) continue;
    await deleteCalendar(db, row.id);
  }
}

/**
 * Called after a Google account connects (or reconnects with the Calendar scope): mirror its
 * calendar list into `calendars`, and make sure the user has at least one writable local calendar.
 * Safe to call as often as you like.
 */
export async function ensureDefaultCalendars(env: Env, userId: string, account?: AccountRow): Promise<void> {
  const db = env.DB;
  if (account && hasCalendarScope(account.scopes)) {
    try {
      await mirrorGoogleCalendars(env, userId, account);
      await db.prepare(`UPDATE accounts SET calendar_error = NULL WHERE id = ?`).bind(account.id).run();
    } catch (e) {
      // A failed calendar list must not break connecting the account; the cron will try again.
      // It is recorded on the account as well as the log, because with no calendar rows there is
      // nowhere else for the UI to read it from — and "no calendars" with no reason is a dead end.
      const message = ((e as Error).message ?? String(e)).slice(0, 500);
      await logSync(db, account.id, "warn", `Calendar list failed: ${message}`);
      await db.prepare(`UPDATE accounts SET calendar_error = ? WHERE id = ?`).bind(message, account.id).run();
    }
  }

  const local = await db.prepare(`SELECT id FROM calendars WHERE user_id = ? AND source = 'local' LIMIT 1`).bind(userId).first<{ id: string }>();
  if (local) return;
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<UserRow>();
  const name = (user?.name ?? "").trim() || "Personal";
  const t = now();
  await db
    .prepare(
      `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, created_at, updated_at)
       VALUES (?, ?, NULL, 'local', NULL, NULL, ?, '', '#111111', '', 1, 1, 1, ?, ?, ?)`
    )
    .bind(uid(), userId, name, await nextPosition(db, userId), t, t)
    .run();
}

// ---------- ICS → events ----------

/** The stable per-calendar key for an ICS event: its UID, plus RECURRENCE-ID for a single overridden occurrence. */
export function icsRemoteId(ev: IcsEvent): string {
  return ev.recurrenceId ? `${ev.uid}::${ev.recurrenceId}` : ev.uid;
}

/** ICS dates arrive as `20260104`, `2026-01-04` or `20260104T090000Z`; we store YYYY-MM-DD in the calendar's zone. */
export function icsDateKey(value: string, tz: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (/Z$/i.test(v)) {
    const ms = Date.parse(v.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i, "$1-$2-$3T$4:$5:$6Z"));
    if (Number.isFinite(ms)) return dateKey(ms, tz || "UTC");
  }
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function remindersJson(minutes: number[]): string {
  return JSON.stringify((minutes ?? []).map((m) => ({ minutes: m })));
}

export interface PreparedEvent {
  ev: IcsEvent;
  remoteId: string | null;
  id: string;
  masterId: string | null;
  occurrenceDate: string | null;
}

/**
 * Give every parsed event a row id and, for a RECURRENCE-ID override, wire it to the master row it
 * replaces. Recurrence itself is left alone: the master keeps its RRULE and EXDATEs and inbox
 * expands it per request window.
 */
export function prepareEvents(events: IcsEvent[], cal: { timezone: string }, existing: Map<string, string>, keyed: boolean): PreparedEvent[] {
  const out: PreparedEvent[] = [];
  const masters = new Map<string, string>();
  // (calendar_id, remote_id) is unique, so a feed that repeats a UID gets its last copy, not a failed batch.
  const taken = new Set<string>();
  for (const ev of events) {
    if (ev.recurrenceId) continue;
    const remoteId = keyed ? icsRemoteId(ev) : null;
    if (remoteId && taken.has(remoteId)) continue;
    if (remoteId) taken.add(remoteId);
    const id = (remoteId && existing.get(remoteId)) || uid();
    masters.set(ev.uid, id);
    out.push({ ev, remoteId, id, masterId: null, occurrenceDate: null });
  }
  for (const ev of events) {
    if (!ev.recurrenceId) continue;
    const remoteId = keyed ? icsRemoteId(ev) : null;
    if (remoteId && taken.has(remoteId)) continue;
    if (remoteId) taken.add(remoteId);
    const id = (remoteId && existing.get(remoteId)) || uid();
    const tz = ev.tzid || cal.timezone || "UTC";
    out.push({
      ev,
      remoteId,
      id,
      masterId: masters.get(ev.uid) ?? null,
      occurrenceDate: icsDateKey(ev.recurrenceId, tz) || null,
    });
  }
  return out;
}

const EVENT_COLUMNS = [
  "id", "user_id", "calendar_id", "remote_id", "ical_uid", "kind", "title", "description", "location", "emoji", "all_day", "starts_at", "ends_at", "start_date", "end_date", "timezone", "rrule",
  "exdates", "master_id", "occurrence_date", "status", "busy", "countdown", "circled", "organizer_email", "organizer_name", "attendees_json", "rsvp", "conference_url", "url", "reminders_json",
  "etag", "created_at", "updated_at",
];
/** What a feed changes of an event it already holds: `circled`, `countdown`, `emoji` and `done_at` are inbox's, not the feed's, and are left untouched. */
const EVENT_UPDATE_COLUMNS = [
  "id", "ical_uid", "title", "description", "location", "all_day", "starts_at", "ends_at", "start_date", "end_date", "timezone", "rrule", "exdates", "master_id", "occurrence_date", "status", "busy",
  "organizer_email", "organizer_name", "attendees_json", "conference_url", "url", "reminders_json", "etag", "updated_at",
];
const EVENT_UPDATE_TYPES = [
  "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "BIGINT", "BIGINT", "BIGINT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "BIGINT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT", "TEXT",
  "BIGINT",
];

/** The fields of an event as a feed gives it, in the order of `EVENT_UPDATE_COLUMNS` after the id. */
function feedFields(cal: CalendarRow, p: PreparedEvent) {
  const ev = p.ev;
  return {
    uid: ev.uid,
    title: ev.summary ?? "",
    description: ev.description ?? "",
    location: ev.location ?? "",
    allDay: ev.allDay ? 1 : 0,
    timezone: ev.tzid || cal.timezone || "",
    exdates: (ev.exdates ?? []).map((d: string) => icsDateKey(d, ev.tzid || cal.timezone || "UTC")).filter(Boolean).join(","),
    status: ev.status ?? "confirmed",
    busy: ev.busy ? 1 : 0,
    organizerEmail: ev.organizer?.email ?? "",
    organizerName: ev.organizer?.name ?? "",
    attendees: JSON.stringify(ev.attendees ?? []),
    conferenceUrl: ev.conferenceUrl ?? "",
    url: ev.url ?? "",
    reminders: remindersJson(ev.reminders),
    etag: ev.lastModified ? String(ev.lastModified) : null,
  };
}

/** New events, many to a statement. */
export function insertEventStmts(db: Db, cal: CalendarRow, prepared: PreparedEvent[], t: number): DbStatement[] {
  const rows = prepared.map((p) => {
    const ev = p.ev;
    const f = feedFields(cal, p);
    return [
      p.id, cal.user_id, cal.id, p.remoteId, f.uid, "event", f.title, f.description, f.location, "", f.allDay, ev.startsAt, ev.endsAt, ev.startDate, ev.endDate, f.timezone, ev.rrule, f.exdates,
      p.masterId, p.occurrenceDate, f.status, f.busy, 0, 0, f.organizerEmail, f.organizerName, f.attendees, "", f.conferenceUrl, f.url, f.reminders, f.etag, t, t,
    ];
  });
  return insertRows(db, "events", EVENT_COLUMNS, rows, "", (r) => String(r[7]).length + String(r[26]).length);
}

/** Events the calendar already holds, changed to what the feed says now, many to a statement. */
export function updateEventStmts(db: Db, cal: CalendarRow, prepared: PreparedEvent[], t: number): DbStatement[] {
  const rows = prepared.map((p) => {
    const ev = p.ev;
    const f = feedFields(cal, p);
    return [
      p.id, f.uid, f.title, f.description, f.location, f.allDay, ev.startsAt, ev.endsAt, ev.startDate, ev.endDate, f.timezone, ev.rrule, f.exdates, p.masterId, p.occurrenceDate, f.status, f.busy,
      f.organizerEmail, f.organizerName, f.attendees, f.conferenceUrl, f.url, f.reminders, f.etag, t,
    ];
  });
  return updateRows(db, "events", EVENT_UPDATE_COLUMNS, EVENT_UPDATE_TYPES, rows);
}

/** Delete these events and their completions, in pieces of `LOOKUP_CHUNK`. */
export function deleteEventStmts(db: Db, ids: string[]): DbStatement[] {
  return chunk(ids, LOOKUP_CHUNK).flatMap((part) => [
    db.prepare(`DELETE FROM event_completions WHERE event_id IN (${placeholders(part.length)})`).bind(...part),
    db.prepare(`DELETE FROM events WHERE id IN (${placeholders(part.length)})`).bind(...part),
  ]);
}

/** A subscribed feed is the truth: whatever it no longer lists is gone from that calendar. */
async function replaceIcsEvents(env: Env, cal: CalendarRow, events: IcsEvent[]): Promise<number> {
  const db = env.DB;
  const rows = await db
    .prepare(`SELECT id, remote_id FROM events WHERE calendar_id = ?`)
    .bind(cal.id)
    .all<{ id: string; remote_id: string | null }>();
  const existing = new Map<string, string>();
  for (const r of rows.results) if (r.remote_id) existing.set(r.remote_id, r.id);

  const prepared = prepareEvents(events, cal, existing, true).filter((p) => p.remoteId);
  const t = now();
  const kept = new Set(prepared.map((p) => p.remoteId!));
  const stale = [...existing.entries()].filter(([remoteId]) => !kept.has(remoteId)).map(([, id]) => id);
  // New events first, so an override row's master is there when it is written; then the changed ones; then what the feed no longer lists. One transaction.
  await runBatch(
    db,
    [
      ...insertEventStmts(db, cal, prepared.filter((p) => !existing.has(p.remoteId!)), t),
      ...updateEventStmts(db, cal, prepared.filter((p) => existing.has(p.remoteId!)), t),
      ...deleteEventStmts(db, stale),
    ],
    BATCH_SIZE
  );
  return prepared.length + stale.length;
}

/**
 * Add or update these events in a calendar and leave everything else in it alone (unlike
 * `replaceIcsEvents`, which treats the file as the whole truth). Used for invitations, where one
 * message speaks for one meeting. `link` ties the events back to the email they came from.
 */
export async function upsertIcsEvents(env: Env, cal: CalendarRow, events: IcsEvent[], link: { threadId?: string; messageId?: string } = {}): Promise<number> {
  const db = env.DB;
  const rows = await db.prepare(`SELECT id, remote_id FROM events WHERE calendar_id = ?`).bind(cal.id).all<{ id: string; remote_id: string | null }>();
  const existing = new Map<string, string>();
  for (const r of rows.results) if (r.remote_id) existing.set(r.remote_id, r.id);
  const prepared = prepareEvents(events.slice(0, 200), cal, existing, true).filter((p) => p.remoteId);
  const t = now();
  const stmts = [...insertEventStmts(db, cal, prepared.filter((p) => !existing.has(p.remoteId!)), t), ...updateEventStmts(db, cal, prepared.filter((p) => existing.has(p.remoteId!)), t)];
  if (link.threadId && prepared.length) {
    const ids = prepared.map((p) => p.id);
    stmts.push(db.prepare(`UPDATE events SET thread_id = ?, message_id = ? WHERE id IN (${placeholders(ids.length)})`).bind(link.threadId, link.messageId ?? null, ...ids));
  }
  await runBatch(db, stmts, BATCH_SIZE);
  return prepared.length;
}

// ---------- Public API ----------

/** Subscribe to an .ics / webcal:// feed. Fetches once so a bad URL fails loudly at subscribe time. */
export async function subscribeIcs(env: Env, userId: string, url: string, opts?: { name?: string; color?: string }): Promise<CalendarRow> {
  const db = env.DB;
  const feedUrl = safeFeedUrl(url);
  const res = await fetchFeed(feedUrl);
  const parsed = parseIcs(res.text);

  const t = now();
  const id = uid();
  const name = (opts?.name ?? "").trim() || parsed.name.trim() || new URL(feedUrl).hostname;
  const color = (opts?.color ?? "").trim() || parsed.color || "#111111";
  await db
    .prepare(
      `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, etag, last_synced_at, sync_status, created_at, updated_at)
       VALUES (?, ?, NULL, 'ics', NULL, ?, ?, '', ?, ?, 1, 0, 0, ?, ?, ?, 'idle', ?, ?)`
    )
    .bind(id, userId, feedUrl, name.slice(0, 200), color, parsed.timezone ?? "", await nextPosition(db, userId), res.etag, t, t, t)
    .run();

  const cal = (await db.prepare(`SELECT * FROM calendars WHERE id = ?`).bind(id).first<CalendarRow>())!;
  try {
    await replaceIcsEvents(env, cal, parsed.events);
  } catch (e) {
    // Subscribing is all or nothing: leave no half-written calendar behind.
    await logSync(db, null, "error", `ICS subscribe "${name}" failed: ${(e as Error).message ?? String(e)}`);
    await deleteCalendar(db, id);
    throw e;
  }
  return { ...cal, sync_status: "idle" };
}

/** Re-fetch a subscribed feed and replace its events. A 304 costs us nothing. */
export async function refreshIcsCalendar(env: Env, cal: CalendarRow): Promise<{ changed: number }> {
  const db = env.DB;
  if (!cal.url) throw new Error("That calendar has no feed URL");
  await db.prepare(`UPDATE calendars SET sync_status = 'syncing', updated_at = ? WHERE id = ?`).bind(now(), cal.id).run();
  try {
    const res = await fetchFeed(cal.url, cal.etag);
    if (res.status === 304) {
      await db.prepare(`UPDATE calendars SET sync_status = 'idle', sync_error = NULL, last_synced_at = ?, updated_at = ? WHERE id = ?`).bind(now(), now(), cal.id).run();
      return { changed: 0 };
    }
    const parsed = parseIcs(res.text);
    const changed = await replaceIcsEvents(env, cal, parsed.events);
    const t = now();
    await db
      .prepare(`UPDATE calendars SET sync_status = 'idle', sync_error = NULL, etag = ?, timezone = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`)
      .bind(res.etag, parsed.timezone || cal.timezone, t, t, cal.id)
      .run();
    return { changed };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const t = now();
    // The last good events stay put; the calendar just wears its error until the next run.
    await db.prepare(`UPDATE calendars SET sync_status = 'error', sync_error = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`).bind(msg.slice(0, 1000), t, t, cal.id).run();
    await logSync(db, cal.account_id, "error", `ICS sync failed for "${cal.name}": ${msg}`);
    throw e;
  }
}

/** Import an uploaded .ics body into a writable calendar; the events become ordinary editable rows. */
export async function importIcs(env: Env, userId: string, calendarId: string, text: string): Promise<{ added: number }> {
  const db = env.DB;
  const cal = await db.prepare(`SELECT * FROM calendars WHERE id = ? AND user_id = ?`).bind(calendarId, userId).first<CalendarRow>();
  if (!cal) throw new Error("Calendar not found");
  if (!cal.writable) throw new Error("That calendar is read-only");
  if (!/BEGIN:VCALENDAR/i.test(text ?? "")) throw new Error("That file is not an iCalendar (.ics) file");

  const parsed = parseIcs(text);
  const events = parsed.events.slice(0, MAX_IMPORT_EVENTS);
  if (!events.length) return { added: 0 };
  // Fresh ids and no remote_id: imported events belong to the user now, not to the file.
  const prepared = prepareEvents(events, cal, new Map(), false);
  const t = now();
  await runBatch(db, insertEventStmts(db, cal, prepared, t), BATCH_SIZE);
  await logSync(db, cal.account_id, "info", `Imported ${prepared.length} events into "${cal.name}"`);
  return { added: prepared.length };
}

/** Sync one calendar of any source. A `local` calendar is a no-op. */
export async function syncCalendarNow(env: Env, cal: CalendarRow, opts: { allowFull?: boolean } = {}): Promise<{ changed: number; full?: boolean }> {
  const db = env.DB;
  if (cal.source === "local") return { changed: 0 };
  if (cal.source === "ics") return refreshIcsCalendar(env, cal);
  if (cal.source === "caldav") return syncCaldavCalendar(env, cal);

  const account = cal.account_id ? await db.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(cal.account_id).first<AccountRow>() : null;
  if (!account) throw new Error("That calendar's account is gone");
  // Nothing to do until the account is reconnected — not an error worth showing.
  if (account.sync_status === "disconnected" || !account.refresh_token || !hasCalendarScope(account.scopes)) return { changed: 0 };

  // syncGoogleCalendar owns every status transition on the row — 'syncing' going in, and 'idle' or
  // 'error' coming out. Writing them here as well doubled the cost of a sync that found nothing.
  try {
    const r = await syncGoogleCalendar(env, cal, account, opts);
    return { changed: r.changed + r.deleted, full: r.full };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await logSync(db, cal.account_id, "error", `Calendar sync failed for "${cal.name}": ${msg}`);
    throw e;
  }
}

export async function deleteCalendar(db: Db, id: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM event_completions WHERE event_id IN (SELECT id FROM events WHERE calendar_id = ?)`).bind(id),
    db.prepare(`DELETE FROM events WHERE calendar_id = ?`).bind(id),
    db.prepare(`DELETE FROM calendars WHERE id = ?`).bind(id),
  ]);
}

/**
 * The settings page's "Remove calendar": unlike `deleteCalendar` on its own, a Google-sourced
 * calendar is also tombstoned, so the next sync's `mirrorGoogleCalendars` — which otherwise
 * re-lists and re-inserts anything on the account it does not already have a row for — leaves
 * it gone instead of quietly bringing it back. ICS and local calendars have nothing that would
 * resurrect them, so there is nothing to tombstone.
 */
export async function removeCalendarForGood(db: Db, userId: string, cal: CalendarRow): Promise<void> {
  if (cal.source === "google" && cal.account_id && cal.remote_id) {
    await db
      .prepare(`INSERT INTO removed_calendars (id, user_id, account_id, remote_id, removed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, remote_id) DO UPDATE SET removed_at = excluded.removed_at`)
      .bind(uid(), userId, cal.account_id, cal.remote_id, now())
      .run();
  }
  // A mailbox's own calendar is made again for any mailbox that has none, so removing it on purpose is remembered too.
  if ((cal.source === "local" || cal.source === "caldav") && cal.account_id && !cal.remote_id) {
    await db
      .prepare(`INSERT INTO removed_calendars (id, user_id, account_id, remote_id, removed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, remote_id) DO UPDATE SET removed_at = excluded.removed_at`)
      .bind(uid(), userId, cal.account_id, MAILBOX_REMOTE_ID, now())
      .run();
  }
  await deleteCalendar(db, cal.id);
}
