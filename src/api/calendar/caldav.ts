// CalDAV, so a mailbox's calendar is the mail server's own. Stalwart (and most mail servers) keep a calendar
// per account behind the same login as the mailbox; this finds it, pulls its events into inbox, and sends
// events made or changed here back up. Reads and writes are both cheap to repeat: a pull is skipped when the
// server's collection tag has not moved, and a push only sends events edited since they were last sent.

import { muteHex } from "@shared/color";
import { fetchTimeout, TIMEOUT } from "../http";
import type { AccountRow } from "../db";
import { logSync, now, runBatch, safeJson, uid } from "../db";
import type { Env } from "../env";
import { configFor } from "../imapbox";
import { buildIcs, parseIcs, type IcsEventInput } from "./ical";
import { MAILBOX_REMOTE_ID, mailboxCalendar, mailboxColor } from "./mailbox";
import { updateRows } from "../sqlRows";
import { BATCH_SIZE, deleteEventStmts, insertEventStmts, prepareEvents, safeFeedUrl, updateEventStmts } from "./sources";
import { occurrenceStart } from "./store";
import type { CalendarRow, EventRow } from "./types";

const MAX_RESOURCES = 2000;
const PUSH_PER_RUN = 25;
const RECHECK_OK_MS = 6 * 3600_000;
const RECHECK_NONE_MS = 24 * 3600_000;

export interface DavCfg {
  /** Origin of the server, e.g. https://mail.example.com */
  base: string;
  user: string;
  pass: string;
}

// ---------- HTTP ----------

interface DavRes {
  status: number;
  text: string;
  headers: Headers;
}

/** One WebDAV request. Redirects are followed by hand, and only within the server's own origin. */
export async function dav(cfg: DavCfg, method: string, target: string, opts: { depth?: 0 | 1; body?: string; headers?: Record<string, string> } = {}): Promise<DavRes> {
  const origin = new URL(cfg.base).origin;
  let url = new URL(target, cfg.base).toString();
  for (let hop = 0; hop < 5; hop++) {
    if (new URL(url).origin !== origin) throw new Error("The calendar server redirected somewhere else");
    const headers: Record<string, string> = {
      authorization: `Basic ${btoa(unescape(encodeURIComponent(`${cfg.user}:${cfg.pass}`)))}`,
      "user-agent": "inbox (calendar sync)",
      ...(opts.depth !== undefined ? { depth: String(opts.depth) } : {}),
      ...(opts.body ? { "content-type": "application/xml; charset=utf-8" } : {}),
      ...opts.headers,
    };
    const res = await fetchTimeout(url, { method, headers, body: opts.body, redirect: "manual" }, TIMEOUT.remote);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    return { status: res.status, text: await res.text(), headers: res.headers };
  }
  throw new Error("The calendar server redirected too many times");
}

function need(res: DavRes, what: string, ok: number[] = [200, 207]): void {
  if (ok.includes(res.status)) return;
  if (res.status === 401 || res.status === 403) throw new Error(`The mail server refused the calendar login (${res.status})`);
  throw new Error(`${what} failed (${res.status})`);
}

// ---------- a very small XML reader ----------
// Node has no DOMParser, and multistatus replies are regular enough that matching tags is enough.

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "gi");
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
  return out;
}
const first = (xml: string, tag: string): string | null => blocks(xml, tag)[0] ?? null;

function unxml(s: string): string {
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  if (cdata.test(s)) return s.replace(cdata, "$1");
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, "\r").replace(/&amp;/g, "&");
}

const hrefOf = (xml: string | null): string => (xml ? unxml(first(xml, "href") ?? "").trim() : "");

// ---------- discovery ----------

