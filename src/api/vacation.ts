// Being away: one polite notice to each person who writes, and an Imbox that holds back everything but the people and the urgent mail.
//
// The notices are written once, when the person sets this up (by the model if one is configured, from a template if not) and are approved by
// them. When mail arrives, nothing is generated: the approved text for that kind of sender is sent, with the sender's first name filled in.
// So what goes out is always what the person saw, and a model that misbehaves cannot put new words in their mouth.

import { z } from "zod";
import { logActivity } from "./activity";
import type { Env } from "./env";
import { Budget, UNLIMITED } from "./jobs";
import type { AccountRow } from "./db";
import { now, chunk, safeJson } from "./db";
import { isBulk } from "./autoletin";
import { sendMail } from "./send";
import { loadAiConfig, makeProvider } from "./ai/provider";
import { userTimezone } from "./timezone";
import { agentAccountIds } from "./agent";
import type { UserSettings, VacationSettings } from "@shared/types";

/** Someone who has been told is not told again for this long. */
export const REPLY_AGAIN_MS = 4 * 24 * 3600_000;
const MAX_PER_PASS = 20;
const RETRY_AFTER_FAILURE_MS = 15 * 60_000;

export type SenderKind = "team" | "contact" | "other";

/** Switched on, approved, and now is between the two dates. */
export function isActive(v: VacationSettings | undefined | null, at = now()): v is VacationSettings {
  return !!v && v.on && v.approved && v.until > v.from && at >= v.from && at < v.until;
}

export function vacationOf(settingsJson: string | null | undefined): VacationSettings | undefined {
  return safeJson<UserSettings>(settingsJson ?? "{}", {}).vacation;
}

/** Addresses that are not a person reading mail. A notice sent to them is noise at best and a loop at worst. */
const MACHINE_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounces?|noreply|no-reply)([-_.+].*)?$/i;
/** Subjects that are themselves automatic replies or delivery reports. */
const AUTO_SUBJECT = /^\s*(auto(matic)?([ -]?reply)?:|automatic reply|out of office|undeliverable|delivery (status|failure)|returned mail|failure notice|mail delivery)/i;

export interface Glance {
  from_email: string;
  subject: string;
  list_unsubscribe?: string;
  list_id?: string;
  precedence?: string;
}

/** Whether a message is the kind that should be answered with a notice. Bulk mail and automatic mail never is. */
export function canReceiveNotice(m: Glance, ownEmail: string): boolean {
  const from = (m.from_email ?? "").trim().toLowerCase();
  if (!from.includes("@") || from === ownEmail.trim().toLowerCase()) return false;
  if (MACHINE_LOCAL.test(from.split("@")[0])) return false;
  if (isBulk(m)) return false;
  if (/auto[-_ ]?(replied|generated)|auto_reply/i.test(m.precedence ?? "")) return false;
  if (AUTO_SUBJECT.test(m.subject ?? "")) return false;
  return true;
}

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "hey.com", "fastmail.com"]);

/** Someone at your own organisation, someone you have written to, or anyone else. */
export function kindOf(ownEmail: string, senderEmail: string, wroteToThem: boolean): SenderKind {
  const own = ownEmail.split("@")[1]?.toLowerCase() ?? "";
  const theirs = senderEmail.split("@")[1]?.toLowerCase() ?? "";
  if (own && own === theirs && !FREE_MAIL.has(own)) return "team";
  return wroteToThem ? "contact" : "other";
}

export function firstName(name: string | undefined, email: string): string {
  const n = (name ?? "").replace(/["<>]/g, "").trim();
  if (n && !n.includes("@")) return n.split(/\s+/)[0];
  const local = email.split("@")[0].split(/[._+-]/)[0];
  return /^[a-z]{2,}$/i.test(local) && local.length > 1 ? local[0].toUpperCase() + local.slice(1).toLowerCase() : "";
}

/** The approved text with `{name}` filled in. With no name, "Hi {name}," becomes "Hi,". */
export function fillNotice(text: string, name: string): string {
  const clean = name.replace(/[\r\n{}]/g, "").trim();
  return text.replace(/\s*\{name\}/g, clean ? ` ${clean}` : "");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain paragraphs to the small HTML the composer and the mailer use. */
export function noticeHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Words that mean it should not wait for the person to be back. Deliberately narrow: a wrong guess here only means one thread is shown early. */
const URGENT = /\b(urgent|urgently|asap|time[- ]sensitive|immediately|emergency|deadline (today|tomorrow)|action required|final notice|overdue|past due|payment (failed|declined)|security (alert|warning)|account (suspended|locked))\b/i;

export function isUrgent(subject: string, snippet: string): boolean {
  return URGENT.test(`${subject ?? ""} ${snippet ?? ""}`.slice(0, 600));
}

/** "Oct 12", in the person's own time zone. */
export function dateWords(at: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: tz }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(at));
  }
}

