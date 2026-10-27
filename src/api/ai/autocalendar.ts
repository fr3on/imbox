// "Put deadlines in my calendar": once a minute, for people who switched it on, look at recent Imbox and Paper Trail mail for a deadline
// (a domain renewal, a bill, a notice with a due date) and add it to the calendar as an all-day event linked to the mail. Meetings and tasks are
// left as suggestions on the thread. Each mail is looked at once per new message, and what was added is remembered so it is never added twice.

import type { UserSettings } from "@shared/types";
import type { Env } from "../env";
import { Budget, UNLIMITED } from "../jobs";
import type { AccountRow, MessageRow, ThreadRow, UserRow } from "../db";
import { chunk, now, safeJson, toMessage } from "../db";
import { createEvent } from "../calendar/store";
import { ensureDefaultCalendars } from "../calendar/sources";
import { actionsKey, findActions, loadFound, loadStates, looksActionable, looksUrgent, saveFound, setState, type ActionWhen } from "./actions";
import { dayKey } from "./brief";
import { userTimezone } from "../timezone";
import { loadAiConfig, loadAiSettings } from "./provider";

/** Mail older than this when the setting is switched on is left alone. */
const LOOK_BACK_MS = 7 * 86_400_000;
const THREADS_PER_PASS = 40;
/** Model calls one person's pass may make, so a long backlog is worked through over a few minutes. */
const ASKS_PER_PASS = 8;

interface Due {
  id: string;
  title: string;
  description: string;
  when: ActionWhen;
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One person's pass. Returns how many events were added. */
export async function autoCalendarForUser(env: Env, userId: string, budget: Budget = UNLIMITED): Promise<number> {
  const db = env.DB;
  const ai = await loadAiSettings(env, userId);
  if (!ai || ai.suggest_actions === 0) return 0;
  const cfg = await loadAiConfig(env, userId);
  if (!cfg) return 0;
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<UserRow>();
  if (!user) return 0;
  const accounts = (await db.prepare(`SELECT * FROM accounts WHERE user_id = ?`).bind(userId).all<AccountRow>()).results;
  if (!accounts.length) return 0;
  const inSql = `(${accounts.map(() => "?").join(",")})`;
  const threads = (
    await db
      .prepare(`SELECT t.* FROM threads t WHERE t.account_id IN ${inSql} AND t.bucket IN ('imbox', 'paper_trail') AND t.merged_into IS NULL AND t.last_message_at >= ? ORDER BY t.last_message_at DESC LIMIT ?`)
      .bind(...accounts.map((a) => a.id), now() - LOOK_BACK_MS, THREADS_PER_PASS)
      .all<ThreadRow>()
  ).results;
  if (!threads.length) return 0;

  // A mail is looked at once for each new message: this marker says "seen at this state of the thread".
  const markerOf = (t: ThreadRow) => `auto:${t.last_message_at}:${t.message_count}`;
  const marked = new Set<string>();
  for (const part of chunk(threads.map((t) => t.id), 90)) {
    const rows = await db.prepare(`SELECT thread_id, action_id FROM thread_action_state WHERE thread_id IN (${part.map(() => "?").join(",")}) AND action_id ILIKE 'auto:%'`).bind(...part).all<{ thread_id: string; action_id: string }>();
    for (const r of rows.results) marked.add(`${r.thread_id}|${r.action_id}`);
  }

  // A person who never opened the calendar has none yet; make the default one rather than fail every minute.
  await ensureDefaultCalendars(env, userId).catch(() => {});
  const tz = await userTimezone(db, userId);
  const today = dayKey(tz);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(new Date());
  const deps = { env, user, accounts, cfg };
  let added = 0;
  let asked = 0;

  for (const t of threads) {
    if (budget.spent) break;
    if (marked.has(`${t.id}|${markerOf(t)}`)) continue;
    const rows = await db.prepare(`SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC LIMIT 40`).bind(t.id).all<MessageRow>();
    const msgs = rows.results.map((r) => toMessage(r));
    const key = actionsKey(msgs);
    if (!key) {
      await setState(db, t.id, markerOf(t), "done");
      continue;
    }
    let found = await loadFound(db, t.id, key);
    if (!found) {
      // The same gate as the thread's suggestions: a cheap look before a model call.
      const worth = t.bucket === "paper_trail" ? looksUrgent(msgs) : looksActionable(msgs);
      if (!worth) {
        await setState(db, t.id, markerOf(t), "done");
        continue;
      }
      if (asked >= ASKS_PER_PASS) continue;
      asked++;
      try {
        const evs = await db.prepare(`SELECT starts_at, start_date FROM events WHERE thread_id = ? AND status <> 'cancelled'`).bind(t.id).all<{ starts_at: number; start_date: string | null }>();
        const existing = new Set(evs.results.map((e) => e.start_date ?? dayKey(tz, e.starts_at)));
        found = await findActions(deps, msgs, today, weekday, tz, existing);
        await saveFound(db, t.id, key, found).catch(() => {});
      } catch (e) {
        console.error("auto calendar: reading a thread failed", (e as Error).message);
        continue; // tried again next minute
      }
    }

    const states = await loadStates(db, t.id);
    const dues: Due[] = [];
    const ov = found.overview;
    if (ov?.due && !states.has(ov.id)) {
      const what = (ov.what || ov.ask).replace(/[.\s]+$/, "");
      dues.push({ id: ov.id, title: `Due: ${trim(what || t.subject, 70)}`, description: [ov.ask, ...ov.facts.map((f) => `${f.label}: ${f.value}`)].filter(Boolean).join("\n"), when: ov.due });
    }
    for (const a of found.actions) {
      if (a.kind === "deadline" && a.when && !states.has(a.id)) dues.push({ id: a.id, title: `Due: ${a.title}`, description: a.why, when: a.when });
    }
    const evs = await db.prepare(`SELECT starts_at, start_date FROM events WHERE thread_id = ? AND status <> 'cancelled'`).bind(t.id).all<{ starts_at: number; start_date: string | null }>();
    const taken = new Set(evs.results.map((e) => e.start_date ?? dayKey(tz, e.starts_at)));
    for (const d of dues) {
      if (d.when.ends_at < now()) continue;
      const day = d.when.start_date ?? dayKey(tz, d.when.starts_at);
      if (!taken.has(day)) {
        await createEvent(env, userId, {
          kind: "event",
          title: trim(d.title, 120),
          description: trim(d.description, 500),
          all_day: true,
          start_date: day,
          end_date: d.when.end_date ?? day,
          timezone: tz,
          busy: false,
          thread_id: t.id,
          message_id: null,
        });
        taken.add(day);
        added++;
      }
      // Marked done either way, so the thread stops offering what is already in the calendar.
      await setState(db, t.id, d.id, "done");
    }
    await setState(db, t.id, markerOf(t), "done");
  }
  return added;
}

/** The cron entry: everyone who turned the setting on and has an AI provider set up. */
export async function autoCalendarDue(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const users = await env.DB
    .prepare(`SELECT u.id, u.settings_json FROM users u JOIN ai_settings a ON a.user_id = u.id WHERE a.suggest_actions <> 0 AND u.settings_json ILIKE '%"autoCalendar":true%'`)
    .all<{ id: string; settings_json: string }>();
  for (const u of users.results) {
    if (budget.spent) break;
    if (safeJson<UserSettings>(u.settings_json, {}).autoCalendar !== true) continue;
    try {
      await autoCalendarForUser(env, u.id, budget);
    } catch (e) {
      console.error("auto calendar failed", (e as Error).message);
    }
  }
}
