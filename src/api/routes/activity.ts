import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ACTORS, listActivity, type Actor } from "../activity";
import { isId } from "../input";

const activity = new Hono<AppEnv>();

// Everything that happened in this person's imbox, newest first, a page at a time. `actor` narrows it to one kind of doer, `problems` to what went wrong,
// `thread` to one conversation, `q` to words in the sentence or its reason. `next` goes back as `before` for the page after.
activity.get("/", async (c) => {
  const actor = c.req.query("actor");
  const thread = c.req.query("thread");
  const before = c.req.query("before");
  const limit = Number(c.req.query("limit"));
  const out = await listActivity(c.env.DB, c.get("user").id, {
    actor: ACTORS.includes(actor as Actor) ? (actor as Actor) : null,
    problems: c.req.query("problems") === "1",
    q: (c.req.query("q") ?? "").slice(0, 100),
    threadId: isId(thread) ? thread : null,
    before: before && before.length < 200 ? before : null,
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });
  return c.json(out, 200, { "cache-control": "private, no-store" });
});

// Empty the log. What the app keeps for its own sake (the sync log, the AI call record, agent runs) is not touched.
activity.delete("/", async (c) => {
  await c.env.DB.prepare(`DELETE FROM activity_log WHERE user_id = ?`).bind(c.get("user").id).run();
  return c.json({ ok: true });
});

export default activity;