export interface RemoteCollection {
  href: string;
  name: string;
  color: string;
  token: string;
}

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/></d:prop></d:propfind>`;
const PROPFIND_LIST = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/><a:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>`;
const PROPFIND_TOKEN = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>`;

/** Find the calendars this login owns. Throws when the server has no CalDAV or refuses the login. */
export async function listCollections(cfg: DavCfg): Promise<RemoteCollection[]> {
  let home = "";
  const start = await dav(cfg, "PROPFIND", "/.well-known/caldav", { depth: 0, body: PROPFIND_PRINCIPAL });
  need(start, "Looking for the calendar server");
  home = hrefOf(first(start.text, "calendar-home-set"));
  if (!home) {
    const principal = hrefOf(first(start.text, "current-user-principal"));
    if (principal) {
      const p = await dav(cfg, "PROPFIND", principal, { depth: 0, body: PROPFIND_PRINCIPAL });
      need(p, "Reading the calendar account");
      home = hrefOf(first(p.text, "calendar-home-set"));
    }
  }
  if (!home) home = `/dav/cal/${encodeURIComponent(cfg.user)}/`;

  const list = await dav(cfg, "PROPFIND", home, { depth: 1, body: PROPFIND_LIST });
  need(list, "Listing calendars");
  const homePath = new URL(home, cfg.base).pathname.replace(/\/?$/, "/");
  const out: RemoteCollection[] = [];
  for (const r of blocks(list.text, "response")) {
    const href = hrefOf(r);
    if (!href) continue;
    const type = first(r, "resourcetype") ?? "";
    if (!/<(?:[\w-]+:)?calendar\s*\/?>/i.test(type)) continue;
    const comps = first(r, "supported-calendar-component-set");
    if (comps && !/name="VEVENT"/i.test(comps)) continue;
    const path = new URL(href, cfg.base).pathname;
    if (path.replace(/\/?$/, "/") === homePath) continue;
    const color = unxml(first(r, "calendar-color") ?? "").trim();
    out.push({
      href: path,
      name: unxml(first(r, "displayname") ?? "").trim(),
      color: /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : "",
      token: unxml(first(r, "getctag") ?? first(r, "sync-token") ?? "").trim(),
    });
  }
  return out;
}

async function collectionToken(cfg: DavCfg, href: string): Promise<string> {
  const r = await dav(cfg, "PROPFIND", href, { depth: 0, body: PROPFIND_TOKEN });
  need(r, "Checking the calendar");
  return unxml(first(r.text, "getctag") ?? first(r.text, "sync-token") ?? "").trim();
}

// ---------- credentials ----------

async function davConfig(env: Env, accountId: string): Promise<DavCfg | null> {
  const c = await configFor(env, accountId);
  if (!c) return null;
  const base = `https://${c.imap.host}`;
  safeFeedUrl(base); // the same refusal of private addresses a subscribed link gets
  return { base, user: c.imap.username, pass: c.imap.password };
}

// ---------- discovery pass (cron) ----------

/**
 * Ask a few mailboxes' servers whether they hold calendars, and attach the answer: the first calendar becomes
 * the mailbox's own, any others are added beside it. A server without CalDAV is asked again only once a day.
 */
export async function discoverCaldav(env: Env): Promise<void> {
  const db = env.DB;
  const t = now();
  const due = await db
    .prepare(
      `SELECT a.* FROM accounts a JOIN imap_accounts i ON i.account_id = a.id
       WHERE a.provider = 'imap' AND a.sync_status <> 'disconnected'
         AND NOT EXISTS (SELECT 1 FROM agent_mailboxes m WHERE m.account_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM removed_calendars x WHERE x.account_id = a.id AND x.remote_id = ?)
         AND (i.caldav_checked_at IS NULL OR i.caldav_checked_at <= CASE WHEN i.caldav_home = '' THEN CAST(? AS BIGINT) ELSE CAST(? AS BIGINT) END)
       ORDER BY COALESCE(i.caldav_checked_at, 0) LIMIT 3`
    )
    .bind(MAILBOX_REMOTE_ID, t - RECHECK_NONE_MS, t - RECHECK_OK_MS)
    .all<AccountRow>();
  for (const acc of due.results) {
    try {
      await discoverAccount(env, acc);
    } catch (e) {
      console.error("caldav discovery failed", acc.email, e);
    }
  }
}

