import { Hono, type Context } from "hono";
import { ensureMailboxCalendars } from "../../calendar/mailbox";
import { deleteCalendar, ensureDefaultCalendars, removeCalendarForGood, syncCalendarNow } from "../../calendar/sources";
import { getSettings, listCalendars, ownedCalendar, toCalendar, toSettings } from "../../calendar/store";
import type { CalendarRow } from "../../calendar/types";
import type { AccountRow } from "../../db";
import { now, ownedAccount, uid } from "../../db";
import type { AppEnv } from "../../env";
import { CALENDAR_SCOPE, googleConfigured, hasCalendarScope, hasMailScope } from "../../google";
import { appOrigin, HANDOFF_PREFIX, statePrefixFor } from "../auth";
import { body, HEX, str, trimmed } from "./input";

const calendars = new Hono<AppEnv>();

/* ---------- sources ---------- */

export async function calendarPayload(
  c: Context<AppEnv>,
  userId: string
): Promise<{ rows: CalendarRow[]; accounts: AccountRow[]; counts: Map<string, number> }> {
  const db = c.env.DB;
  // Every mailbox has a calendar of its own; make any that are missing before listing them.
  await ensureMailboxCalendars(db, userId);
  const [rows, accounts, counts] = await Promise.all([
    listCalendars(db, userId),
    db.prepare(`SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC`).bind(userId).all<AccountRow>(),
    // Only local calendars ever show this count (it is the subtitle in Settings), and only they are
    // small enough to count cheaply. Counting every calendar meant scanning the user's whole events
    // table — thousands of rows, on every load of the calendar page — to label a handful of them.
    // Driven from `calendars`, not from `events`: this way SQLite seeks idx_events_calendar once per
    // local calendar instead of scanning every event the user owns. Filtering by `user_id` and
    // joining afterwards reads the whole table first and throws almost all of it away.
    db
      .prepare(
        `SELECT calendar_id, COUNT(*) AS n FROM events
         WHERE calendar_id IN (SELECT id FROM calendars WHERE user_id = ? AND source = 'local')
         GROUP BY calendar_id`
      )
      .bind(userId)
      .all<{ calendar_id: string; n: number }>(),
  ]);
  return { rows, accounts: accounts.results, counts: new Map(counts.results.map((r) => [r.calendar_id, r.n])) };
}

export function asCalendars(rows: CalendarRow[], accounts: AccountRow[], counts: Map<string, number>) {
  const emails = new Map(accounts.map((a) => [a.id, a.email]));
  return rows.map((r) => toCalendar(r, { account_email: r.account_id ? emails.get(r.account_id) ?? null : null, event_count: counts.get(r.id) ?? 0 }));
}

/** The whole `/sources` body. Shared with the disconnect route so the client can just swap it in. */
export async function sourcesPayload(c: Context<AppEnv>, userId: string) {
  const settings = await getSettings(c.env.DB, userId);
  const { rows, accounts, counts } = await calendarPayload(c, userId);
  // How many calendars we hold for each Google account, so a row can say what disconnecting costs.
  const perAccount = new Map<string, number>();
  for (const r of rows) if (r.source === "google" && r.account_id) perAccount.set(r.account_id, (perAccount.get(r.account_id) ?? 0) + 1);
  return {
    calendars: asCalendars(rows, accounts, counts),
    settings: toSettings(settings),
    // Gmail accounts whose refresh token predates (or declined) the Calendar scope.
    connectable: accounts.filter((a) => a.provider === "gmail" && !hasCalendarScope(a.scopes)).map((a) => ({ id: a.id, email: a.email })),
    // Every Google account, and what its token actually carries: the settings list is built off this.
    google_accounts: accounts
      .filter((a) => a.provider === "gmail")
      .map((a) => ({
        id: a.id,
        email: a.email,
        calendar: hasCalendarScope(a.scopes),
        mail: hasMailScope(a.scopes),
        calendar_count: perAccount.get(a.id) ?? 0,
        sync_error: a.sync_error ?? null,
        calendar_error: a.calendar_error ?? null,
      })),
  };
}

calendars.get("/sources", async (c) => {
  const userId = c.get("user").id;
  await ensureDefaultCalendars(c.env, userId).catch(() => {});
  return c.json(await sourcesPayload(c, userId));
});

