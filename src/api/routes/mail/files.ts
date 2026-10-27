import { Hono } from "hono";
import type { AppEnv } from "../../env";
import type { AttachmentRow } from "../../db";
import { toAttachment } from "../../db";
import { pageParam, searchTerm } from "../../input";
import { PAGE, scope } from "./shared";

const files = new Hono<AppEnv>();

// ---------- Files ----------
files.get("/files", async (c) => {
  const db = c.env.DB;
  const sc = scope(c, "a");
  const page = pageParam(c.req.query("page"));
  const q = searchTerm((c.req.query("q") ?? "").trim());
  const params: unknown[] = [...sc.params];
  let extra = "";
  if (q) {
    extra = ` AND (a.filename ILIKE ? OR t.subject ILIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  const rows = await db
    .prepare(
      `SELECT a.*, t.subject AS t_subject, t.custom_subject AS t_custom_subject, m.from_email, m.from_name FROM attachments a JOIN messages m ON m.id = a.message_id JOIN threads t ON t.id = a.thread_id WHERE ${sc.sql} AND a.is_inline = 0${extra} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, PAGE + 1, page * PAGE)
    .all<AttachmentRow & { t_subject: string; t_custom_subject: string | null; from_email: string; from_name: string }>();
  const hasMore = rows.results.length > PAGE;
  const filesList = rows.results.slice(0, PAGE).map((r) => toAttachment(r, { thread_subject: r.t_custom_subject ?? r.t_subject, from: { email: r.from_email, name: r.from_name } }));
  return c.json({ files: filesList, next_page: hasMore ? page + 1 : null });
});

export default files;