export async function discoverAccount(env: Env, acc: AccountRow): Promise<number> {
  const db = env.DB;
  const mark = (home: string) => db.prepare(`UPDATE imap_accounts SET caldav_checked_at = ?, caldav_home = ? WHERE account_id = ?`).bind(now(), home, acc.id).run();
  // Google's calendar speaks CalDAV only to OAuth sign-ins, never to a mailbox password or app password, and imap.gmail.com is not a
  // calendar server. Asking would only fail, so leave a Gmail or Workspace mailbox on its local calendar (and the calendar link route).
  const host = (await db.prepare(`SELECT imap_host FROM imap_accounts WHERE account_id = ?`).bind(acc.id).first<{ imap_host: string }>())?.imap_host ?? "";
  if (/(^|\.)(gmail|googlemail)\.com$/i.test(host.trim())) {
    await mark("");
    return 0;
  }
  let cols: RemoteCollection[];
  try {
    const cfg = await davConfig(env, acc.id);
    if (!cfg) return 0;
    cols = await listCollections(cfg);
  } catch (e) {
    // No CalDAV here, or a login it will not take: leave the mailbox calendar as it is and try again tomorrow.
    await mark("");
    await logSync(db, acc.id, "info", `No calendar sync for ${acc.email}: ${(e as Error).message}`);
    return 0;
  }
  if (!cols.length) {
    await mark("");
    return 0;
  }
  await mark(cols[0].href);

  const own = await mailboxCalendar(db, acc);
  const existing = (await db.prepare(`SELECT * FROM calendars WHERE account_id = ? AND source = 'caldav'`).bind(acc.id).all<CalendarRow>()).results;
  const byHref = new Map(existing.map((c) => [c.remote_id ?? "", c]));
  const pos = await db.prepare(`SELECT COALESCE(MAX(position), -1) AS p FROM calendars WHERE user_id = ?`).bind(acc.user_id).first<{ p: number }>();
  let position = (pos?.p ?? -1) + 1;
  const t = now();
  const seen = new Set<string>();
  const stmts: DbStatement[] = [];
  let claimedOwn = existing.length > 0 || !own || own.source !== "local";
  for (const col of cols) {
    seen.add(col.href);
    const url = new URL(col.href, `https://placeholder`).pathname; // keep the path only: the origin comes from the account
    if (byHref.has(col.href)) {
      stmts.push(db.prepare(`UPDATE calendars SET url = ?, updated_at = ? WHERE id = ?`).bind(url, t, byHref.get(col.href)!.id));
      continue;
    }
    if (!claimedOwn && own) {
      // The first calendar on the server becomes the mailbox's own, keeping what is already in it.
      claimedOwn = true;
      stmts.push(db.prepare(`UPDATE calendars SET source = 'caldav', remote_id = ?, url = ?, sync_token = NULL, writable = 1, updated_at = ? WHERE id = ?`).bind(col.href, url, t, own.id));
      continue;
    }
    const label = col.name && col.name.toLowerCase() !== "default" ? `${acc.email} · ${col.name}` : acc.email;
    stmts.push(
      db
        .prepare(
          `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at)
           VALUES (?, ?, ?, 'caldav', ?, ?, ?, '', ?, '', 1, 1, 0, ?, 'idle', ?, ?)`
        )
        .bind(uid(), acc.user_id, acc.id, col.href, url, label, muteHex(col.color) ?? mailboxColor(acc.email), position++, t, t)
    );
  }
  for (const c of existing) if (!seen.has(c.remote_id ?? "")) stmts.push(db.prepare(`DELETE FROM events WHERE calendar_id = ?`).bind(c.id), db.prepare(`DELETE FROM calendars WHERE id = ?`).bind(c.id));
  await db.batch(stmts);
  await logSync(db, acc.id, "info", `Calendar sync connected for ${acc.email} (${cols.length} calendar${cols.length === 1 ? "" : "s"})`);
  return cols.length;
}

// ---------- push ----------

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

function inputFrom(row: EventRow, uidValue: string, tz: string, extra: Partial<IcsEventInput> = {}): IcsEventInput {
  return {
    uid: uidValue,
    summary: row.title,
    description: row.description,
    location: row.location,
    url: row.url,
    allDay: !!row.all_day,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startDate: row.start_date,
    endDate: row.end_date,
    tzid: row.timezone || tz,
    rrule: row.rrule,
    organizer: row.organizer_email ? { email: row.organizer_email, name: row.organizer_name } : null,
    attendees: safeJson<{ email: string; name: string; rsvp: string; optional: boolean }[]>(row.attendees_json, []),
    reminders: safeJson<{ minutes: number }[]>(row.reminders_json, []).map((r) => r.minutes),
    status: row.status,
    ...extra,
  };
}

