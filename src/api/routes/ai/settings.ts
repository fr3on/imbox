import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { now } from "../../db";
import { checkProvider, summarizeCheck } from "../../ai/check";
import { decryptSecret, encryptSecret } from "../../ai/crypto";
import { describeApiError, loadAiSettings, makeProvider, MOCK_PRESET, presetById, presetUrl, PRESETS } from "../../ai/provider";
import { getSessionSecret } from "../../secrets";
import { deps } from "./shared";

const settings = new Hono<AppEnv>();

settings.get("/settings", async (c) => {
  const user = c.get("user");
  const row = await loadAiSettings(c.env, user.id);
  const state = await c.env.DB.prepare(`SELECT last_learned_at FROM ai_learning_state WHERE user_id = ?`).bind(user.id).first<{ last_learned_at: number | null }>();
  const preset = presetById(row?.preset ?? "anthropic");
  const mockOk = c.env.AI_MOCK === "1";
  const configured = !!row && (preset.kind === "mock" ? mockOk : preset.kind === "anthropic" ? !!row.api_key_enc : preset.editable_url ? !!(row.base_url || preset.base_url) : true);
  return c.json({
    configured,
    provider: preset.kind,
    preset: preset.id,
    base_url: presetUrl(preset, row?.base_url),
    key_hint: row?.key_hint ?? "",
    model: row?.model || preset.default_model,
    learn: row ? !!row.learn : true,
    auto_send: row ? !!row.auto_send : false,
    screener_suggest: row ? !!row.screener_suggest : true,
    daily_brief: row ? !!row.daily_brief : true,
    suggest_actions: row ? !!row.suggest_actions : true,
    presets: mockOk ? [...PRESETS, MOCK_PRESET] : PRESETS,
    last_learned_at: state?.last_learned_at ?? null,
    server_ready: true,
  });
});

settings.put("/settings", async (c) => {
  const user = c.get("user");
  const b = await c.req
    .json<{
      preset?: string; base_url?: string; api_key?: string | null; model?: string; learn?: boolean; auto_send?: boolean; screener_suggest?: boolean; daily_brief?: boolean; suggest_actions?: boolean;
    }>()
    .catch(() => ({}) as any);
  const cur = await loadAiSettings(c.env, user.id);
  const wantedPreset = typeof b.preset === "string" ? b.preset : cur?.preset ?? "anthropic";
  if (wantedPreset === "mock" && c.env.AI_MOCK !== "1") return c.json({ error: "unknown_preset" }, 400);
  const preset = presetById(wantedPreset);
  let enc = cur?.api_key_enc ?? "";
  let hint = cur?.key_hint ?? "";
  if (typeof b.api_key === "string") {
    const key = b.api_key.trim();
    if (key) {
      if (key.length < 8 || key.length > 2000) return c.json({ error: "invalid_key" }, 400);
      try {
        enc = await encryptSecret(await getSessionSecret(c.env), key);
      } catch (e) {
        console.error("encrypting the AI key failed", e);
        return c.json({ error: "save_failed", message: "The key could not be saved." }, 500);
      }
      hint = key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "••••";
    }
  } else if (b.api_key === null) {
    enc = "";
    hint = "";
  }
  let baseUrl = cur?.base_url ?? "";
  if (typeof b.base_url === "string") {
    baseUrl = b.base_url.trim().replace(/\/+$/, "");
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) return c.json({ error: "base_url_must_be_http" }, 400);
    if (baseUrl.length > 500) return c.json({ error: "base_url_too_long" }, 400);
  }
  // The stored key goes to whatever address is saved. Pointing a saved key at another address without typing the key again would let anyone holding
  // a session read it out by naming a server they run (and every summary and draft prompt goes there too).
  const typedKey = typeof b.api_key === "string" && b.api_key.trim().length > 0;
  if (preset.editable_url && baseUrl !== (cur?.base_url ?? "") && enc && !typedKey) {
    return c.json({ error: "api_key_required", message: "To use a different address for the model, enter the API key again." }, 400);
  }
  const model = (typeof b.model === "string" ? b.model.trim().slice(0, 120) : cur?.model) || preset.default_model;
  const learn = typeof b.learn === "boolean" ? (b.learn ? 1 : 0) : cur?.learn ?? 1;
  const autoSend = typeof b.auto_send === "boolean" ? (b.auto_send ? 1 : 0) : cur?.auto_send ?? 0;

  await c.env.DB.prepare(
    `INSERT INTO ai_settings (user_id, provider, preset, base_url, api_key_enc, key_hint, model, learn, auto_send, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, preset = excluded.preset, base_url = excluded.base_url, api_key_enc = excluded.api_key_enc, key_hint = excluded.key_hint,
       model = excluded.model, learn = excluded.learn, auto_send = excluded.auto_send, updated_at = excluded.updated_at`
  )
    .bind(user.id, preset.kind, preset.id, baseUrl, enc, hint, model, learn, autoSend, now())
    .run();
  if (typeof b.screener_suggest === "boolean") {
    await c.env.DB.prepare(`UPDATE ai_settings SET screener_suggest = ? WHERE user_id = ?`).bind(b.screener_suggest ? 1 : 0, user.id).run();
  }
  if (typeof b.suggest_actions === "boolean") {
    await c.env.DB.prepare(`UPDATE ai_settings SET suggest_actions = ? WHERE user_id = ?`).bind(b.suggest_actions ? 1 : 0, user.id).run();
  }
  if (typeof b.daily_brief === "boolean") {
    await c.env.DB.prepare(`UPDATE ai_settings SET daily_brief = ? WHERE user_id = ?`).bind(b.daily_brief ? 1 : 0, user.id).run();
  }

  return c.json({
    ok: true, provider: preset.kind, preset: preset.id, key_hint: hint, model, learn: !!learn, auto_send: !!autoSend, screener_suggest: typeof b.screener_suggest === "boolean" ? b.screener_suggest : cur ? !!cur.screener_suggest : true,
    daily_brief: typeof b.daily_brief === "boolean" ? b.daily_brief : cur ? !!cur.daily_brief : true,
    suggest_actions: typeof b.suggest_actions === "boolean" ? b.suggest_actions : cur ? !!cur.suggest_actions : true,
  });
});

