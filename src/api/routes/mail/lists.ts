import { Hono } from "hono";
import type { AppEnv } from "../../env";
import type { AttachmentRow, MessageRow, ThreadRow } from "../../db";
import {
  attachAvatarsToAll,
  chunk,
  getLabelsForThreads,
  loadBundles,
  now,
  placeholders,
  threadsWithLabels,
  toAttachment,
  toMessage,
  toThreadSummary,
} from "../../db";
import { pageParam, searchTerm } from "../../input";
import { isActive, repliedCount, splitForAway, vacationOf } from "../../vacation";
import type { Counts, ImboxResponse } from "@shared/types";
import { PAGE, VISIBLE, scope } from "./shared";

const lists = new Hono<AppEnv>();

// ---------- Counts ----------
lists.get("/counts", async (c) => {
  const db = c.env.DB;
  const t = now();
  const sc = scope(c);
  const q = (sql: string) => {
    // Bind (scope params + now) once per occurrence of the scope clause in the SQL.
    const times = sql.split(sc.sql).length - 1;
    const params: unknown[] = [];
    for (let i = 0; i < times; i++) params.push(...sc.params, t);
    return db.prepare(sql).bind(...params).first<{ n: number }>();
  };
  const [screener, imbox, feed, paper, rl, sa] = await Promise.all([
    // Senders, not threads: grouped first, which is a hash and not a sort of every address (half the time of COUNT(DISTINCT LOWER(...)) on 10,000 waiting threads).
    q(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM threads t WHERE ${sc.sql} AND t.bucket = 'screener' AND ${VISIBLE} GROUP BY LOWER(t.last_from_email)) g`),
    q(`SELECT (SELECT COUNT(*) FROM threads t WHERE ${sc.sql} AND t.bucket = 'imbox' AND t.bundle_id IS NULL AND t.seen = 0 AND t.reply_later = 0 AND t.set_aside = 0 AND ${VISIBLE})
             + (SELECT COUNT(*) FROM bundles b WHERE b.status = 'open' AND EXISTS (SELECT 1 FROM threads t WHERE t.bundle_id = b.id AND ${sc.sql} AND t.bucket = 'imbox' AND t.reply_later = 0 AND t.set_aside = 0 AND ${VISIBLE})) AS n`),
    q(`SELECT COUNT(*) AS n FROM threads t WHERE ${sc.sql} AND t.bucket = 'feed' AND t.seen = 0 AND ${VISIBLE}`),
    q(`SELECT (SELECT COUNT(*) FROM threads t WHERE ${sc.sql} AND t.bucket = 'paper_trail' AND t.bundle_id IS NULL AND t.seen = 0 AND ${VISIBLE})
             + (SELECT COUNT(*) FROM bundles b WHERE b.status = 'open' AND EXISTS (SELECT 1 FROM threads t WHERE t.bundle_id = b.id AND ${sc.sql} AND t.bucket = 'paper_trail' AND ${VISIBLE})) AS n`),
    q(`SELECT COUNT(*) AS n FROM threads t WHERE ${sc.sql} AND t.reply_later = 1 AND ${VISIBLE}`),
    q(`SELECT COUNT(*) AS n FROM threads t WHERE ${sc.sql} AND t.set_aside = 1 AND ${VISIBLE}`),
  ]);
  const out: Counts = {
    screener: screener?.n ?? 0,
    imbox_new: imbox?.n ?? 0,
    feed_new: feed?.n ?? 0,
    paper_trail_new: paper?.n ?? 0,
    reply_later: rl?.n ?? 0,
    set_aside: sa?.n ?? 0,
  };
  return c.json(out);
});

// ---------- Imbox ----------

// The latest few threads in the Imbox, kept small for the browser extension's side panel: who wrote, the subject, a line of text, and whether it is new.
lists.get("/imbox/recent", async (c) => {
  const t = now();
  const sc = scope(c);
  const limit = Math.min(8, Math.max(1, Math.floor(Number(c.req.query("limit"))) || 4));
  const rows = await c.env.DB
    .prepare(
      `SELECT t.id, t.last_from_email AS email, t.last_from_name AS name, COALESCE(t.custom_subject, t.subject) AS subject, t.snippet, t.seen, t.last_message_at AS at
       FROM threads t WHERE ${sc.sql} AND t.bucket = 'imbox' AND t.bundle_id IS NULL AND t.reply_later = 0 AND t.set_aside = 0 AND ${VISIBLE}
       ORDER BY t.last_message_at DESC LIMIT ?`
    )
    .bind(...sc.params, t, limit)
    .all<{ id: string; email: string; name: string; subject: string; snippet: string; seen: number; at: number }>();
  return c.json({ threads: rows.results.map((r) => ({ id: r.id, email: r.email, name: r.name, subject: r.subject, snippet: r.snippet.slice(0, 160), unread: r.seen === 0, at: r.at })) });
});

lists.get("/imbox", async (c) => {
  const db = c.env.DB;
  const t = now();
  const sc = scope(c);
  const base = `SELECT t.* FROM threads t WHERE ${sc.sql} AND ${VISIBLE}`;
  const [fresh, seen, rl, sa, senders] = await Promise.all([
    db.prepare(`${base} AND t.bucket = 'imbox' AND t.bundle_id IS NULL AND t.seen = 0 AND t.reply_later = 0 AND t.set_aside = 0 ORDER BY t.last_message_at DESC LIMIT 200`).bind(...sc.params, t).all<ThreadRow>(),
    db.prepare(`${base} AND t.bucket = 'imbox' AND t.bundle_id IS NULL AND t.seen = 1 AND t.reply_later = 0 AND t.set_aside = 0 ORDER BY t.last_message_at DESC LIMIT 200`).bind(...sc.params, t).all<ThreadRow>(),
    db.prepare(`${base} AND t.reply_later = 1 AND t.bucket <> 'trash' ORDER BY t.reply_later_at DESC NULLS LAST LIMIT 100`).bind(...sc.params, t).all<ThreadRow>(),
    db.prepare(`${base} AND t.set_aside = 1 AND t.bucket <> 'trash' ORDER BY t.set_aside_at DESC NULLS LAST LIMIT 100`).bind(...sc.params, t).all<ThreadRow>(),
    db
      .prepare(
        // The Screener's senders, grouped per account for the avatar lookup below and merged by email (across accounts) once results are back, and how many
        // senders wait in all: counted over the groups, so the threads are read once and not twice.
        `WITH g AS (
           SELECT t.account_id, t.last_from_email AS email, MAX(t.last_from_name) AS name, COUNT(*) AS thread_count, MAX(t.last_message_at) AS latest
           FROM threads t WHERE ${sc.sql} AND t.bucket = 'screener' AND ${VISIBLE}
           GROUP BY t.account_id, t.last_from_email
         )
         SELECT g.*, (SELECT COUNT(DISTINCT LOWER(email)) FROM g) AS total FROM g ORDER BY latest DESC NULLS LAST LIMIT 24`
      )
      .bind(...sc.params, t)
      .all<{ account_id: string; email: string; name: string; thread_count: number; latest: number; total: number }>(),
  ]);
  const mergedSenders = new Map<string, { account_id: string; email: string; name: string; thread_count: number; latest: number }>();
  for (const r of senders.results) {
    const key = r.email.toLowerCase();
    const existing = mergedSenders.get(key);
    if (!existing) mergedSenders.set(key, { ...r });
    else {
      existing.thread_count += r.thread_count;
      if (r.latest > existing.latest) {
        existing.account_id = r.account_id;
        existing.name = r.name;
        existing.latest = r.latest;
      }
    }
  }
  const topSenders = [...mergedSenders.values()].sort((a, b) => b.latest - a.latest).slice(0, 8);
  // Away: only the people you write to and the urgent reach the cards; the rest waits as "Back to work".
  const v = vacationOf(c.get("user").settings_json);
  let freshRows = fresh.results;
  let heldRows: ThreadRow[] = [];
  let away: ImboxResponse["away"] = null;
  if (isActive(v)) {
    const split = await splitForAway(db, v, freshRows, c.get("accountIds"));
    freshRows = split.kept;
    heldRows = split.held;
    away = { until: v.until, replied: await repliedCount(db, c.get("user").id, v.from), held: heldRows.length };
  }
  const all = [...freshRows, ...heldRows, ...seen.results, ...rl.results, ...sa.results];
  const labels = await getLabelsForThreads(
    db,
    all.map((r) => r.id)
  );
  const map = (rows: ThreadRow[]) => rows.map((r) => toThreadSummary(r, labels.get(r.id) ?? []));
  const senderPairs = topSenders.map((r) => ({ account_id: r.account_id, email: r.email }));
  // The pictures of everyone on the page, the sections and the Screener's senders, in one lookup.
  const sections = [map(freshRows), map(heldRows), map(seen.results), map(rl.results), map(sa.results)];
  const senderAvatars = await attachAvatarsToAll(db, sections, senderPairs);
  const [newT, heldT, seenT, rlT, saT] = sections;
  const bundles = await loadBundles(db, c.get("accountIds"), "imbox", t);
  const out: ImboxResponse = {
    new_threads: newT,
    ...(away ? { held_threads: heldT, away } : {}),
    seen_threads: seenT,
    bundles,
    reply_later: rlT,
    set_aside: saT,
    screener_count: senders.results[0]?.total ?? 0,
    screener_senders: topSenders.map((r) => ({
      account_id: r.account_id,
      email: r.email,
      name: r.name ?? "",
      thread_count: r.thread_count,
      avatar_url: senderAvatars.get(`${r.account_id}|${(r.email ?? "").toLowerCase()}`) ?? "",
    })),
  };
  return c.json(out);
});

// ---------- Thread lists ----------
lists.get("/threads", async (c) => {
  const db = c.env.DB;
  const t = now();
  const sc = scope(c);
  const bucket = c.req.query("bucket") ?? "everything";
  const page = pageParam(c.req.query("page"));
  const label = c.req.query("label");
  const q = searchTerm((c.req.query("q") ?? "").trim());
  const where: string[] = [sc.sql, bucket === "bubble_up" ? `t.merged_into IS NULL AND t.bubble_up_at IS NOT NULL AND t.bubble_up_at > ?` : VISIBLE];
  const params: unknown[] = [...sc.params, t];
  switch (bucket) {
    case "bubble_up":
      where.push(`t.bucket <> 'trash'`);
      break;
    case "previously_seen":
      // The Imbox threads you have already opened, same rule as the Imbox page's own "Previously seen" section.
      where.push(`t.bucket = 'imbox' AND t.bundle_id IS NULL AND t.seen = 1 AND t.reply_later = 0 AND t.set_aside = 0`);
      break;
    case "imbox":
    case "feed":
    case "paper_trail":
    case "screened_out":
    case "trash":
    case "screener":
      where.push(`t.bucket = ?`);
      params.push(bucket);
      break;
    case "sent":
      where.push(`t.bucket <> 'trash' AND EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.is_from_me = 1)`);
      break;
    case "reply_later":
      where.push(`t.reply_later = 1 AND t.bucket <> 'trash'`);
      break;
    case "set_aside":
      where.push(`t.set_aside = 1 AND t.bucket <> 'trash'`);
      break;
    case "bubbled":
      where.push(`t.bubbled = 1 AND t.bucket <> 'trash'`);
      break;
    default: {
      // The Everything page can narrow to one place; anything else keeps its usual "not trash, not screened out".
      const only = c.req.query("in");
      if (only === "updates" || only === "feed") {
        where.push(`t.bucket IN ('feed', 'paper_trail')`);
      } else if (only && ["imbox", "paper_trail", "screener"].includes(only)) {
        where.push(`t.bucket = ?`);
        params.push(only);
      } else {
        where.push(`t.bucket <> 'trash' AND t.bucket <> 'screened_out'`);
      }
    }
  }
  if (c.req.query("unread") === "1") where.push(`t.seen = 0`);
  if (c.req.query("attach") === "1") where.push(`t.has_attachments = 1`);
  const days = parseInt(c.req.query("days") ?? "", 10);
  if (days > 0 && days <= 3650) {
    where.push(`t.last_message_at >= ?`);
    params.push(t - days * 86_400_000);
  }
  if (label) {
    where.push(`EXISTS (SELECT 1 FROM thread_labels tl WHERE tl.thread_id = t.id AND tl.label_id = ?)`);
    params.push(label);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(`(t.subject ILIKE ? OR t.custom_subject ILIKE ? OR t.snippet ILIKE ? OR t.participants_json ILIKE ?)`);
    params.push(like, like, like, like);
  }
  const order = bucket === "reply_later" ? "t.reply_later_at DESC NULLS LAST" : bucket === "set_aside" ? "t.set_aside_at DESC NULLS LAST" : bucket === "bubble_up" ? "t.bubble_up_at ASC NULLS FIRST" : "t.last_message_at DESC";
  const bundlesApply = bucket === "paper_trail" && !q && !label && c.req.query("unread") !== "1" && c.req.query("attach") !== "1" && !(days > 0);
  if (bundlesApply) where.push(`t.bundle_id IS NULL`);
  const rows = await db
    .prepare(`SELECT t.* FROM threads t WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...params, PAGE + 1, page * PAGE)
    .all<ThreadRow>();
  const hasMore = rows.results.length > PAGE;
  const threads = await threadsWithLabels(db, rows.results.slice(0, PAGE));
  if (bundlesApply && page === 0) {
    const bundles = await loadBundles(db, c.get("accountIds"), "paper_trail", t);
    return c.json({ threads, bundles, next_page: hasMore ? page + 1 : null });
  }
  return c.json({ threads, next_page: hasMore ? page + 1 : null });
});