/** What is written when no model is set up, or it could not be reached. Plain, short, and no promise beyond the date. */
export function templateNotices(input: { until: string; contact: string }): VacationSettings["notices"] {
  const urgent = input.contact.trim() ? ` If it cannot wait, please contact ${input.contact.trim()}.` : "";
  return {
    team: `Hi{name},\n\nI am away until ${input.until} and not reading mail.${urgent}\n\nOtherwise I will get back to you when I am back.`,
    contact: `Hi{name},\n\nThank you for your message. I am away until ${input.until} and will reply when I am back.${urgent}`,
    other: `Hello{name},\n\nThank you for writing. I am away until ${input.until}, so I will not see your message until then.${urgent}`,
  };
}

const Written = z.object({ team: z.string(), contact: z.string(), other: z.string() });

const SYSTEM = `You write the automatic reply a person sends while they are on vacation, in three versions for three kinds of sender:
- team: someone who works at the same organisation. Direct and brief.
- contact: someone the person has written to before. Warm and professional.
- other: anyone else. Polite and brief.

Rules:
- Plain text, no emoji, no markdown, no subject line, no signature block.
- Start each with "Hi{name}," (team and contact) or "Hello{name}," (other). Write {name} exactly like that, with the curly braces and no space before it. It is replaced with the sender's first name, or nothing.
- Each version is at most 60 words.
- Say the person is away until the date you are given. Do not promise a reply time, a phone number, or anything you were not told.
- If a person to contact for urgent matters is given, say that urgent things should go to them, using exactly the words you were given for them. Otherwise say nothing about urgent matters.
- Follow the tone the person asked for. Never invent facts. Never include links.`;

export interface NoticeInput {
  from: number;
  until: number;
  guidance: string;
  contact: string;
  name: string;
}

/** Write the three notices: with the model when one is set up, from the template when not or when it fails. The person approves them either way. */
export async function writeNotices(env: Env, userId: string, input: NoticeInput): Promise<{ notices: VacationSettings["notices"]; source: "ai" | "template" }> {
  const tz = await userTimezone(env.DB, userId);
  const until = dateWords(input.until, tz);
  const fallback = { notices: templateNotices({ until, contact: input.contact }), source: "template" as const };
  const cfg = await loadAiConfig(env, userId);
  if (!cfg) return fallback;
  try {
    const provider = makeProvider(cfg);
    const res = await provider.complete({
      feature: "vacation",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `The person is called ${input.name || "(no name given)"}.\nAway until: ${until}.\nWho urgent things go to: ${input.contact.trim() || "(nobody was named)"}.\nWhat they asked for: ${input.guidance.trim().slice(0, 300) || "(nothing in particular)"}`,
        },
      ],
      schema: { name: "vacation_notices", zod: Written },
      maxTokens: 700,
      effort: "low",
    });
    if (res.refused || !res.json) return fallback;
    const clean = (s: string) => s.replace(/\r/g, "").trim().slice(0, 900);
    const out = { team: clean(res.json.team), contact: clean(res.json.contact), other: clean(res.json.other) };
    if (!out.team || !out.contact || !out.other) return fallback;
    return { notices: out, source: "ai" };
  } catch (e) {
    console.error("vacation notices failed", (e as Error).message);
    return fallback;
  }
}

/** Which of these addresses the person has written to. */
export async function correspondentsOf(db: Db, accountIds: string[], emails: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!accountIds.length) return out;
  const inSql = `(${accountIds.map(() => "?").join(",")})`;
  for (const email of [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 80)) {
    const hit = await db
      .prepare(`SELECT 1 AS x FROM messages WHERE account_id IN ${inSql} AND is_from_me = 1 AND lower(to_json) ILIKE ? LIMIT 1`)
      .bind(...accountIds, `%${email.replace(/[%_]/g, "")}%`)
      .first<{ x: number }>();
    if (hit) out.add(email);
  }
  return out;
}

type Incoming = { id: string; thread_id: string; account_id: string; from_email: string; from_name: string; subject: string; date: number; list_unsubscribe: string; list_id: string; precedence: string };

const running = new Set<string>();
const failedAt = new Map<string, number>();

/** One user's pass: anyone who has written since the person left and has not been told yet gets the notice for their kind. Returns how many were sent. */
export async function vacationForUser(env: Env, userId: string, v: VacationSettings): Promise<number> {
  if (running.has(userId)) return 0;
  running.add(userId);
  try {
    return await pass(env, userId, v);
  } finally {
    running.delete(userId);
  }
}

