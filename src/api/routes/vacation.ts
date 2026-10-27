import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { UserRow } from "../db";
import { now, safeJson } from "../db";
import type { UserSettings, VacationSettings } from "@shared/types";
import { isActive, repliedCount, writeNotices } from "../vacation";
import { loadAiConfig } from "../ai/provider";

const vacation = new Hono<AppEnv>();

const MAX_DAYS = 120;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");

function read(user: UserRow): VacationSettings | undefined {
  return safeJson<UserSettings>(user.settings_json, {}).vacation;
}

vacation.get("/", async (c) => {
  const user = c.get("user");
  const v = read(user) ?? null;
  const cfg = await loadAiConfig(c.env, user.id);
  return c.json({
    vacation: v,
    active: isActive(v),
    replied: v ? await repliedCount(c.env.DB, user.id, v.from) : 0,
    ai: !!cfg,
  });
});

// Write the three notices for review. Nothing is saved or sent: the person reads them, edits them, and approves them with PUT.
vacation.post("/draft", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ from?: number; until?: number; guidance?: string; contact?: string }>().catch(() => ({}) as any);
  const until = Number(body.until);
  if (!Number.isFinite(until) || until <= now()) return c.json({ error: "bad_dates", message: "Pick a date to be back that is still ahead." }, 400);
  if (until > now() + MAX_DAYS * 86_400_000) return c.json({ error: "too_long", message: `Away notices can run for at most ${MAX_DAYS} days.` }, 400);
  const out = await writeNotices(c.env, user.id, {
    from: Number.isFinite(Number(body.from)) && Number(body.from) > 0 && Number(body.from) < until ? Number(body.from) : now(),
    until,
    guidance: text(body.guidance, 300),
    contact: text(body.contact, 120),
    name: user.name ?? "",
  });
  return c.json(out);
});

// Save. Turning it on is the approval: the notices in this request are the ones that will be sent, word for word.
vacation.put("/", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Partial<VacationSettings>>().catch(() => ({}) as Partial<VacationSettings>);
  const from = Number(b.from);
  const until = Number(b.until);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) return c.json({ error: "bad_dates", message: "The end date has to be after the start." }, 400);
  if (until - from > MAX_DAYS * 86_400_000) return c.json({ error: "too_long", message: `Away notices can run for at most ${MAX_DAYS} days.` }, 400);
  const notices = { team: text(b.notices?.team, 900), contact: text(b.notices?.contact, 900), other: text(b.notices?.other, 900) };
  const on = !!b.on;
  if (on && (!notices.team || !notices.contact || !notices.other)) return c.json({ error: "notices_missing", message: "Write all three notices before turning this on." }, 400);
  if (on && until <= now()) return c.json({ error: "bad_dates", message: "The end date has passed." }, 400);
  const next: VacationSettings = {
    on,
    approved: on,
    from,
    until,
    guidance: text(b.guidance, 300),
    contact: text(b.contact, 120),
    notices,
    letThrough: { correspondents: b.letThrough?.correspondents !== false, urgent: b.letThrough?.urgent !== false },
  };
  const settings = { ...safeJson<UserSettings>(user.settings_json, {}), vacation: next };
  await c.env.DB.prepare(`UPDATE users SET settings_json = ? WHERE id = ?`).bind(JSON.stringify(settings), user.id).run();
  return c.json({ vacation: next, active: isActive(next) });
});

// "I am back": off now. What was held is simply in the Imbox again, since the hold only exists while this is on.
vacation.post("/end", async (c) => {
  const user = c.get("user");
  const v = read(user);
  if (!v) return c.json({ ok: true });
  const settings = { ...safeJson<UserSettings>(user.settings_json, {}), vacation: { ...v, on: false, until: Math.min(v.until, now()) } };
  await c.env.DB.prepare(`UPDATE users SET settings_json = ? WHERE id = ?`).bind(JSON.stringify(settings), user.id).run();
  return c.json({ ok: true, replied: await repliedCount(c.env.DB, user.id, v.from) });
});

export default vacation;
