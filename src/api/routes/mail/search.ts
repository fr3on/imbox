import { Hono } from "hono";
import type { AppEnv } from "../../env";
import type { AttachmentRow, ContactRow } from "../../db";
import { threadsWithLabels, toAttachment } from "../../db";
import {
  contentWords,
  highlightTerms,
  isNaturalLanguage,
  parseSearch,
  relaxedTerms,
} from "@shared/searchQuery";
import { planRequest, queryFromPlan } from "@shared/searchPlan";
import { pageParam } from "../../input";
import { addFiles, addMatches, CONTACT_TEXT, commonTerms, searchThreads } from "../../search";
import { searchFacets } from "../../searchFacets";
import { mergeContacts } from "../contacts";
import { capTerms, MAX_QUERY, PAGE, scope } from "./shared";

const search = new Hono<AppEnv>();

// ---------- Search ----------
search.get("/search", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const sc = scope(c);
  const rawQ = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
  const page = pageParam(c.req.query("page"));
  const targetScope = c.req.query("scope") ?? "all";

  if (!rawQ) {
    return c.json({
      threads: [],
      contacts: [],
      files: [],
      events: [],
      counts: { threads: 0, contacts: 0, files: 0, events: 0, total: 0 },
      next_page: null,
      q: "",
    });
  }

  // A request in plain words ("unread mail from Harbor Bank about card payments last month") is read into words and filters first. The page
  // does that too, to show the filters as chips; this covers a request that arrives some other way. `exact` searches the words as typed.
  const exact = c.req.query("exact") === "1";
  const typed = parseSearch(rawQ);
  const asked = !exact && isNaturalLanguage(rawQ);
  let parsed = capTerms(
    asked ? parseSearch(typed.pieces.length ? contentWords(rawQ) || rawQ : queryFromPlan(planRequest(rawQ)) || rawQ).parsed : typed.parsed
  );
  // A request the page already read (it sends relax=1 with it) may still have more words than any one message holds: fall back to fewer.
  const mayRelax = asked || (!exact && c.req.query("relax") === "1");
  let relaxed = false;
  const sort = c.req.query("sort") === "newest" ? "newest" : "best";

  // 1. Threads query: every word somewhere in the conversation, best match first. Which words are common is asked once, and shared with the filters below.
  const common = await commonTerms(db, parsed);
  let found = await searchThreads(db, sc.sql, sc.params, parsed, { sort, page, pageSize: PAGE, common });
  // A question rarely has every one of its words in the answer: if nothing matches, look for fewer of them.
  if (mayRelax && !found.rows.length && parsed.terms.length > 1) {
    for (const terms of relaxedTerms(parsed.terms).slice(1)) {
      const again = await searchThreads(db, sc.sql, sc.params, { ...parsed, terms }, { sort, page, pageSize: PAGE, common });
      if (again.rows.length) {
        parsed = { ...parsed, terms };
        found = again;
        relaxed = true;
        break;
      }
    }
  }
  const usedTerms = highlightTerms(parsed);
  const words = parsed.terms;
  const rowsFor = async () => addFiles(db, found.rows.map((r) => r.id), await addMatches(db, found.rows, await threadsWithLabels(db, found.rows), parsed));

  // If paginating (page > 0), only query threads for speed
  if (page > 0) {
    return c.json({ threads: await rowsFor(), next_page: found.hasMore ? page + 1 : null, q: rawQ, terms: usedTerms, relaxed });
  }

  // 2. Contacts query
  const contactPromise = (async () => {
    if (targetScope !== "all" && targetScope !== "contacts") return [];
    try {
      if (!words.length) return [];
      const scContact = scope(c, "c");
      // One expression over the three columns, as the index is written (migration 0031), so a search reads the index and not every contact.
      const each = words.map(() => `(${CONTACT_TEXT("c")}) ILIKE ?`).join(" AND ");
      const rows = await db
        .prepare(`SELECT c.* FROM contacts c WHERE ${scContact.sql} AND ${each} ORDER BY c.last_seen_at DESC LIMIT 20`)
        .bind(...scContact.params, ...words.map((w) => `%${w}%`))
        .all<ContactRow>();
      return mergeContacts(rows.results).slice(0, 10);
    } catch {
      return [];
    }
  })();

  // 3. Files & Attachments query
  const filePromise = (async () => {
    if (targetScope !== "all" && targetScope !== "files") return [];
    try {
      if (!words.length && !parsed.filename && !parsed.from) return [];
      const scFile = scope(c, "a");
      const fileWhere: string[] = [];
      const fileParams: string[] = [];
      for (const w of words) {
        fileWhere.push("(a.filename ILIKE ? OR t.subject ILIKE ?)");
        fileParams.push(`%${w}%`, `%${w}%`);
      }
      if (parsed.filename) {
        fileWhere.push("a.filename ILIKE ?");
        fileParams.push(`%${parsed.filename}%`);
      }
      if (parsed.from) {
        fileWhere.push("(m.from_email ILIKE ? OR m.from_name ILIKE ?)");
        fileParams.push(`%${parsed.from}%`, `%${parsed.from}%`);
      }
      const rows = await db
        .prepare(
          `SELECT a.*, t.subject AS t_subject, t.custom_subject AS t_custom_subject, m.from_email, m.from_name
           FROM attachments a
           JOIN messages m ON m.id = a.message_id
           JOIN threads t ON t.id = a.thread_id
           WHERE ${scFile.sql} AND a.is_inline = 0 AND ${fileWhere.join(" AND ")}
           ORDER BY a.created_at DESC LIMIT 15`
        )
        .bind(...scFile.params, ...fileParams)
        .all<AttachmentRow & { t_subject: string; t_custom_subject: string | null; from_email: string; from_name: string }>();
      return rows.results.map((r) =>
        toAttachment(r, {
          thread_subject: r.t_custom_subject ?? r.t_subject,
          from: { email: r.from_email, name: r.from_name },
        })
      );
    } catch {
      return [];
    }
  })();

  // 4. Calendar Events query
  const eventPromise = (async () => {
    if (targetScope !== "all" && targetScope !== "events") return [];
    if (!words.length) return [];
    try {
      const rows = await db
        .prepare(
          `SELECT e.id, e.id AS event_id, e.calendar_id, e.kind, e.title, e.description, e.location, e.emoji,
                  e.all_day, e.starts_at, e.ends_at, e.start_date, e.end_date, e.timezone, e.rrule,
                  c.name AS calendar_name, c.color AS calendar_color, c.source, c.writable
           FROM events e
           JOIN calendars c ON c.id = e.calendar_id
           WHERE e.user_id = ? AND ${words.map(() => "(e.title ILIKE ? OR e.description ILIKE ? OR e.location ILIKE ?)").join(" AND ")}
           ORDER BY e.starts_at DESC LIMIT 10`
        )
        .bind(user.id, ...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]))
        .all<any>();
      return rows.results.map((r) => ({
        ...r,
        occurrence_date: null,
        recurring: !!r.rrule,
      }));
    } catch {
      return [];
    }
  })();

  const [threads, contacts, files, events, facets] = await Promise.all([
    rowsFor(),
    contactPromise,
    filePromise,
    eventPromise,
    searchFacets(db, sc.sql, sc.params, parsed, common).catch(() => null),
  ]);

  return c.json({
    threads,
    contacts,
    files,
    events,
    counts: {
      threads: threads.length,
      contacts: contacts.length,
      files: files.length,
      events: events.length,
      total: threads.length + contacts.length + files.length + events.length,
    },
    facets,
    next_page: found.hasMore ? page + 1 : null,
    q: rawQ,
    terms: usedTerms,
    relaxed,
  });
});

export default search;
