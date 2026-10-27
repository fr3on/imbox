import { ownedRow, uid } from "../../db";
import { type Handler, ownedThreadRow } from "./context";

export const list_labels: Handler = async ({ db, sc, ok }) => {
  const rows = await db.prepare(`SELECT id, name FROM labels WHERE account_id IN ${sc.sql} ORDER BY name NULLS FIRST`).bind(...sc.params).all<{ id: string; name: string }>();
  return ok({ labels: rows.results }, `Listed ${rows.results.length} labels`);
};

export const list_collections: Handler = async ({ db, sc, ok }) => {
  const rows = await db
    .prepare(`SELECT c.id, c.name, c.description, (SELECT COUNT(*) FROM collection_threads ct WHERE ct.collection_id = c.id) AS thread_count FROM collections c WHERE c.account_id IN ${sc.sql} ORDER BY c.updated_at DESC`)
    .bind(...sc.params)
    .all();
  return ok({ collections: rows.results }, `Listed ${rows.results.length} collections`);
};

export const create_collection: Handler = async ({ input, db, ids, t, ok, fail }) => {
  const nm = String(input.name ?? "").trim().slice(0, 120);
  if (!nm) return fail("name required");
  const id = uid();
  await db.prepare(`INSERT INTO collections (id, account_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(id, ids[0], nm, String(input.description ?? "").slice(0, 500), t, t).run();
  return ok({ collection_id: id, name: nm }, `Created collection “${nm}”`);
};

export const add_to_collection: Handler = async ({ ctx, input, db, t, ok, fail }) => {
  const row = await ownedThreadRow(ctx, String(input.thread_id ?? ""));
  const coll = await ownedRow<{ id: string; name: string }>(db, "collections", String(input.collection_id ?? ""), ctx.user.id);
  if (!row || !coll) return fail("Thread or collection not found");
  await db.prepare(`INSERT INTO collection_threads (collection_id, thread_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).bind(coll.id, row.id, t).run();
  await db.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).bind(t, coll.id).run();
  return ok({ ok: true }, `Added “${row.custom_subject || row.subject}” to ${coll.name}`);
};

export const save_clip: Handler = async ({ ctx, input, db, t, ok, fail }) => {
  const row = await ownedThreadRow(ctx, String(input.thread_id ?? ""));
  const text = String(input.text ?? "").trim().slice(0, 500);
  if (!row || !text) return fail("Thread not found or empty text");
  const id = uid();
  await db.prepare(`INSERT INTO clips (id, account_id, thread_id, message_id, text, created_at) VALUES (?, ?, ?, NULL, ?, ?)`).bind(id, row.account_id, row.id, text, t).run();
  return ok({ clip_id: id }, `Clipped “${text.slice(0, 40)}${text.length > 40 ? "…" : ""}”`);
};
