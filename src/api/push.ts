// Pushing notifications to browsers that are not open. The list of what is worth telling this person already exists (notifications.ts);
// this sends each new item once, to every device that said yes, and forgets devices the browser has dropped.

import type { Env } from "./env";
import { Budget, UNLIMITED } from "./jobs";
import { now } from "./db";
import { listNotifications, type Notification, type NotificationKind } from "./notifications";
import { sendPush } from "./webpush";

const KINDS: NotificationKind[] = ["mail", "sender", "sync", "invite", "agent"];
/** More than this many new things at once go out as one summary, not a burst. */
const MAX_SEPARATE = 3;
/** A subscription that keeps failing for another reason than being gone is dropped after this many. */
const MAX_FAILURES = 8;

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  types_json: string;
}

export type Types = Partial<Record<NotificationKind, boolean>>;

export function cleanTypes(t: unknown): Types {
  const out: Types = {};
  if (t && typeof t === "object") for (const k of KINDS) out[k] = (t as Types)[k] !== false;
  else for (const k of KINDS) out[k] = true;
  return out;
}

const wants = (types: string, kind: NotificationKind): boolean => {
  try {
    return (JSON.parse(types || "{}") as Types)[kind] !== false;
  } catch {
    return true;
  }
};

const running = new Set<string>();

/**
 * Send whatever is new since last time to this person's devices. Returns how many notifications went out (per device counts once).
 * Safe to call as often as mail arrives: each item is pushed once, and two callers at the same moment do not both send.
 */
export async function pushNewNotifications(env: Env, userId: string): Promise<number> {
  if (running.has(userId)) return 0;
  running.add(userId);
  try {
    const db = env.DB;
    const subs = await db.prepare(`SELECT id, endpoint, p256dh, auth, types_json FROM push_subscriptions WHERE user_id = ?`).bind(userId).all<SubRow>();
    if (!subs.results.length) return 0;
    const state = await db.prepare(`SELECT pushed_at FROM push_state WHERE user_id = ?`).bind(userId).first<{ pushed_at: number }>();
    if (!state) {
      await db.prepare(`INSERT INTO push_state (user_id, pushed_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(userId, now()).run();
      return 0;
    }
    const fresh = (await listNotifications(db, userId)).filter((n) => n.at > state.pushed_at).sort((a, b) => a.at - b.at);
    if (!fresh.length) return 0;
    const user = await db.prepare(`SELECT email FROM users WHERE id = ?`).bind(userId).first<{ email: string }>();
    const subject = `mailto:${user?.email || "admin@localhost"}`;

    let sent = 0;
    for (const sub of subs.results) {
      const mine = fresh.filter((n) => wants(sub.types_json, n.kind));
      if (!mine.length) continue;
      const messages = mine.length > MAX_SEPARATE ? [summary(mine)] : mine.map(toMessage);
      let gone = false;
      let failed = false;
      for (const m of messages) {
        const r = await sendPush(env, sub, m, subject);
        if (r.gone) {
          gone = true;
          break;
        }
        if (!r.ok) failed = true;
        else sent++;
      }
      if (gone) await db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(sub.id).run();
      else if (failed) {
        await db.prepare(`UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?`).bind(sub.id).run();
        await db.prepare(`DELETE FROM push_subscriptions WHERE id = ? AND failures >= ?`).bind(sub.id, MAX_FAILURES).run();
      } else await db.prepare(`UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?`).bind(now(), sub.id).run();
    }
    await db.prepare(`UPDATE push_state SET pushed_at = ? WHERE user_id = ?`).bind(Math.max(...fresh.map((n) => n.at)), userId).run();
    return sent;
  } catch (e) {
    console.error("push dispatch failed", (e as Error).message);
    return 0;
  } finally {
    running.delete(userId);
  }
}

function toMessage(n: Notification) {
  return { title: n.title, body: n.body, link: n.link, tag: n.id, kind: n.kind };
}

function summary(items: Notification[]) {
  const newest = items[items.length - 1];
  return { title: `${items.length} new notifications`, body: items.slice(-3).reverse().map((n) => n.title).join(", "), link: "/", tag: `summary:${newest.id}`, kind: "mail" as const };
}

/** The user behind a mailbox, for the moment mail lands in it. */
export async function pushForAccount(env: Env, accountId: string, userId?: string): Promise<void> {
  // A caller that has the account row knows whose it is; asking again is a statement for nothing.
  const owner = userId ?? (await env.DB.prepare(`SELECT user_id FROM accounts WHERE id = ?`).bind(accountId).first<{ user_id: string }>())?.user_id;
  if (owner) await pushNewNotifications(env, owner);
}

/** Everyone with a subscribed device, for the once-a-minute job that also syncs the mailboxes. */
export async function pushDue(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const users = await env.DB.prepare(`SELECT DISTINCT user_id FROM push_subscriptions`).all<{ user_id: string }>();
  for (const u of users.results) {
    if (budget.spent) break;
    await pushNewNotifications(env, u.user_id);
  }
}
