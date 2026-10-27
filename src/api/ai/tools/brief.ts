import { dayKey, gatherCandidates, gatherMeetings, loadBrief, rulesBrief, saveBrief } from "../brief";
import { userTimezone } from "../../timezone";
import { type SuggestedAction, actionsKey, findActions, loadFound, loadStates, saveFound } from "../actions";
import { type MessageRow, type UserRow, accountForThread } from "../../db";
import { catchUp, catchUpKey, loadCatchUp, saveCatchUp } from "../catchup";
import type { ChatDeps } from "../chat";
import { clockOf } from "../../calendar/dates";
import { loadThreadDetail } from "../../routes/mail";
import { loadAiConfig } from "../provider";
import { htmlToText } from "../../sanitize";
import { type Handler, shim, text } from "./context";

export const get_daily_brief: Handler = async ({ ctx, db, ok }) => {
  const tz = await userTimezone(db, ctx.user.id);
  const day = dayKey(tz);
  let brief = await loadBrief(db, ctx.user.id, day);
  if (!brief) {
    const [candidates, meetings] = await Promise.all([
      gatherCandidates(db, ctx.user.id),
      gatherMeetings(ctx.env, ctx.user.id, day, tz),
    ]);
    brief = rulesBrief(day, candidates, meetings);
    await saveBrief(db, ctx.user.id, brief).catch(() => {});
  }
  const meetings = (brief.meetings ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    all_day: m.all_day,
    time: m.all_day ? "All day" : `${clockOf(m.starts_at, tz)} – ${clockOf(m.ends_at, tz)}`,
    location: m.location || undefined,
    join_url: m.join_url || undefined,
  }));
  return ok(
    {
      day: brief.day,
      headline: brief.headline,
      items: brief.items.map((it) => ({
        thread_id: it.thread_id,
        subject: it.subject,
        from: it.from_name ? `${it.from_name} <${it.from_email}>` : it.from_email,
        kind: it.kind,
        why: it.why,
        urgent: it.urgent,
        age_days: it.age_days,
      })),
      meetings,
      source: brief.source,
    },
    `Daily Brief for ${brief.day}: ${brief.items.length} item${brief.items.length === 1 ? "" : "s"}, ${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`
  );
};

export const catch_up_thread: Handler = async ({ ctx, input, db, ok, fail }) => {
  let threadId = text(input.thread_id);
  if (!threadId) threadId = ctx.threadHints?.[0] ?? "";
  if (!threadId) {
    return fail("No thread specified. Provide thread_id or ask about an attached thread.");
  }
  const acc = await accountForThread(db, ctx.user.id, threadId);
  if (!acc) return fail("Thread not found");
  const detail = await loadThreadDetail(shim(ctx, acc), threadId);
  if (!detail?.messages.length) return fail("Thread messages not found");

  ctx.threadHints = [threadId, ...(ctx.threadHints ?? []).filter((x) => x !== threadId)];
  const msgs = detail.messages;
  const recent = input.recent !== false;
  const freshMsgs = msgs.slice(-5);
  const freshIds = freshMsgs.map((m) => m.id);
  const key = catchUpKey(freshMsgs, recent);
  let caught = key ? await loadCatchUp(db, threadId, key) : null;

  if (!caught) {
    const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(ctx.user.id).first<UserRow>();
    const cfg = await loadAiConfig(ctx.env, ctx.user.id);
    if (cfg && userRow) {
      const d: ChatDeps = { env: ctx.env, user: userRow, accounts: ctx.accounts, cfg };
      caught = await catchUp(d, detail.subject, msgs, freshIds, recent, acc.email);
      if (caught && key) {
        await saveCatchUp(db, threadId, key, caught).catch(() => {});
      }
    }
  }

  if (!caught) {
    const lastMsgs = msgs.slice(-3);
    const changes = lastMsgs.map((m) => `${m.from.name || m.from.email}: ${(m.text_body || htmlToText(m.html_body || "")).slice(0, 140)}`);
    const last = lastMsgs[lastMsgs.length - 1];
    const ask = last && !last.is_from_me ? `Awaiting response to ${last.from.name || last.from.email}` : "";
    caught = { changes, ask, new_count: lastMsgs.length };
  }

  return ok(
    { thread_id: threadId, subject: detail.subject, changes: caught.changes, ask: caught.ask, new_count: caught.new_count },
    `Caught up on “${detail.subject}”`
  );
};