async function pass(env: Env, userId: string, v: VacationSettings): Promise<number> {
  const db = env.DB;
  const t = now();
  // Mail agents' own mailboxes are not the person's, and never answer for them.
  const agents = await agentAccountIds(env, userId);
  const accounts = (await db.prepare(`SELECT * FROM accounts WHERE user_id = ?`).bind(userId).all<AccountRow>()).results.filter((a) => !agents.has(a.id));
  if (!accounts.length) return 0;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ids = accounts.map((a) => a.id);
  const rows = (
    await db
      .prepare(
        `SELECT m.id, m.thread_id, m.account_id, m.from_email, m.from_name, m.subject, m.date, m.list_unsubscribe, m.list_id, m.precedence
         FROM messages m JOIN threads t ON t.id = m.thread_id
         WHERE m.account_id IN (${ids.map(() => "?").join(",")}) AND m.is_from_me = 0 AND m.created_at >= ? AND t.bucket = 'imbox' AND t.merged_into IS NULL
         ORDER BY m.date DESC LIMIT 200`
      )
      .bind(...ids, v.from)
      .all<Incoming>()
  ).results;
  if (!rows.length) return 0;

  // The newest message from each sender is the one answered.
  const latest = new Map<string, Incoming>();
  for (const m of rows) {
    const key = m.from_email.toLowerCase();
    if (!latest.has(key)) latest.set(key, m);
  }
  const told = new Set<string>();
  for (const part of chunk([...latest.keys()], 90)) {
    const found = await db
      .prepare(`SELECT email FROM vacation_replies WHERE user_id = ? AND sent_at > ? AND email IN (${part.map(() => "?").join(",")})`)
      .bind(userId, t - REPLY_AGAIN_MS, ...part)
      .all<{ email: string }>();
    for (const r of found.results) told.add(r.email);
  }
  const todo = [...latest].filter(([k, m]) => {
    if (told.has(k)) return false;
    const account = byId.get(m.account_id);
    if (!account || !canReceiveNotice(m, account.email)) return false;
    return t - (failedAt.get(`${userId}|${k}`) ?? 0) > RETRY_AFTER_FAILURE_MS;
  });
  if (!todo.length) return 0;
  const wrote = await correspondentsOf(db, ids, todo.map(([k]) => k));

  let sent = 0;
  for (const [key, m] of todo.slice(0, MAX_PER_PASS)) {
    const account = byId.get(m.account_id)!;
    // If the person has already answered this thread since, there is nothing to say.
    const answered = await db.prepare(`SELECT 1 AS x FROM messages WHERE thread_id = ? AND is_from_me = 1 AND date > ? LIMIT 1`).bind(m.thread_id, m.date).first();
    if (answered) continue;
    const kind = kindOf(account.email, key, wrote.has(key));
    const text = v.notices[kind];
    if (!text?.trim()) continue;
    // Claim the sender before sending, so a slow pass and the next one cannot both write to them.
    await db
      .prepare(`INSERT INTO vacation_replies (user_id, email, thread_id, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, email) DO UPDATE SET thread_id = excluded.thread_id, sent_at = excluded.sent_at`)
      .bind(userId, key, m.thread_id, t)
      .run();
    try {
      await sendMail(env, account, {
        thread_id: m.thread_id,
        reply_to_message_id: m.id,
        to: [{ email: m.from_email, name: m.from_name }],
        subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`.trim(),
        body_html: noticeHtml(fillNotice(text, firstName(m.from_name, key))),
        autoSubmitted: true,
      });
      sent++;
      await logActivity(db, userId, { actor: "rules", kind: "away_notice", summary: `Sent an away notice to ${m.from_name ? `${m.from_name} (${key})` : key}`, why: `You are away, and they wrote to ${account.email}`, threadId: m.thread_id, accountId: account.id });
    } catch (e) {
      console.error("vacation notice failed", (e as Error).message);
      failedAt.set(`${userId}|${key}`, t);
      await db.prepare(`DELETE FROM vacation_replies WHERE user_id = ? AND email = ?`).bind(userId, key).run();
    }
  }
  return sent;
}

/** The cron entry: everyone who is away right now. */
export async function vacationDue(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const users = await env.DB.prepare(`SELECT id, settings_json FROM users WHERE settings_json ILIKE '%"vacation"%'`).all<{ id: string; settings_json: string }>();
  for (const u of users.results) {
    const v = vacationOf(u.settings_json);
    if (!isActive(v)) continue;
    if (budget.spent) break;
    try {
      await vacationForUser(env, u.id, v);
    } catch (e) {
      console.error("vacation pass failed", (e as Error).message);
    }
  }
}

/** How many people have been told since the person left. */
export async function repliedCount(db: Db, userId: string, since: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM vacation_replies WHERE user_id = ? AND sent_at >= ?`).bind(userId, since).first<{ n: number }>();
  return r?.n ?? 0;
}

/** While away: which of the Imbox's new threads still reach the cards, and which wait for the person to be back. */
export async function splitForAway<T extends { last_from_email: string; subject: string; snippet: string | null }>(
  db: Db,
  v: VacationSettings,
  rows: T[],
  accountIds: string[]
): Promise<{ kept: T[]; held: T[] }> {
  const wrote = v.letThrough.correspondents ? await correspondentsOf(db, accountIds, rows.map((r) => r.last_from_email ?? "").filter(Boolean)) : new Set<string>();
  const kept: T[] = [];
  const held: T[] = [];
  for (const r of rows) {
    const through = (v.letThrough.correspondents && wrote.has((r.last_from_email ?? "").toLowerCase())) || (v.letThrough.urgent && isUrgent(r.subject, r.snippet ?? ""));
    (through ? kept : held).push(r);
  }
  return { kept, held };
}
