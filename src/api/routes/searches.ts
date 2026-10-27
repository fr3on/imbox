import { Hono } from "hono";
import type { AppEnv } from "../env";
import { now, uid } from "../db";
import { isId, str } from "../input";

// Searches kept by name. One list per person, shared by all their mailboxes; the query is stored as typed and runs like any other.
const searches = new Hono<AppEnv>();

const MAX_SAVED = 30;

searches.get("/", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT id, name, query, created_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT ${MAX_SAVED}`)
    .bind(c.get("user").id)
    .all<{ id: string; name: string; query: string; created_at: number }>();
  return c.json(rows.results);
});

// Saving the same query again renames it rather than adding a second copy.
searches.post("/", async (c) => {
  const b = await c.req.json<{ q?: string; name?: string }>().catch(() => ({}) as any);
  const query = str(b.q, 300);
  if (!query) return c.json({ error: "q required" }, 400);
  const name = str(b.name, 80) || query.slice(0, 60);
  const userId = c.get("user").id;
  const db = c.env.DB;
  const same = await db.prepare(`SELECT id FROM saved_searches WHERE user_id = ? AND query = ?`).bind(userId, query).first<{ id: string }>();
  if (same) {
    await db.prepare(`UPDATE saved_searches SET name = ? WHERE id = ? AND user_id = ?`).bind(name, same.id, userId).run();
    return c.json({ id: same.id, name, query });
  }
  const n = await db.prepare(`SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?`).bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_SAVED) return c.json({ error: "too_many" }, 400);
  const id = uid();
  await db.prepare(`INSERT INTO saved_searches (id, user_id, name, query, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, userId, name, query, now()).run();
  return c.json({ id, name, query });
});

searches.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return c.json({ error: "invalid" }, 400);
  const mine = await c.env.DB.prepare(`SELECT id FROM saved_searches WHERE id = ? AND user_id = ?`).bind(id, c.get("user").id).first();
  if (!mine) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(`DELETE FROM saved_searches WHERE id = ? AND user_id = ?`).bind(id, c.get("user").id).run();
  return c.json({ ok: true });
});

export default searches;
