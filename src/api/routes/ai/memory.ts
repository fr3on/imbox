import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { addMemory, clearMemory, deleteMemory, learnFromMail, listMemory, updateMemory, type MemoryKind } from "../../ai/memory";
import { describeApiError } from "../../ai/provider";

const memory = new Hono<AppEnv>();

memory.get("/memory", async (c) => c.json(await listMemory(c.env, c.get("user").id)));

memory.post("/memory", async (c) => {
  const b = await c.req.json<{ kind?: MemoryKind; content?: string }>().catch(() => ({}) as any);
  if (typeof b.content !== "string" || !b.content.trim()) return c.json({ error: "content_required" }, 400);
  return c.json(await addMemory(c.env, c.get("user").id, b.kind ?? "fact", b.content, "user"));
});

memory.patch("/memory/:id", async (c) => {
  const b = await c.req.json<{ kind?: MemoryKind; content?: string }>().catch(() => ({}) as any);
  const row = await updateMemory(c.env, c.get("user").id, c.req.param("id"), b);
  return row ? c.json(row) : c.json({ error: "not_found" }, 404);
});

memory.delete("/memory/:id", async (c) => c.json({ ok: await deleteMemory(c.env, c.get("user").id, c.req.param("id")) }));

memory.delete("/memory", async (c) => {
  await clearMemory(c.env, c.get("user").id);
  return c.json({ ok: true });
});

memory.post("/learn", async (c) => {
  try {
    const r = await learnFromMail(c.env, c.get("user"), { force: true });
    return c.json(r);
  } catch (e) {
    return c.json({ error: describeApiError(e) }, 400);
  }
});

export default memory;