export const find_thread_actions: Handler = async ({ ctx, input, db, ok, fail }) => {
  let threadId = text(input.thread_id);
  if (!threadId && ctx.threadHints?.[0]) threadId = ctx.threadHints[0];
  const filterKind = typeof input.kind === "string" && ["deadline", "task", "event"].includes(input.kind) ? input.kind : null;

  if (threadId) {
    const acc = await accountForThread(db, ctx.user.id, threadId);
    if (!acc) return fail("Thread not found");
    const detail = await loadThreadDetail(shim(ctx, acc), threadId);
    if (!detail) return fail("Thread not found");

    const msgs = detail.messages;
    const key = actionsKey(msgs);
    let found = key ? await loadFound(db, threadId, key) : null;

    const tz = await userTimezone(db, ctx.user.id);
    const today = dayKey(tz);

    if (!found) {
      const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(ctx.user.id).first<UserRow>();
      const cfg = await loadAiConfig(ctx.env, ctx.user.id);
      if (cfg && userRow) {
        const d: ChatDeps = { env: ctx.env, user: userRow, accounts: ctx.accounts, cfg };
        const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(new Date());
        const evs = await db.prepare(`SELECT starts_at, start_date FROM events WHERE thread_id = ? AND status <> 'cancelled'`).bind(threadId).all<{ starts_at: number; start_date: string | null }>();
        const existing = new Set(evs.results.map((e) => e.start_date ?? dayKey(tz, e.starts_at)));
        found = await findActions(d, msgs, today, weekday, tz, existing);
        if (key) await saveFound(db, threadId, key, found).catch(() => {});
      } else {
        found = { actions: [], overview: null };
      }
    }

    const states = await loadStates(db, threadId);
    let actions = (found?.actions ?? []).filter((a) => !states.has(a.id) && (!a.when || a.when.ends_at >= Date.now()));
    if (filterKind) actions = actions.filter((a) => a.kind === filterKind);

    return ok(
      { thread_id: threadId, subject: detail.subject, actions, overview: found?.overview },
      `Found ${actions.length} action${actions.length === 1 ? "" : "s"} in “${detail.subject}”`
    );
  }

  // No thread specified: find actions across active candidate threads
  const candidates = await gatherCandidates(db, ctx.user.id);
  const allFoundActions: { thread_id: string; subject: string; action: SuggestedAction }[] = [];

  for (const cand of candidates.slice(0, 10)) {
    const rows = await db.prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC LIMIT 10").bind(cand.thread_id).all<MessageRow>();
    const msgs = rows.results.map((m) => ({
      id: m.id,
      text_body: m.text_body,
      html_body: m.html_body,
      is_from_me: !!m.is_from_me,
      date: m.date,
      from_email: m.from_email,
      from_name: m.from_name,
    }));
    const key = actionsKey(msgs as any);
    if (!key) continue;
    const found = await loadFound(db, cand.thread_id, key);
    if (found) {
      const states = await loadStates(db, cand.thread_id);
      for (const a of found.actions) {
        if (!states.has(a.id) && (!a.when || a.when.ends_at >= Date.now())) {
          if (!filterKind || a.kind === filterKind) {
            allFoundActions.push({ thread_id: cand.thread_id, subject: cand.subject, action: a });
          }
        }
      }
    }
  }

  return ok(
    { actions: allFoundActions, count: allFoundActions.length },
    `Found ${allFoundActions.length} action${allFoundActions.length === 1 ? "" : "s"} across active threads`
  );
};
