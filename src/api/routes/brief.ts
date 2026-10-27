import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { now } from "../db";
import { BRIEF_TTL_MS, nextThought, REFRESH_COOLDOWN_MS, briefAiEnabled, dayKey, gatherCandidates, dropClosedWaiting, gatherMeetings, loadBrief, rulesBrief, saveBrief, upgradeWithAi, type Brief } from "../ai/brief";
import { userTimezone } from "../timezone";

const brief = new Hono<AppEnv>();

/** Work that should finish after the response is sent. Without an execution context (a unit test) it simply runs alone. */
function later(c: Context<AppEnv>, job: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(job);
  } catch {
    void job.catch(() => {});
  }
}

/** Rebuild the plain-rules brief from what is in the mailbox and calendar right now, and keep it. */
async function freshRules(c: Context<AppEnv>, userId: string, day: string, tz: string): Promise<Brief> {
  const [candidates, meetings] = await Promise.all([gatherCandidates(c.env.DB, userId), gatherMeetings(c.env, userId, day, tz)]);
  const b = rulesBrief(day, candidates, meetings);
  await saveBrief(c.env.DB, userId, b);
  return b;
}

const RULES_REFRESH_MS = 30 * 60_000;

// Today's brief. It exists the moment it is asked for (built from plain rules); when an AI provider is set up, the AI's
// version replaces it a few seconds later and `pending` says so, so the page can ask again.
brief.get("/", async (c) => {
  const userId = c.get("user").id;
  const tz = await userTimezone(c.env.DB, userId);
  const day = dayKey(tz);
  const ai = await briefAiEnabled(c.env, userId);
  let cur = await loadBrief(c.env.DB, userId, day);
  let pending = false;
  if (!cur) {
    cur = await freshRules(c, userId, day, tz);
    if (ai) {
      pending = true;
      later(c, upgradeWithAi(c.env, userId, day, tz));
    }
  } else if (ai) {
    const stale = Date.now() - cur.created_at > BRIEF_TTL_MS;
    // A brief written before thoughts existed has none; ask once (a thought the model declined is stored as null and not asked for again).
    const noThought = cur.thought === undefined;
    if (cur.source === "rules" || stale || noThought) {
      pending = cur.source === "rules" || noThought;
      later(c, upgradeWithAi(c.env, userId, day, tz));
    }
  } else if (Date.now() - cur.created_at > RULES_REFRESH_MS) {
    cur = await freshRules(c, userId, day, tz);
  }
  return c.json({ brief: await dropClosedWaiting(c.env.DB, cur), pending, ai_enabled: ai }, 200, { "cache-control": "private, no-store" });
});

// "Refresh": look again now. Allowed every few minutes, so a tap-happy finger cannot run up the AI bill.
brief.post("/refresh", async (c) => {
  const userId = c.get("user").id;
  const tz = await userTimezone(c.env.DB, userId);
  const day = dayKey(tz);
  const ai = await briefAiEnabled(c.env, userId);
  const existing = await loadBrief(c.env.DB, userId, day);
  if (existing && Date.now() - existing.created_at < REFRESH_COOLDOWN_MS) {
    return c.json({ brief: existing, pending: false, ai_enabled: ai, cooldown: true });
  }
  const cur = await freshRules(c, userId, day, tz);
  if (ai) later(c, upgradeWithAi(c.env, userId, day, tz));
  return c.json({ brief: cur, pending: ai, ai_enabled: ai, cooldown: false });
});

// Another thought for today, written now. The brief keeps it as the day's current one and remembers it so it is not repeated.
brief.post("/thought", async (c) => {
  const userId = c.get("user").id;
  const tz = await userTimezone(c.env.DB, userId);
  const r = await nextThought(c.env, userId, dayKey(tz), tz);
  if (r.ok) return c.json({ brief: r.brief, pending: false, ai_enabled: true });
  const status = r.reason === "off" ? 400 : r.reason === "failed" ? 502 : 429;
  const error = { off: "Turn on the AI to get thoughts.", limit: "That is enough thoughts for today.", busy: "One moment, then try again.", failed: "Could not write one just now." }[r.reason];
  return c.json({ error, reason: r.reason }, status);
});

// ---------- what the person made of each day's thought ----------

const ThoughtBody = z.object({
  thought: z.object({ theme: z.string().max(60), quote: z.string().min(1).max(300), advice: z.string().max(500), affirmation: z.string().max(100), basis: z.string().max(80).optional() }),
  reaction: z.enum(["loved", "happy", "meh", "sad"]).nullable(),
  saved: z.boolean(),
});

// Everything they liked, disliked or saved, newest first.
brief.get("/thoughts", async (c) => {
  const userId = c.get("user").id;
  const rows = await c.env.DB.prepare(`SELECT key, thought_json, reaction, saved, updated_at FROM day_thoughts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 300`)
    .bind(userId)
    .all<{ key: string; thought_json: string; reaction: "loved" | "happy" | "meh" | "sad" | null; saved: number; updated_at: number }>();
  const items = rows.results.flatMap((r) => {
    try {
      return [{ key: r.key, thought: JSON.parse(r.thought_json), reaction: r.reaction, saved: r.saved === 1, updated_at: r.updated_at }];
    } catch {
      return [];
    }
  });
  return c.json({ items }, 200, { "cache-control": "private, no-store" });
});

// Set the reaction and whether it is saved. With neither, the row is removed.
brief.put("/thoughts/:key", async (c) => {
  const userId = c.get("user").id;
  const key = c.req.param("key");
  if (!/^[a-z0-9]{4,40}$/.test(key)) return c.json({ error: "Bad key" }, 400);
  const parsed = ThoughtBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Bad thought" }, 400);
  const { thought, reaction, saved } = parsed.data;
  if (!reaction && !saved) {
    await c.env.DB.prepare(`DELETE FROM day_thoughts WHERE user_id = ? AND key = ?`).bind(userId, key).run();
    return c.json({ ok: true });
  }
  await c.env.DB.prepare(
    `INSERT INTO day_thoughts (user_id, key, thought_json, reaction, saved, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET thought_json = excluded.thought_json, reaction = excluded.reaction, saved = excluded.saved, updated_at = excluded.updated_at`
  )
    .bind(userId, key, JSON.stringify(thought), reaction, saved ? 1 : 0, now())
    .run();
  return c.json({ ok: true });
});

export default brief;
