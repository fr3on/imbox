import { type MemoryKind, addMemory, deleteMemory, listMemory } from "../memory";
import { type Handler } from "./context";

export const list_memory: Handler = async ({ ctx, ok }) => {
  const rows = await listMemory(ctx.env, ctx.user.id);
  return ok({ memory: rows.map((r) => ({ id: r.id, kind: r.kind, content: r.content, source: r.source })) }, `Recalled ${rows.length} memory entries`);
};

export const remember: Handler = async ({ ctx, input, ok, fail }) => {
  const kind = String(input.kind ?? "fact") as MemoryKind;
  const content = String(input.content ?? "").trim();
  if (!content) return fail("content required");
  const row = await addMemory(ctx.env, ctx.user.id, kind, content, "assistant");
  return ok({ id: row.id }, `Remembered: ${content.slice(0, 60)}${content.length > 60 ? "…" : ""}`);
};

export const forget: Handler = async ({ ctx, input, ok, fail }) => {
  const done = await deleteMemory(ctx.env, ctx.user.id, String(input.id ?? ""));
  return done ? ok({ ok: true }, "Forgot that") : fail("Memory entry not found");
};