/** The ICS for one event and every override of it. */
export function resourceIcs(master: EventRow, overrides: EventRow[], uidValue: string, tz: string): string {
  const zone = master.timezone || tz;
  const ex = (master.exdates ?? "").split(",").map((d) => d.trim()).filter(Boolean).map((d) => (master.all_day ? d : occurrenceStart(master, d, zone)));
  const inputs: IcsEventInput[] = [inputFrom(master, uidValue, tz, { exdates: ex })];
  for (const o of overrides) {
    if (!o.occurrence_date) continue;
    inputs.push(inputFrom(o, uidValue, tz, { rrule: null, recurrenceId: master.all_day ? o.occurrence_date : occurrenceStart(master, o.occurrence_date, zone) }));
  }
  return buildIcs(inputs);
}

/** Send what changed here to the server: deletions first, then every event edited since it was last sent. */
export async function pushCaldav(env: Env, cfg: DavCfg, cal: CalendarRow): Promise<number> {
  const db = env.DB;
  if (!cal.url) return 0;
  let sent = 0;
  const tombs = await db.prepare(`SELECT id, href FROM caldav_deletes WHERE calendar_id = ? LIMIT 50`).bind(cal.id).all<{ id: string; href: string }>();
  for (const tb of tombs.results) {
    const r = await dav(cfg, "DELETE", tb.href);
    if (r.status >= 400 && r.status !== 404) throw new Error(`Removing an event on the server failed (${r.status})`);
    await db.prepare(`DELETE FROM caldav_deletes WHERE id = ?`).bind(tb.id).run();
    sent++;
  }

  const groups = await db
    .prepare(
      `SELECT DISTINCT COALESCE(master_id, id) AS gid FROM events
       WHERE calendar_id = ? AND kind = 'event' AND (href IS NULL OR updated_at > COALESCE(pushed_at, 0)) LIMIT ?`
    )
    .bind(cal.id, PUSH_PER_RUN)
    .all<{ gid: string }>();
  const base = cal.url.replace(/\/?$/, "/");
  for (const g of groups.results) {
    const master = await db.prepare(`SELECT * FROM events WHERE id = ? AND calendar_id = ?`).bind(g.gid, cal.id).first<EventRow>();
    if (!master) continue;
    const overrides = (await db.prepare(`SELECT * FROM events WHERE master_id = ? AND calendar_id = ?`).bind(master.id, cal.id).all<EventRow>()).results;
    const uidValue = master.ical_uid || `${master.id}@inbox`;
    const href = master.href || `${base}${slug(uidValue)}.ics`;
    const body = resourceIcs(master, overrides, uidValue, cal.timezone || "UTC");
    const r = await dav(cfg, "PUT", href, { body, headers: { "content-type": "text/calendar; charset=utf-8" } });
    // The server already holds an event with this UID under another name (it may have filed the invitation
    // itself). Treat ours as sent: the next pull replaces our row with the server's copy of the same event.
    const conflict = r.status === 409 || r.status === 412;
    if (r.status >= 300 && !conflict) throw new Error(`Sending "${master.title || "an event"}" to the server failed (${r.status})`);
    const t = Math.max(now(), ...[master, ...overrides].map((e) => e.updated_at));
    const stmts = [
      db.prepare(`UPDATE events SET href = ?, pushed_at = ?, ical_uid = ?, remote_id = ? WHERE id = ?`).bind(href, t, uidValue, uidValue, master.id),
      ...overrides.map((o) => db.prepare(`UPDATE events SET href = ?, pushed_at = ?, ical_uid = ?, remote_id = ? WHERE id = ?`).bind(href, t, uidValue, `${uidValue}::${o.occurrence_date}`, o.id)),
    ];
    await db.batch(stmts);
    sent++;
  }
  return sent;
}

// ---------- pull ----------

