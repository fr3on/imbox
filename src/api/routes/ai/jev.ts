import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { accountForThread, safeJson } from "../../db";
import { logActivity } from "../../activity";
import { isId } from "../../input";
import { JEV_PHISHING_FROM } from "@shared/phishing";
import { JEV_CAPABILITIES, JEV_MODEL, JevError, jevPhishing, jevSamples, jevThreadChecks, jevUsage, loadJev, recordJevCall, saveJev, type JevFeature } from "../../ai/jev";

const jev = new Hono<AppEnv>();

async function describe(c: { env: AppEnv["Bindings"]; get: (k: "user") => { id: string } }) {
  const userId = c.get("user").id;
  const [s, usage] = await Promise.all([loadJev(c.env as any, userId), jevUsage(c.env.DB, userId)]);
  return {
    configured: !!s.key,
    enabled: s.enabled,
    key_hint: s.hint,
    model: JEV_MODEL,
    capabilities: JEV_CAPABILITIES.map((cap) => ({ ...cap, enabled: s.enabled && s.features[cap.id] !== false, calls_30d: usage[cap.id].calls, last_at: usage[cap.id].last })),
  };
}

// Whether Jev is set up, and what it is used for. The key itself never leaves the server; only a short hint of it does.
jev.get("/jev", async (c) => c.json(await describe(c as any), 200, { "cache-control": "private, no-store" }));

jev.put("/jev", async (c) => {
  const b = await c.req.json<{ enabled?: boolean; api_key?: string | null; features?: Partial<Record<JevFeature, boolean>> }>().catch(() => ({}) as any);
  const patch: Parameters<typeof saveJev>[2] = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (b.api_key === null) patch.apiKey = null;
  else if (typeof b.api_key === "string" && b.api_key.trim()) {
    const k = b.api_key.trim();
    if (k.length < 8 || k.length > 2000) return c.json({ error: "invalid_key", message: "That does not look like a TypeSafe key." }, 400);
    patch.apiKey = k;
  }
  if (b.features && typeof b.features === "object") {
    patch.features = {};
    for (const cap of JEV_CAPABILITIES) if (typeof b.features[cap.id] === "boolean") patch.features[cap.id] = b.features[cap.id];
  }
  if (patch.enabled === true && !patch.apiKey && !(await loadJev(c.env, c.get("user").id)).key) return c.json({ error: "key_required", message: "Add your TypeSafe key first." }, 400);
  try {
    await saveJev(c.env, c.get("user").id, patch);
  } catch (e) {
    console.error("saving the Jev settings failed", e);
    return c.json({ error: "save_failed", message: "The key could not be saved." }, 500);
  }
  return c.json(await describe(c as any));
});

// Runs one invented example of each decision with the key (a typed one, else the saved one), so what Jev answers and how fast can be seen. None of the
// owner's mail is sent.
jev.post("/jev/test", async (c) => {
  const b = await c.req.json<{ api_key?: string }>().catch(() => ({}) as any);
  const typed = typeof b.api_key === "string" ? b.api_key.trim() : "";
  const key = typed || (await loadJev(c.env, c.get("user").id)).key;
  if (!key) return c.json({ ok: false, error: "key_required", message: "Add your TypeSafe key first." }, 400);
  try {
    return c.json({ ok: true, model: JEV_MODEL, samples: await jevSamples(c.env, key) });
  } catch (e) {
    return c.json({ ok: false, error: "jev_failed", message: e instanceof JevError ? e.message : "The test could not be run." }, 400);
  }
});

