import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { accountForThread, now, safeJson, uid } from "../../db";
import type { UserSettings } from "@shared/types";
import { MIN_COMPLETE_CHARS } from "@shared/aiFeatures";
import { isId } from "../../input";
import { requireAccount } from "../../auth";
import { actionsKey, afterYourReply, findActions, loadFound, loadStates, looksActionable, looksUrgent, PHISH_OK, saveFound, setState } from "../../ai/actions";
import { lastSenderOf, recordVerdict } from "../../phish";
import { logActivity } from "../../activity";
import { dayKey } from "../../ai/brief";
import { userTimezone } from "../../timezone";
import { catchUp, catchUpKey, loadCatchUp, saveCatchUp, splitThread } from "../../ai/catchup";
import { generateReply, nameConversation, runChatTurn, summarizeThread, threadToText, type ChatDeps, type ReplyTone, type SseEvent } from "../../ai/chat";
import { loadSuggestions as loadReviewSuggestions, pendingReviews, runReviews, setReviewState } from "../../ai/contactreview";
import { screenerAiEnabled } from "../../ai/screener";
import { deleteSummary, loadSummary, saveSummary } from "../../ai/summaries";
import { gistOf, loadGist, saveGist } from "../../ai/gist";
import { answerFromMail } from "../../ai/searchanswer";
import { planWithAi } from "../../ai/searchplan";
import { AiNotConfigured, describeApiError, loadAiConfig, loadAiSettings } from "../../ai/provider";
import { continueReply, MAX_BEFORE, MAX_CONTEXT } from "../../ai/complete";
import { deps, threadForAi, userAccounts } from "./shared";

const chat = new Hono<AppEnv>();

// This router is mounted without the account scope the mail routes get, and the answer to a search is drawn from the mailboxes in scope.
chat.use("/search-answer", requireAccount);

/* ---------- chat (SSE) ---------- */