// ---------- Feed (with latest message) ----------
// Backs Updates (Feeds and Paper Trail together) and, for older links, each of them on its own.
lists.get("/feed", async (c) => {
  const db = c.env.DB;
  const t = now();
  const sc = scope(c);
  // "library" is the Updates page: Feeds and Paper Trail together, newest first.
  const wanted = c.req.query("bucket") === "paper_trail" ? ["paper_trail"] : c.req.query("bucket") === "library" ? ["feed", "paper_trail"] : ["feed"];
  const FEED_PAGE = 30;
  // Shows what you haven't marked done yet (seen = 0) by default; ?show=all includes everything. Paper Trail mail is kept, so it always shows.
  const showAll = c.req.query("show") === "all";
  const where = [sc.sql, `t.bucket IN (${wanted.map(() => "?").join(",")})`, VISIBLE];
  const params: unknown[] = [...sc.params, ...wanted, t];
  if (!showAll) where.push(wanted.includes("paper_trail") ? `(t.seen = 0 OR t.bucket = 'paper_trail')` : `t.seen = 0`);
  // A search and the "with files" chip are answered here, over everything and not only the pages already fetched.
  const q = searchTerm((c.req.query("q") ?? "").trim());
  if (q) {
    const like = `%${q}%`;
    where.push(`(t.subject ILIKE ? OR t.custom_subject ILIKE ? OR t.snippet ILIKE ? OR t.participants_json ILIKE ?)`);
    params.push(like, like, like, like);
  }
  if (c.req.query("files") === "1") where.push(`EXISTS (SELECT 1 FROM attachments a WHERE a.thread_id = t.id AND a.is_inline = 0)`);
  // The next page starts after the last thread seen ("<time>:<id>"), not at a number, so marking threads done while paging cannot make it skip any.
  // A number in `page` still works for older links.
  const cursor = /^(\d{1,16}):(.{1,200})$/.exec(c.req.query("cursor") ?? "");
  const page = cursor ? 0 : pageParam(c.req.query("page"));
  if (cursor) {
    where.push(`(t.last_message_at < ? OR (t.last_message_at = ? AND t.id < ?))`);
    params.push(Number(cursor[1]), Number(cursor[1]), cursor[2]);
  }
  // The saved one-line summary comes along, so a card does not ask for its own.
  const rows = await db
    .prepare(
      `SELECT t.*, g.gist AS gist, g.message_id AS gist_message_id FROM threads t LEFT JOIN thread_gists g ON g.thread_id = t.id
       WHERE ${where.join(" AND ")} ORDER BY t.last_message_at DESC, t.id DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, FEED_PAGE + 1, page * FEED_PAGE)
    .all<ThreadRow & { gist: string | null; gist_message_id: string | null }>();
  const hasMore = rows.results.length > FEED_PAGE;
  const list = rows.results.slice(0, FEED_PAGE);
  const lastOne = list[list.length - 1];
  const summaries = await threadsWithLabels(db, list);
  const latest = new Map<string, MessageRow>();
  for (const ids of chunk(list.map((r) => r.id), 90)) {
    const ms = await db
      .prepare(
        `SELECT m.* FROM messages m WHERE m.thread_id IN (${placeholders(ids.length)}) AND m.date = (SELECT MAX(date) FROM messages x WHERE x.thread_id = m.thread_id)`
      )
      .bind(...ids)
      .all<MessageRow>();
    for (const m of ms.results) latest.set(m.thread_id, m);
  }
  // The files each thread carries, for the Paper Trail's shelf. Inline images are part of the message body, not files.
  const files = new Map<string, ReturnType<typeof toAttachment>[]>();
  for (const ids of chunk(list.map((r) => r.id), 90)) {
    const as = await db
      .prepare(
        `SELECT a.*, m.from_email, m.from_name FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.thread_id IN (${placeholders(ids.length)}) AND a.is_inline = 0 ORDER BY a.created_at ASC`
      )
      .bind(...ids)
      .all<AttachmentRow & { from_email: string; from_name: string }>();
    for (const a of as.results) {
      const subject = list.find((r) => r.id === a.thread_id);
      const arr = files.get(a.thread_id) ?? [];
      arr.push(toAttachment(a, { thread_subject: subject ? subject.custom_subject ?? subject.subject : "", from: { email: a.from_email, name: a.from_name } }));
      files.set(a.thread_id, arr);
    }
  }
  const threads = summaries.map((s) => {
    const m = latest.has(s.id) ? toMessage(latest.get(s.id)!) : null;
    if (m && m.from.email.toLowerCase() === s.last_from.email.toLowerCase() && s.last_from.avatar_url) m.from.avatar_url = s.last_from.avatar_url;
    const g = list.find((r) => r.id === s.id);
    return { ...s, latest_message: m, files: files.get(s.id) ?? [], gist: g?.gist && g.gist_message_id === m?.id ? g.gist : null };
  });
  return c.json({ threads, next_page: hasMore && !cursor ? page + 1 : null, next_cursor: hasMore && lastOne ? `${lastOne.last_message_at}:${lastOne.id}` : null });
});

export default lists;
