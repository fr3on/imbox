import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { now, uid } from "../../db";

const conversations = new Hono<AppEnv>();

conversations.get("/conversations", async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`).bind(c.get("user").id).all();
  return c.json(r.results);
});

conversations.post("/conversations", async (c) => {
  const id = uid();
  const t = now();
  await c.env.DB.prepare(`INSERT INTO ai_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, '', ?, ?)`).bind(id, c.get("user").id, t, t).run();
  return c.json({ id, title: "", created_at: t, updated_at: t });
});

conversations.get("/conversations/:id", async (c) => {
  const conv = await c.env.DB.prepare(`SELECT id, title, created_at, updated_at FROM ai_conversations WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), c.get("user").id).first();
  if (!conv) return c.json({ error: "not_found" }, 404);
  const msgs = await c.env.DB.prepare(`SELECT id, role, content_json, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`).bind(c.req.param("id")).all<{ id: string; role: string; content_json: string; created_at: number }>();
  return c.json({ conversation: conv, messages: msgs.results.map((m) => ({ id: m.id, role: m.role, content: JSON.parse(m.content_json), created_at: m.created_at })) });
});

conversations.patch("/conversations/:id", async (c) => {
  const b = await c.req.json<{ title?: string }>().catch(() => ({}) as any);
  await c.env.DB.prepare(`UPDATE ai_conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`).bind(String(b.title ?? "").slice(0, 120), now(), c.req.param("id"), c.get("user").id).run();
  return c.json({ ok: true });
});

conversations.delete("/conversations/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM ai_conversations WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), c.get("user").id).run();
  return c.json({ ok: true });
});

export default conversations;