chat.post("/chat", async (c) => {
  const b = await c.req.json<{ conversation_id?: string; message?: string; context_thread_ids?: string[] }>().catch(() => ({}) as any);
  const text = String(b.message ?? "").trim().slice(0, 20_000);
  if (!text) return c.json({ error: "message_required" }, 400);
  let d: ChatDeps;
  try {
    d = await deps(c);
  } catch (e) {
    return c.json({ error: describeApiError(e), code: "ai_not_configured" }, 400);
  }
  // Attached threads → compact context blocks (subject, participants, last 3 messages), max 3 threads.
  const contextBlocks: string[] = [];
  const ctxIds: string[] = Array.isArray(b.context_thread_ids) ? (b.context_thread_ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3) : [];
  for (const tid of ctxIds) {
    const t = await threadForAi(c, d, tid).catch(() => null);
    if (!t) continue;
    const people = t.detail.participants.map((p) => (p.name ? `${p.name} <${p.email}>` : p.email)).join(", ");
    const lastFrom = t.detail.last_from.name || t.detail.last_from.email;
    const body = threadToText(t.detail.messages.slice(-3), 2000, 3);
    contextBlocks.push(`[[context thread=${tid}]] Subject: ${t.detail.subject || "(no subject)"} · From: ${lastFrom}\nParticipants: ${people}\nAccount: ${t.acc.email}\n\n${body}`);
  }
  let convId = typeof b.conversation_id === "string" ? b.conversation_id : "";
  if (convId) {
    const own = await c.env.DB.prepare(`SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?`).bind(convId, d.user.id).first();
    if (!own) convId = "";
  }
  let isNew = false;
  if (!convId) {
    isNew = true;
    convId = uid();
    await c.env.DB.prepare(`INSERT INTO ai_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(convId, d.user.id, text.slice(0, 60), now(), now()).run();
  } else {
    await c.env.DB.prepare(`UPDATE ai_conversations SET title = CASE WHEN title = '' THEN ? ELSE title END WHERE id = ?`).bind(text.slice(0, 60), convId).run();
  }

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;
  const send = async (e: SseEvent) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
    } catch {
      closed = true;
    }
  };
  const abort = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abort.abort());
  const run = (async () => {
    await send({ type: "start", conversation_id: convId });
    await runChatTurn(d, convId, text, send, abort.signal, contextBlocks);
    closed = true;
    try {
      await writer.close();
    } catch { }
    // The reply is out; now a short name for a new chat.
    if (isNew) await nameConversation(d, convId, text);
  })();
  c.executionCtx.waitUntil(run);
  return new Response(readable, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", "x-conversation-id": convId } });
});

/* ---------- reply / summarize ---------- */

chat.post("/reply", async (c) => {
  const b = await c.req.json<{ thread_id?: string; brief?: string; tone?: ReplyTone }>().catch(() => ({}) as any);
  const brief = typeof b.brief === "string" ? b.brief.trim().slice(0, 2000) : "";
  if (!isId(b.thread_id) || !brief) return c.json({ error: "thread_id and brief are required" }, 400);
  try {
    const d = await deps(c);
    const t = await threadForAi(c, d, b.thread_id);
    if (!t) return c.json({ error: "not_found" }, 404);
    const last = [...t.detail.messages].reverse().find((m) => !m.is_from_me) ?? t.detail.messages[t.detail.messages.length - 1];
    const tone: ReplyTone = ["match", "formal", "friendly", "brief"].includes(String(b.tone)) ? (b.tone as ReplyTone) : "match";
    const r = await generateReply(d, threadToText(t.detail.messages), brief, tone, { subject: t.detail.subject, to: last ? `${last.from.name} <${last.from.email}>` : "", myEmail: t.acc.email });
    return c.json({ ...r, reply_to_message_id: last?.id ?? null });
  } catch (e) {
    return c.json({ error: describeApiError(e) }, e instanceof AiNotConfigured ? 400 : 502);
  }
});

// The grey words offered while typing a reply. Asked often, so it answers quietly with nothing for anything that is not a clear yes:
// the switch is off, there is no AI, the text is too short to go on, or the model could not tell what comes next.
chat.post("/complete", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<{ before?: unknown; context?: unknown; subject?: unknown; to?: unknown }>().catch(() => ({}) as any);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const before = str(b.before, MAX_BEFORE * 2).slice(-MAX_BEFORE);
  if (before.trim().length < MIN_COMPLETE_CHARS) return c.json({ text: "" });
  if (safeJson<UserSettings>(user.settings_json, {}).aiComplete !== true) return c.json({ text: "" });
  try {
    const cfg = await loadAiConfig(c.env, user.id);
    if (!cfg) return c.json({ text: "" });
    const text = await continueReply(c.env, user.id, cfg, { before, context: str(b.context, MAX_CONTEXT * 2), subject: str(b.subject, 200), to: str(b.to, 200), name: user.name || "" });
    return c.json({ text });
  } catch (e) {
    console.error("completion failed", (e as Error).message);
    return c.json({ text: "" });
  }
});

chat.post("/summarize", async (c) => {
  const b = await c.req.json<{ thread_id?: string }>().catch(() => ({}) as any);
  if (!isId(b.thread_id)) return c.json({ error: "thread_id required" }, 400);
  try {
    const d = await deps(c);
    const t = await threadForAi(c, d, b.thread_id);
    if (!t) return c.json({ error: "not_found" }, 404);
    const summary = await summarizeThread(d, threadToText(t.detail.messages), t.detail.subject);
    // Kept, so the thread shows it again next time without another model call.
    await saveSummary(c.env.DB, t.acc.id, b.thread_id, summary, t.detail.messages.length).catch(() => { });
    return c.json({ summary, stale: false, saved_at: Date.now() });
  } catch (e) {
    return c.json({ error: describeApiError(e) }, e instanceof AiNotConfigured ? 400 : 502);
  }
});

// The one line under a card in the Imbox. Cached per message; with no AI set up it answers quietly with nothing, so the page keeps
// showing the cleaned-up text instead.
/** The one line for a thread: the saved one, or written now. Null when there is none to give (no AI, nothing readable). */
async function gistForThread(c: any, d: Awaited<ReturnType<typeof deps>>, threadId: string): Promise<{ gist: string | null; cached?: boolean } | "not_found"> {
  const t = await threadForAi(c, d, threadId);
  if (!t) return "not_found";
  const last = [...t.detail.messages].reverse().find((m) => !m.is_from_me) ?? t.detail.messages[t.detail.messages.length - 1];
  if (!last) return { gist: null };
  const saved = await loadGist(c.env.DB, threadId, last.id);
  if (saved) return { gist: saved, cached: true };
  const gist = await gistOf(d, last, t.detail.subject, last.from.name ? `${last.from.name} <${last.from.email}>` : last.from.email);
  if (!gist) return { gist: null };
  await saveGist(c.env.DB, threadId, last.id, gist).catch(() => {});
  return { gist, cached: false };
}

chat.post("/gist", async (c) => {
  const b = await c.req.json<{ thread_id?: string }>().catch(() => ({}) as any);
  if (!isId(b.thread_id)) return c.json({ error: "thread_id required" }, 400);
  try {
    const r = await gistForThread(c, await deps(c), b.thread_id);
    if (r === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json(r.gist ? r : { gist: null });
  } catch (e) {
    if (e instanceof AiNotConfigured) return c.json({ gist: null, off: true });
    return c.json({ gist: null, error: describeApiError(e) });
  }
});

// The lines for a page of cards in one request: the ones that are missing are written here, one after the other and a few at a time, so opening
// the Updates page is one call and not one per newsletter. The answer holds the lines it has; a thread with none is left out.
const MAX_GISTS = 6;
chat.post("/gists", async (c) => {
  const b = await c.req.json<{ thread_ids?: unknown }>().catch(() => ({}) as any);
  const ids: string[] = Array.isArray(b.thread_ids) ? [...new Set((b.thread_ids as unknown[]).filter(isId))].slice(0, MAX_GISTS) : [];
  if (!ids.length) return c.json({ gists: {} });
  try {
    const d = await deps(c);
    const gists: Record<string, string> = {};
    for (const id of ids) {
      const r = await gistForThread(c, d, id);
      if (r !== "not_found" && r.gist) gists[id] = r.gist;
    }
    return c.json({ gists });
  } catch (e) {
    if (e instanceof AiNotConfigured) return c.json({ gists: {}, off: true });
    return c.json({ gists: {}, error: describeApiError(e) });
  }
});

// A short answer to a question typed into search, or (mode "overview") a summary of what the current results hold. With no AI set up it
// answers quietly with `off`, so the page just shows results.
chat.post("/search-answer", async (c) => {
  const b = await c.req.json<{ q?: string; search?: string; mode?: string; relaxed?: boolean }>().catch(() => ({}) as any);
  const q = typeof b.q === "string" ? b.q.trim().slice(0, 300) : "";
  if (!q) return c.json({ error: "q required" }, 400);
  try {
    const d = await deps(c);
    const out = await answerFromMail(d, c.get("accountIds") ?? [], q, { overview: b.mode === "overview", relaxed: b.relaxed === true, search: typeof b.search === "string" ? b.search.trim().slice(0, 300) : "" });
    return c.json(out ?? { answer: "", sources: [] });
  } catch (e) {
    if (e instanceof AiNotConfigured) return c.json({ off: true, answer: "", sources: [] });
    return c.json({ answer: "", sources: [], error: describeApiError(e) });
  }
});

// A request in plain words read into filters. Quiet when AI is off or the reading fails: the page then reads it with its own rules.
chat.post("/search-plan", async (c) => {
  const b = await c.req.json<{ q?: string }>().catch(() => ({}) as any);
  const q = typeof b.q === "string" ? b.q.trim().slice(0, 300) : "";
  if (!q) return c.json({ error: "q required" }, 400);
  try {
    const d = await deps(c);
    return c.json({ plan: await planWithAi(d, q) });
  } catch (e) {
    if (e instanceof AiNotConfigured) return c.json({ plan: null, off: true });
    return c.json({ plan: null, error: describeApiError(e) });
  }
});

// Catch me up: what changed in the messages that arrived since the thread was last read. Saved per set of new messages.
chat.post("/catchup", async (c) => {
  const b = await c.req.json<{ thread_id?: string; message_ids?: unknown; recent?: boolean }>().catch(() => ({}) as any);
  const recent = b.recent === true;
  const rawIds = Array.isArray(b.message_ids) ? b.message_ids : [];
  const ids = Array.from(new Set<string>(rawIds.filter((x: unknown): x is string => typeof x === "string"))).slice(0, 50);
  if (!isId(b.thread_id) || !ids.length) return c.json({ error: "thread_id and message_ids are required" }, 400);
  try {
    const d = await deps(c);
    const t = await threadForAi(c, d, b.thread_id);
    if (!t) return c.json({ error: "not_found" }, 404);
    const { fresh } = splitThread(t.detail.messages, ids);
    if (!fresh.length) return c.json({ error: "no_new_messages" }, 400);
    const key = catchUpKey(fresh, recent);
    const saved = await loadCatchUp(c.env.DB, b.thread_id, key);
    if (saved) return c.json({ ...saved, cached: true });
    const result = await catchUp(d, t.detail.subject, t.detail.messages, ids, recent, t.acc.email);
    if (!result) return c.json({ changes: [], ask: "", new_count: fresh.length, cached: false });
    await saveCatchUp(c.env.DB, b.thread_id, key, result).catch(() => { });
    return c.json({ ...result, cached: false });
  } catch (e) {
    return c.json({ error: describeApiError(e) }, e instanceof AiNotConfigured ? 400 : 502);
  }
});

// Actions in a thread: a meeting proposed in plain words, a deadline, something you are asked to do. Suggestions only; the reader
// decides. Worked out once per latest incoming message and kept, and only for mail that could hold one.
chat.post("/actions", async (c) => {
  const b = await c.req.json<{ thread_id?: string }>().catch(() => ({}) as any);
  if (!isId(b.thread_id)) return c.json({ error: "thread_id required" }, 400);
  try {
    const user = c.get("user");
    const settings = await loadAiSettings(c.env, user.id);
    if (settings && settings.suggest_actions === 0) return c.json({ actions: [], disabled: true });
    const d = await deps(c);
    const t = await threadForAi(c, d, b.thread_id);
    if (!t) return c.json({ error: "not_found" }, 404);
    // Newsletters and the Screener are not where a person's asks and appointments live. The Paper Trail is mostly noise too, except for
    // the notice that demands something: a deadline, a dispute, a payment problem.
    const inPaperTrail = t.detail.bucket === "paper_trail";
    if (t.detail.bucket !== "imbox" && !t.detail.reply_later && !inPaperTrail) return c.json({ actions: [], overview: null });
    const msgs = t.detail.messages;
    const key = actionsKey(msgs);
    if (!key) return c.json({ actions: [], overview: null });
    let found = await loadFound(c.env.DB, b.thread_id, key);
    const tz = await userTimezone(c.env.DB, user.id);
    const today = dayKey(tz);
    if (!found) {
      if (inPaperTrail && !t.detail.reply_later ? !looksUrgent(msgs) : !looksActionable(msgs)) {
        found = { actions: [], overview: null };
      } else {
        const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz }).format(new Date());
        const evs = await c.env.DB.prepare(`SELECT starts_at, start_date FROM events WHERE thread_id = ? AND status <> 'cancelled'`).bind(b.thread_id).all<{ starts_at: number; start_date: string | null }>();
        const existing = new Set(evs.results.map((e) => e.start_date ?? dayKey(tz, e.starts_at)));
        found = await findActions(d, msgs, today, weekday, tz, existing);
      }
      await saveFound(c.env.DB, b.thread_id, key, found).catch(() => { });
    }
    found = afterYourReply(found, msgs);
    const states = await loadStates(c.env.DB, b.thread_id);
    // A saved suggestion for a day that has since passed is no longer worth showing.
    const ov = found.overview && !states.has(found.overview.id) ? found.overview : null;
    return c.json({ actions: found.actions.filter((a) => !states.has(a.id) && (!a.when || a.when.ends_at >= Date.now())), overview: ov });
  } catch (e) {
    return c.json({ error: describeApiError(e) }, e instanceof AiNotConfigured ? 400 : 502);
  }
});

// A second look at senders you have already sorted: mail filed somewhere it does not fit. Suggestions only; the Contacts page offers the move.
// Worked out in the background, a batch at a time, and only for senders that have not been looked at lately.
chat.get("/contact-review", async (c) => {
  const user = c.get("user");
  const enabled = await screenerAiEnabled(c.env, user.id);
  if (!enabled) return c.json({ suggestions: [], pending: false, enabled: false });
  const accounts = await userAccounts(c);
  const due = await pendingReviews(c.env.DB, user.id, accounts.map((a) => a.id));
  if (due.length) {
    const job = runReviews(c.env, user.id, due);
    try {
      c.executionCtx.waitUntil(job);
    } catch {
      void job.catch(() => { });
    }
  }
  return c.json({ suggestions: await loadReviewSuggestions(c.env.DB, user.id), pending: due.length > 0, enabled: true });
});

chat.post("/contact-review/state", async (c) => {
  const b = await c.req.json<{ email?: string; state?: string }>().catch(() => ({}) as any);
  if (typeof b.email !== "string" || !b.email || (b.state !== "dismissed" && b.state !== "applied")) return c.json({ error: "email and state are required" }, 400);
  await setReviewState(c.env.DB, c.get("user").id, b.email.slice(0, 320), b.state);
  return c.json({ ok: true });
});

chat.post("/actions/state", async (c) => {
  const b = await c.req.json<{ thread_id?: string; action_id?: string; state?: string }>().catch(() => ({}) as any);
  if (!isId(b.thread_id) || !isId(b.action_id) || (b.state !== "done" && b.state !== "dismissed")) return c.json({ error: "thread_id, action_id and state are required" }, 400);
  if (!(await accountForThread(c.env.DB, c.get("user").id, b.thread_id))) return c.json({ error: "not_found" }, 404);
  await setState(c.env.DB, b.thread_id, String(b.action_id).slice(0, 40), b.state);
  // "Looks fine" on a phishing warning is remembered for that sender, so the warning does not come back with their next message.
  if (b.action_id === PHISH_OK && b.state === "done") {
    const sender = await lastSenderOf(c.env.DB, b.thread_id);
    if (sender) {
      await recordVerdict(c.env.DB, c.get("user").id, sender, "ok");
      await logActivity(c.env.DB, c.get("user").id, { actor: "you", kind: "looks_fine", summary: `Marked ${sender} as fine`, why: "The phishing warning will not come back for them", threadId: b.thread_id });
    }
  }
  return c.json({ ok: true });
});

/** The saved summary, if there is one. Never calls the model. */
chat.get("/summary/:threadId", async (c) => {
  const user = c.get("user");
  const threadId = c.req.param("threadId");
  if (!(await accountForThread(c.env.DB, user.id, threadId))) return c.json({ error: "not_found" }, 404);
  return c.json((await loadSummary(c.env.DB, threadId)) ?? { summary: null });
});

chat.delete("/summary/:threadId", async (c) => {
  const user = c.get("user");
  const threadId = c.req.param("threadId");
  if (!(await accountForThread(c.env.DB, user.id, threadId))) return c.json({ error: "not_found" }, 404);
  await deleteSummary(c.env.DB, threadId);
  return c.json({ ok: true });
});

export default chat;