const REPORT_ALL = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`;

/**
 * Bring the server's copy of one calendar into inbox. The server is the truth for anything it has; what
 * it no longer lists is removed here, and what is waiting to be sent is left alone.
 */
export async function syncCaldavCalendar(env: Env, cal: CalendarRow): Promise<{ changed: number }> {
  const db = env.DB;
  if (!cal.url || !cal.account_id) throw new Error("That calendar has no server address");
  const cfg = await davConfig(env, cal.account_id);
  if (!cfg) return { changed: 0 };
  try {
    const sent = await pushCaldav(env, cfg, cal);
    const token = await collectionToken(cfg, cal.url);
    if (!sent && token && token === cal.sync_token && cal.sync_status !== "error") {
      await db.prepare(`UPDATE calendars SET last_synced_at = ? WHERE id = ?`).bind(now(), cal.id).run();
      return { changed: 0 };
    }

    const rep = await dav(cfg, "REPORT", cal.url, { depth: 1, body: REPORT_ALL });
    need(rep, "Reading the calendar");
    const found: { href: string; ics: string }[] = [];
    for (const r of blocks(rep.text, "response")) {
      const data = first(r, "calendar-data");
      const href = hrefOf(r);
      if (data && href) found.push({ href: new URL(href, cfg.base).pathname, ics: unxml(data) });
      if (found.length >= MAX_RESOURCES) break;
    }

    // Events still waiting to be sent must not be overwritten by the server's older copy.
    const dirty = new Set(
      (await db.prepare(`SELECT ical_uid FROM events WHERE calendar_id = ? AND ical_uid IS NOT NULL AND (href IS NULL OR updated_at > COALESCE(pushed_at, 0))`).bind(cal.id).all<{ ical_uid: string }>()).results.map((r) => r.ical_uid)
    );
    const rows = (await db.prepare(`SELECT id, remote_id, href FROM events WHERE calendar_id = ?`).bind(cal.id).all<{ id: string; remote_id: string | null; href: string | null }>()).results;
    const existing = new Map<string, string>();
    for (const r of rows) if (r.remote_id) existing.set(r.remote_id, r.id);

    const parsedEvents = [] as ReturnType<typeof parseIcs>["events"];
    const hrefOfUid = new Map<string, string>();
    let tz = cal.timezone;
    for (const f of found) {
      const p = parseIcs(f.ics);
      if (!tz && p.timezone) tz = p.timezone;
      for (const ev of p.events) {
        if (dirty.has(ev.uid)) continue;
        parsedEvents.push(ev);
        hrefOfUid.set(ev.uid, f.href);
      }
    }
    const prepared = prepareEvents(parsedEvents, cal, existing, true).filter((p) => p.remoteId);
    const t = now();
    const seenHrefs = new Set(found.map((f) => f.href));
    const stale = rows.filter((r) => r.href && !seenHrefs.has(r.href)).map((r) => r.id);
    // The address each event came from, and the time it was last in step with the server (just after the write, so it does not look edited).
    const hrefs = prepared.map((p) => [p.id, hrefOfUid.get(p.ev.uid) ?? null, t + 1]);
    await runBatch(
      db,
      [
        ...insertEventStmts(db, cal, prepared.filter((p) => !existing.has(p.remoteId!)), t),
        ...updateEventStmts(db, cal, prepared.filter((p) => existing.has(p.remoteId!)), t),
        ...updateRows(db, "events", ["id", "href", "pushed_at"], ["TEXT", "TEXT", "BIGINT"], hrefs),
        ...deleteEventStmts(db, stale),
      ],
      BATCH_SIZE
    );

    const after = await collectionToken(cfg, cal.url).catch(() => token);
    await db.prepare(`UPDATE calendars SET sync_status = 'idle', sync_error = NULL, sync_token = ?, timezone = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`).bind(after || null, tz || "", now(), now(), cal.id).run();
    return { changed: prepared.length + stale.length };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await db.prepare(`UPDATE calendars SET sync_status = 'error', sync_error = ?, last_synced_at = ?, updated_at = ? WHERE id = ?`).bind(msg.slice(0, 1000), now(), now(), cal.id).run();
    await logSync(db, cal.account_id, "error", `Calendar sync failed for "${cal.name}": ${msg}`);
    throw e;
  }
}

/** Remember an event removed here, so the next sync removes it on the server too. */
export async function recordCaldavDelete(db: Db, calendarId: string, href: string | null): Promise<void> {
  if (!href) return;
  await db.prepare(`INSERT INTO caldav_deletes (id, calendar_id, href, created_at) VALUES (?, ?, ?, ?)`).bind(uid(), calendarId, href, now()).run();
}