calendars.post("/sources", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const b = await body<{ name: string; color: string; description: string }>(c);
  const name = trimmed(b.name, 120);
  if (!name) return c.json({ error: "name_required" }, 400);
  const color = trimmed(b.color, 7) || "#111111";
  if (!HEX.test(color)) return c.json({ error: "bad_color" }, 400);
  const pos = await db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM calendars WHERE user_id = ?`).bind(userId).first<{ p: number }>();
  const id = uid();
  const t = now();
  await db
    .prepare(
      `INSERT INTO calendars (id, user_id, account_id, source, remote_id, url, name, description, color, timezone, visible, writable, is_default, position, sync_status, created_at, updated_at)
       VALUES (?, ?, NULL, 'local', NULL, NULL, ?, ?, ?, '', 1, 1, 0, ?, 'idle', ?, ?)`
    )
    .bind(id, userId, name, str(b.description, 2000), color, pos?.p ?? 0, t, t)
    .run();
  const row = await ownedCalendar(db, userId, id);
  return c.json(toCalendar(row!, { event_count: 0 }));
});

// Sync every syncable source. Individual failures are reported, not thrown.
calendars.post("/sources/sync", async (c) => {
  const userId = c.get("user").id;
  // Rediscover first: a calendar list is only pulled at consent time, and if that call failed the
  // account sits there with the scope granted and nothing to show. Refresh has to be able to fix it.
  const gmail = await c.env.DB.prepare(`SELECT * FROM accounts WHERE user_id = ? AND provider = 'gmail'`).bind(userId).all<AccountRow>();
  const discovery: { email: string; error: string }[] = [];
  for (const acc of gmail.results) {
    if (!hasCalendarScope(acc.scopes)) continue;
    try {
      await ensureDefaultCalendars(c.env, userId, acc);
    } catch (e) {
      discovery.push({ email: acc.email, error: (e instanceof Error ? e.message : String(e ?? "")).slice(0, 300) });
    }
  }
  const rows = await listCalendars(c.env.DB, userId);
  const results: { id: string; changed: number; error?: string }[] = [];
  for (const cal of rows) {
    if (cal.source === "local") continue;
    try {
      const r = await syncCalendarNow(c.env, cal);
      results.push({ id: cal.id, changed: r.changed });
    } catch (e) {
      results.push({ id: cal.id, changed: 0, error: (e instanceof Error ? e.message : String(e ?? "")).slice(0, 300) });
    }
  }
  const { rows: fresh, accounts, counts } = await calendarPayload(c, userId);
  return c.json({ ok: true, results, discovery, calendars: asCalendars(fresh, accounts, counts) });
});

calendars.patch("/sources/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const cal = await ownedCalendar(db, userId, c.req.param("id"));
  if (!cal) return c.json({ error: "not_found" }, 404);
  const b = await body<{ name: string; color: string; visible: boolean; is_default: boolean }>(c);
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 120) : cal.name;
  let color = cal.color;
  if (typeof b.color === "string") {
    color = b.color.trim().slice(0, 7);
    if (!HEX.test(color)) return c.json({ error: "bad_color" }, 400);
  }
  const visible = typeof b.visible === "boolean" ? (b.visible ? 1 : 0) : cal.visible;
  const isDefault = typeof b.is_default === "boolean" ? (b.is_default ? 1 : 0) : cal.is_default;
  if (isDefault && !cal.writable) return c.json({ error: "read_only" }, 403);
  const stmts = [
    db.prepare(`UPDATE calendars SET name = ?, color = ?, visible = ?, is_default = ?, updated_at = ? WHERE id = ? AND user_id = ?`).bind(name, color, visible, isDefault, now(), cal.id, userId),
  ];
  // Exactly one default per owner.
  if (isDefault) stmts.unshift(db.prepare(`UPDATE calendars SET is_default = 0 WHERE user_id = ? AND id != ?`).bind(userId, cal.id));
  await db.batch(stmts);
  const fresh = await ownedCalendar(db, userId, cal.id);
  // A hidden calendar syncs slowly, so one being turned back on may be hours stale. Catch it up now
  // rather than making the owner wait for a tick that is deliberately infrequent.
  if (visible && !cal.visible && fresh && fresh.source !== "local") {
    c.executionCtx.waitUntil(syncCalendarNow(c.env, fresh).catch(() => {}));
  }
  return c.json(toCalendar(fresh!));
});

calendars.delete("/sources/:id", async (c) => {
  const userId = c.get("user").id;
  const cal = await ownedCalendar(c.env.DB, userId, c.req.param("id"));
  if (!cal) return c.json({ error: "not_found" }, 404);
  // A person choosing "Remove" here means it gone, not "gone until the next sync".
  await removeCalendarForGood(c.env.DB, userId, cal);
  return c.json({ ok: true });
});

calendars.post("/sources/:id/sync", async (c) => {
  const userId = c.get("user").id;
  const cal = await ownedCalendar(c.env.DB, userId, c.req.param("id"));
  if (!cal) return c.json({ error: "not_found" }, 404);
  if (cal.source === "local") return c.json({ ok: true, changed: 0, calendar: toCalendar(cal) });
  let changed = 0;
  let error: string | null = null;
  try {
    changed = (await syncCalendarNow(c.env, cal)).changed;
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e ?? "")).slice(0, 300);
  }
  const fresh = await ownedCalendar(c.env.DB, userId, cal.id);
  return c.json({ ok: !error, changed, error, calendar: toCalendar(fresh ?? cal) });
});

/* ---------- google ---------- */

/**
 * Same handoff as `POST /api/accounts/connect-link`, but the state also asks for the Calendar
 * scope. The app opens the URL in the system browser, which carries the user's Google session.
 *
 * `calendar_only` asks for Calendar and identity and nothing else, so the account it connects can
 * never read mail. Anything else asks for mail and calendar together, which is what "Connect
 * calendar" and "Reconnect" on an existing mail account want.
 */
calendars.post("/google/connect-link", async (c) => {
  const user = c.get("user");
  if (!(await googleConfigured(c.env))) return c.json({ error: "google_not_configured", message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET secrets." }, 500);
  const b = await body<{ account_id: string; calendar_only: boolean }>(c);
  let hint = "";
  if (typeof b.account_id === "string" && b.account_id) {
    const acc = await ownedAccount(c.env.DB, user.id, b.account_id);
    if (!acc) return c.json({ error: "not_found" }, 404);
    hint = acc.email;
  }
  const state = `${HANDOFF_PREFIX}${statePrefixFor(b.calendar_only === true ? "calendar" : "mail+calendar")}${uid()}`;
  await c.env.DB.prepare(`INSERT INTO oauth_states (state, user_id, created_at) VALUES (?, ?, ?)`).bind(state, user.id, now()).run();
  c.executionCtx.waitUntil(c.env.DB.prepare(`DELETE FROM oauth_states WHERE created_at < ?`).bind(now() - 3600_000).run());
  const url = `${appOrigin(c)}/auth/google/handoff?state=${encodeURIComponent(state)}${hint ? `&login_hint=${encodeURIComponent(hint)}` : ""}`;
  return c.json({ url });
});

/**
 * Take one Google account's calendars back out of inbox: drop the calendars and their events, and
 * forget the Calendar scope so the account offers "Connect calendar" again. Mail is untouched, the
 * account itself stays, and nothing changes in Google — the grant is still there until the user
 * revokes it, and reconnecting re-mirrors everything.
 */
calendars.post("/google/:accountId/disconnect", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const acc = await ownedAccount(db, userId, c.req.param("accountId"));
  if (!acc) return c.json({ error: "not_found" }, 404);
  const cals = await db
    .prepare(`SELECT id FROM calendars WHERE user_id = ? AND account_id = ? AND source = 'google'`)
    .bind(userId, acc.id)
    .all<{ id: string }>();
  for (const row of cals.results) await deleteCalendar(db, row.id);
  const kept = (acc.scopes ?? "")
    .split(/\s+/)
    .filter((s) => s && s !== CALENDAR_SCOPE)
    .join(" ");
  await db.prepare(`UPDATE accounts SET scopes = ? WHERE id = ? AND user_id = ?`).bind(kept, acc.id, userId).run();
  return c.json({ ok: true, removed: cals.results.length, ...(await sourcesPayload(c, userId)) });
});

export default calendars;