// Jev's view of one message, for the warning banner. Asked once per message and kept. A message from someone already let in is not asked about.
jev.post("/jev/phishing", async (c) => {
  const userId = c.get("user").id;
  const b = await c.req.json<{ thread_id?: string }>().catch(() => ({}) as any);
  if (!isId(b.thread_id)) return c.json({ error: "thread_id is required" }, 400);
  const account = await accountForThread(c.env.DB, userId, b.thread_id);
  if (!account) return c.json({ error: "not_found" }, 404);
  const key = (await loadJev(c.env, userId));
  if (!key.enabled || key.features.phishing === false) return c.json({ enabled: false });
  const m = await c.env.DB
    .prepare(`SELECT id, from_email, from_name, reply_to, subject, text_body, html_body, to_json, auth_results FROM messages WHERE thread_id = ? AND account_id = ? AND is_from_me = 0 ORDER BY date DESC LIMIT 1`)
    .bind(b.thread_id, account.id)
    .first<{ id: string; from_email: string; from_name: string; reply_to: string; subject: string; text_body: string; html_body: string; to_json: string; auth_results: string }>();
  if (!m) return c.json({ enabled: true, skipped: "no_message" });
  const known = await c.env.DB.prepare(`SELECT screen_status FROM contacts WHERE account_id = ? AND lower(email) = ?`).bind(account.id, m.from_email.toLowerCase()).first<{ screen_status: string }>();
  if (known?.screen_status === "imbox") return c.json({ enabled: true, skipped: "known" });
  const kept = await c.env.DB.prepare(`SELECT probability, pressure FROM jev_checks WHERE user_id = ? AND message_id = ? AND kind = 'phishing'`).bind(userId, m.id).first<{ probability: number; pressure: number }>();
  if (kept) return c.json({ enabled: true, probability: kept.probability, pressure: kept.pressure, cached: true });
  try {
    const toDomains = safeJson<{ email: string }[]>(m.to_json, []).map((a) => a.email.split("@").pop()?.toLowerCase() ?? "").filter(Boolean);
    const v = await jevPhishing(c.env, key.key, { fromName: m.from_name, fromEmail: m.from_email, replyTo: m.reply_to, subject: m.subject, text: m.text_body, html: m.html_body, auth: m.auth_results, toDomains });
    await c.env.DB
      .prepare(`INSERT INTO jev_checks (user_id, message_id, kind, probability, pressure, model, created_at) VALUES (?, ?, 'phishing', ?, ?, ?, ?) ON CONFLICT(user_id, message_id, kind) DO NOTHING`)
      .bind(userId, m.id, v.probability, v.pressure, v.model, Date.now())
      .run();
    await recordJevCall(c.env.DB, userId, "jev_phishing", v);
    if (v.probability >= JEV_PHISHING_FROM) {
      await logActivity(c.env.DB, userId, { actor: "ai", kind: "phishing_check", summary: `Rated “${m.subject || "(no subject)"}” ${Math.round(v.probability * 100)}% likely phishing`, why: `Jev, pressure ${Math.round(v.pressure * 100)}%. A warning is shown on the message.`, threadId: b.thread_id, accountId: account.id, level: "warn" });
    }
    return c.json({ enabled: true, probability: v.probability, pressure: v.pressure });
  } catch (e) {
    await recordJevCall(c.env.DB, userId, "jev_phishing", null);
    return c.json({ enabled: true, error: e instanceof JevError ? e.message : "The check could not be run." });
  }
});

// Quick checks on one message a person picked: a set of questions answered in one call. Always asked fresh; nothing is kept, and it does not matter where the
// thread is or whether the sender was let in.
jev.post("/jev/checks", async (c) => {
  const userId = c.get("user").id;
  const b = await c.req.json<{ thread_id?: string }>().catch(() => ({}) as any);
  if (!isId(b.thread_id)) return c.json({ error: "thread_id is required" }, 400);
  const account = await accountForThread(c.env.DB, userId, b.thread_id);
  if (!account) return c.json({ error: "not_found" }, 404);
  const st = await loadJev(c.env, userId);
  if (!st.enabled || st.features.checks === false) return c.json({ enabled: false, configured: !!st.key });
  const m = await c.env.DB
    .prepare(`SELECT from_email, from_name, reply_to, subject, text_body, html_body, to_json, auth_results FROM messages WHERE thread_id = ? AND account_id = ? AND is_from_me = 0 ORDER BY date DESC LIMIT 1`)
    .bind(b.thread_id, account.id)
    .first<{ from_email: string; from_name: string; reply_to: string; subject: string; text_body: string; html_body: string; to_json: string; auth_results: string }>();
  if (!m) return c.json({ enabled: true, error: "There is no message from anyone else in this conversation to check." });
  try {
    const toDomains = safeJson<{ email: string }[]>(m.to_json, []).map((a) => a.email.split("@").pop()?.toLowerCase() ?? "").filter(Boolean);
    const r = await jevThreadChecks(c.env, st.key, { fromName: m.from_name, fromEmail: m.from_email, replyTo: m.reply_to, subject: m.subject, text: m.text_body, html: m.html_body, auth: m.auth_results, toDomains });
    await recordJevCall(c.env.DB, userId, "jev_checks", r);
    await logActivity(c.env.DB, userId, { actor: "you", kind: "jev_checks", summary: `Ran quick checks on \u201c${m.subject || "(no subject)"}\u201d`, why: "Answered by Jev", threadId: b.thread_id, accountId: account.id });
    return c.json({ enabled: true, checks: r.checks, model: r.model, ms: r.ms, tokens: r.usage.input_tokens + r.usage.output_tokens });
  } catch (e) {
    await recordJevCall(c.env.DB, userId, "jev_checks", null);
    return c.json({ enabled: true, error: e instanceof JevError ? e.message : "The checks could not be run." });
  }
});

export default jev;