settings.post("/settings/test", async (c) => {
  try {
    const d = await deps(c);
    const provider = makeProvider(d.cfg);
    const r = await provider.complete({ feature: "check", maxTokens: 20, effort: "low", messages: [{ role: "user", content: "Reply with the single word: ready" }] });
    return c.json({ ok: true, model: d.cfg.model, reply: r.text.trim().slice(0, 40) });
  } catch (e) {
    return c.json({ ok: false, error: describeApiError(e) }, 400);
  }
});

/**
 * Try what the assistant actually needs: streaming, tool calls, carrying on after a tool result, and
 * JSON. It costs a handful of tiny requests, so it is a button, not something that runs by itself.
 */
settings.post("/settings/check", async (c) => {
  try {
    const d = await deps(c);
    const results = await checkProvider(makeProvider(d.cfg));
    return c.json({ ok: results.every((r) => r.status !== "fail"), model: d.cfg.model, results, summary: summarizeCheck(results) });
  } catch (e) {
    return c.json({ ok: false, error: describeApiError(e) }, 400);
  }
});

settings.post("/models", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<{ preset?: string; base_url?: string; api_key?: string }>().catch(() => ({}) as any);
  const row = await loadAiSettings(c.env, user.id);
  const preset = presetById(typeof b.preset === "string" ? b.preset : row?.preset ?? "anthropic");
  const base = preset.editable_url ? (String(b.base_url ?? "").trim() || preset.base_url).replace(/\/+$/, "") : preset.base_url;
  if (!base || base.length > 500 || !/^https?:\/\//i.test(base)) return c.json({ models: [] });
  let key = typeof b.api_key === "string" ? b.api_key.trim() : "";
  // The saved key is only for the provider and address it was saved for. Sent to another one it would be handed to whoever runs that server,
  // the same thing PUT /settings refuses when the address changes without the key typed again.
  const sameTarget = !!row && row.preset === preset.id && (!preset.editable_url || base === presetUrl(preset, row.base_url));
  if (!key && row?.api_key_enc && sameTarget) {
    try {
      key = await decryptSecret(await getSessionSecret(c.env), row.api_key_enc);
    } catch {
      key = "";
    }
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (preset.kind === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (key && (key.startsWith("sk-ant-oat") || !key.startsWith("sk-ant-"))) {
      headers.authorization = `Bearer ${key}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else if (key) {
      headers["x-api-key"] = key;
    }
  } else {
    if (key) headers.authorization = `Bearer ${key}`;
    if (preset.id === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/fr3on/imbox";
      headers["X-Title"] = "Imbox";
    }
  }
  // Some servers list their models one level up from where they chat: Bedrock Mantle answers chat on /openai/v1 but lists on /v1/models. A 404 tries that.
  const urls = preset.kind === "anthropic" ? [`${base}/v1/models?limit=100`] : [`${base}/models`, ...(/\/openai\/v1$/i.test(base) ? [`${base.replace(/\/openai\/v1$/i, "/v1")}/models`] : [])];
  try {
    let res = await fetch(urls[0], { headers, signal: AbortSignal.timeout(10_000) });
    for (const next of urls.slice(1)) {
      if (res.status !== 404) break;
      res = await fetch(next, { headers, signal: AbortSignal.timeout(10_000) });
    }
    if (!res.ok) {
      const body = await res.text();
      return c.json({ models: [], error: `HTTP ${res.status} ${body.trim().slice(0, 200)}`.slice(0, 300) });
    }
    const json: any = await res.json().catch(() => null);
    const arr: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    const seen = new Set<string>();
    for (const entry of arr) {
      const id = typeof entry?.id === "string" ? entry.id : typeof entry?.name === "string" ? entry.name : "";
      if (id && !seen.has(id)) seen.add(id);
      if (seen.size >= 500) break;
    }
    return c.json({ models: [...seen].sort() });
  } catch (e) {
    return c.json({ models: [], error: (e as Error)?.message?.slice(0, 200) ?? "request failed" });
  }
});

export default settings;
