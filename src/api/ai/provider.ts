// Provider layer: a common stream/complete interface over Anthropic (official SDK) and OpenAI-compatible APIs.
import { getSessionSecret } from "../secrets";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Env } from "../env";
import { decryptSecret } from "./crypto";
import { OpenAiCompatibleProvider, OpenAiApiError, describeOpenAiError } from "./openai";
import { MockProvider } from "./mock";
import { MeteredProvider } from "./metering";
import { looksInternal } from "../input";

/* ---------- presets ---------- */

export type ProviderKind = "anthropic" | "openai_compatible" | "mock";
export interface Preset {
  id: "anthropic" | "openai" | "gemini" | "xai" | "openrouter" | "groq" | "together" | "fireworks" | "cerebras" | "deepseek" | "mistral" | "bedrock" | "ollama" | "lmstudio" | "custom" | "mock";
  label: string;
  blurb: string;
  group: "popular" | "hosted" | "cloud" | "local" | "custom";
  editable_url?: boolean;
  kind: ProviderKind;
  base_url: string;
  default_model: string;
  models: string[];
  key_placeholder: string;
  key_url?: string;
}

export const PRESETS: Preset[] = [
  { id: "anthropic", label: "Anthropic", blurb: "Claude, from the company that makes it.", group: "popular", kind: "anthropic", base_url: "https://api.anthropic.com", default_model: "claude-opus-5", models: ["claude-opus-5", "claude-fable-5-1", "claude-sonnet-5", "claude-haiku-4-5"], key_placeholder: "sk-ant-api03-…", key_url: "https://console.anthropic.com/settings/keys" },
  { id: "openai", label: "OpenAI", blurb: "GPT models, direct from OpenAI.", group: "popular", kind: "openai_compatible", base_url: "https://api.openai.com/v1", default_model: "gpt-5", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "o3"], key_placeholder: "sk-…", key_url: "https://platform.openai.com/api-keys" },
  { id: "gemini", label: "Google Gemini", blurb: "Gemini models through Google AI Studio.", group: "popular", kind: "openai_compatible", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", default_model: "gemini-2.5-pro", models: ["gemini-2.5-pro", "gemini-2.5-flash"], key_placeholder: "AIza…", key_url: "https://aistudio.google.com/apikey" },
  { id: "xai", label: "xAI (Grok)", blurb: "Grok models from xAI.", group: "popular", kind: "openai_compatible", base_url: "https://api.x.ai/v1", default_model: "grok-4", models: ["grok-4", "grok-4-fast", "grok-3"], key_placeholder: "xai-…", key_url: "https://console.x.ai" },
  { id: "openrouter", label: "OpenRouter", blurb: "One key for hundreds of models from many makers.", group: "hosted", kind: "openai_compatible", base_url: "https://openrouter.ai/api/v1", default_model: "anthropic/claude-sonnet-4.5", models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5", "google/gemini-2.5-pro", "x-ai/grok-4", "meta-llama/llama-4-maverick"], key_placeholder: "sk-or-…", key_url: "https://openrouter.ai/keys" },
  { id: "groq", label: "Groq", blurb: "Open models, very fast.", group: "hosted", kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1", default_model: "llama-3.3-70b-versatile", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"], key_placeholder: "gsk_…", key_url: "https://console.groq.com/keys" },
  { id: "together", label: "Together AI", blurb: "Open models such as Llama, Qwen and DeepSeek.", group: "hosted", kind: "openai_compatible", base_url: "https://api.together.xyz/v1", default_model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"], key_placeholder: "API key", key_url: "https://api.together.ai/settings/api-keys" },
  { id: "fireworks", label: "Fireworks AI", blurb: "Open models, fast to start and cheap to run.", group: "hosted", kind: "openai_compatible", base_url: "https://api.fireworks.ai/inference/v1", default_model: "accounts/fireworks/models/llama-v3p3-70b-instruct", models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"], key_placeholder: "fw_…", key_url: "https://app.fireworks.ai/settings/users/api-keys" },
  { id: "cerebras", label: "Cerebras", blurb: "Open models on very fast hardware.", group: "hosted", kind: "openai_compatible", base_url: "https://api.cerebras.ai/v1", default_model: "llama-3.3-70b", models: ["llama-3.3-70b"], key_placeholder: "csk-…", key_url: "https://cloud.cerebras.ai" },
  { id: "deepseek", label: "DeepSeek", blurb: "DeepSeek chat and reasoning models.", group: "hosted", kind: "openai_compatible", base_url: "https://api.deepseek.com/v1", default_model: "deepseek-chat", models: ["deepseek-chat", "deepseek-reasoner"], key_placeholder: "sk-…", key_url: "https://platform.deepseek.com/api_keys" },
  { id: "mistral", label: "Mistral", blurb: "Mistral’s own models, hosted in Europe.", group: "hosted", kind: "openai_compatible", base_url: "https://api.mistral.ai/v1", default_model: "mistral-large-latest", models: ["mistral-large-latest", "mistral-small-latest"], key_placeholder: "API key", key_url: "https://console.mistral.ai/api-keys" },
  { id: "bedrock", label: "Amazon Bedrock", blurb: "Open and partner models on your AWS account. Change the region in the address.", group: "cloud", kind: "openai_compatible", base_url: "https://bedrock-mantle.us-east-1.api.aws/v1", default_model: "openai.gpt-oss-120b", models: ["openai.gpt-oss-120b"], key_placeholder: "Bedrock API key", key_url: "https://console.aws.amazon.com/bedrock/home#/api-keys", editable_url: true },
  { id: "ollama", label: "Ollama", blurb: "Models on your own computer. Nothing leaves it.", group: "local", kind: "openai_compatible", base_url: "http://localhost:11434/v1", default_model: "llama3.1", models: ["llama3.1", "qwen2.5", "mistral"], key_placeholder: "Not needed", editable_url: true },
  { id: "lmstudio", label: "LM Studio", blurb: "Models on your own computer, run from LM Studio.", group: "local", kind: "openai_compatible", base_url: "http://localhost:1234/v1", default_model: "", models: [], key_placeholder: "Not needed", editable_url: true },
  { id: "custom", label: "Custom", blurb: "Any server that speaks the OpenAI API.", group: "custom", kind: "openai_compatible", base_url: "", default_model: "", models: [], key_placeholder: "API key (optional for local servers)", editable_url: true },
];

/** Hidden test provider: streams a canned answer and calls one tool. Only usable when env.AI_MOCK === "1". */
export const MOCK_PRESET: Preset = { id: "mock", label: "Mock (testing)", blurb: "For tests.", group: "custom", kind: "mock", base_url: "", default_model: "mock-1", models: ["mock-1"], key_placeholder: "not needed" };

/** The address a preset talks to: its own, or the saved one for a preset whose address can be changed (falling back to its usual one). */
export function presetUrl(p: Preset, saved: string | null | undefined): string {
  return p.editable_url ? (saved || p.base_url).replace(/\/+$/, "") : p.base_url;
}

export function presetById(id: string): Preset {
  if (id === "mock") return MOCK_PRESET;
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/* ---------- config ---------- */

export interface AiSettingsRow {
  user_id: string;
  provider: ProviderKind;
  preset: string;
  base_url: string;
  api_key_enc: string;
  key_hint: string;
  model: string;
  learn: number;
  auto_send: number;
  screener_suggest: number;
  daily_brief: number;
  suggest_actions: number;
  updated_at: number;
}

export interface AiConfig {
  provider: ProviderKind;
  preset: Preset["id"];
  baseUrl: string;
  apiKey: string;
  model: string;
  learn: boolean;
  autoSend: boolean;
  /** Where each call is written down, so the AI Usage page can add them up. Set by loadAiConfig. */
  usage?: { db: Db; userId: string };
}

export async function loadAiSettings(env: Env, userId: string): Promise<AiSettingsRow | null> {
  return (await env.DB.prepare(`SELECT * FROM ai_settings WHERE user_id = ?`).bind(userId).first<AiSettingsRow>()) ?? null;
}

/** Decrypted config, or null when nothing usable is configured. */
export async function loadAiConfig(env: Env, userId: string, saved?: AiSettingsRow | null): Promise<AiConfig | null> {
  // `saved` is the settings row when the caller has just read it, so it is not read twice.
  const row = saved !== undefined ? saved : await loadAiSettings(env, userId);
  if (!row) return null;
  const preset = presetById(row.preset || (row.provider === "anthropic" ? "anthropic" : "custom"));
  if (preset.kind === "mock") {
    if (env.AI_MOCK !== "1") return null;
    return { provider: "mock", preset: "mock", baseUrl: "", apiKey: "", model: row.model || preset.default_model, learn: !!row.learn, autoSend: !!row.auto_send, usage: { db: env.DB, userId } };
  }
  const apiKey = row.api_key_enc ? await decryptSecret(await getSessionSecret(env), row.api_key_enc) : "";
  const baseUrl = presetUrl(preset, row.base_url);
  if (preset.kind === "anthropic" && !apiKey) return null;
  if (preset.kind === "openai_compatible" && !baseUrl) return null;
  return { provider: preset.kind, preset: preset.id, baseUrl, apiKey, model: row.model || preset.default_model, learn: !!row.learn, autoSend: !!row.auto_send, usage: { db: env.DB, userId } };
}

export class AiNotConfigured extends Error {
  constructor() {
    super("ai_not_configured");
  }
}

/* ---------- common interface ---------- */

/** Tokens a call used, as the provider counted them. */
export interface Usage {
  input: number;
  output: number;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; stop: "end" | "tool_use" | "refusal" | "max_tokens"; content: Anthropic.ContentBlock[]; usage?: Usage }
  | { type: "error"; message: string };

export interface StreamParams {
  system: string;
  /** Canonical history: Anthropic-style content blocks. */
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  /** What the call is for, for the AI Usage page: "chat", "brief", "screener" and so on. */
  feature?: string;
}

export interface CompleteParams<T> {
  system?: string;
  messages: Anthropic.MessageParam[];
  schema?: { name: string; zod: z.ZodType<T> };
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  /** What the call is for, for the AI Usage page. */
  feature?: string;
}

export interface LlmProvider {
  readonly model: string;
  stream(p: StreamParams): AsyncIterable<StreamEvent>;
  complete<T = unknown>(p: CompleteParams<T>): Promise<{ text: string; json?: T; refused?: boolean; usage?: Usage }>;
}

export function makeProvider(cfg: AiConfig): LlmProvider {
  const inner: LlmProvider = cfg.provider === "mock" ? new MockProvider(cfg.model) : cfg.provider === "anthropic" ? new AnthropicProvider(cfg) : new OpenAiCompatibleProvider(cfg);
  return cfg.usage ? new MeteredProvider(inner, cfg.usage) : inner;
}

/* ---------- Anthropic (official SDK) ---------- */

export function makeClient(cfg: AiConfig): Anthropic {
  const base = { maxRetries: 1, timeout: 120_000 };
  // OAuth tokens (e.g. from `ant auth`) go on Authorization: Bearer with the oauth beta; API keys use x-api-key.
  if (cfg.apiKey.startsWith("sk-ant-oat") || !cfg.apiKey.startsWith("sk-ant-")) {
    return new Anthropic({ ...base, apiKey: null, authToken: cfg.apiKey, defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" } });
  }
  return new Anthropic({ ...base, apiKey: cfg.apiKey });
}

function anthropicUsage(u: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined): Usage | undefined {
  if (!u) return undefined;
  return { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0 };
}

class AnthropicProvider implements LlmProvider {
  readonly model: string;
  private client: Anthropic;
  constructor(cfg: AiConfig) {
    this.model = cfg.model;
    this.client = makeClient(cfg);
  }
  async *stream(p: StreamParams): AsyncIterable<StreamEvent> {
    const chunks: string[] = [];
    let resolveTick: (() => void) | null = null;
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: p.maxTokens,
        system: [{ type: "text", text: p.system, cache_control: { type: "ephemeral" } }],
        tools: p.tools,
        messages: p.messages,
        output_config: { effort: p.effort ?? "medium" },
      },
      { signal: p.signal }
    );
    stream.on("text", (d) => {
      chunks.push(d);
      resolveTick?.();
    });
    const final = stream.finalMessage().then((m) => ({ m }), (e: unknown) => ({ e }));
    let done: { m: Anthropic.Message } | { e: unknown } | null = null;
    final.then((r) => {
      done = r;
      resolveTick?.();
    });
    while (!done) {
      if (chunks.length) yield { type: "text", text: chunks.splice(0).join("") };
      else await new Promise<void>((r) => (resolveTick = r));
      resolveTick = null;
    }
    if (chunks.length) yield { type: "text", text: chunks.splice(0).join("") };
    const r = done as { m: Anthropic.Message } | { e: unknown };
    if ("e" in r) {
      yield { type: "error", message: describeApiError(r.e) };
      return;
    }
    const m = r.m;
    const stop = m.stop_reason === "refusal" ? "refusal" : m.stop_reason === "tool_use" ? "tool_use" : m.stop_reason === "max_tokens" ? "max_tokens" : "end";
    yield { type: "done", stop, content: m.content, usage: anthropicUsage(m.usage) };
  }
  async complete<T>(p: CompleteParams<T>) {
    const common = { model: this.model, max_tokens: p.maxTokens, output_config: { effort: p.effort ?? "medium" } as Anthropic.MessageCreateParams["output_config"], messages: p.messages, ...(p.system ? { system: [{ type: "text" as const, text: p.system }] } : {}) };
    if (p.schema) {
      const res = await this.client.messages.parse({ ...common, output_config: { ...common.output_config, format: zodOutputFormat(p.schema.zod) } });
      if (res.stop_reason === "refusal") return { text: "", refused: true, usage: anthropicUsage(res.usage) };
      return { text: res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(""), json: (res.parsed_output ?? undefined) as T | undefined, usage: anthropicUsage(res.usage) };
    }
    const res = await this.client.messages.create(common);
    if (res.stop_reason === "refusal") return { text: "", refused: true, usage: anthropicUsage(res.usage) };
    return { text: res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join(""), usage: anthropicUsage(res.usage) };
  }
}

/** Friendly message for API failures shown in the UI. */
export function describeApiError(e: unknown): string {
  if (e instanceof AiNotConfigured) return "Set up an AI provider in Settings → AI first.";
  if (e instanceof OpenAiApiError) return describeOpenAiError(e);
  if (e instanceof Anthropic.AuthenticationError) return "The API key was rejected. Check it in Settings → AI.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This key isn't allowed to use that model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the provider. Try again in a moment.";
  if (e instanceof Anthropic.BadRequestError) return `The provider rejected the request: ${e.message.slice(0, 200)}`;
  if (e instanceof Anthropic.APIError) return `Provider error ${e.status ?? ""}: ${e.message.slice(0, 200)}`;
  const msg = (e as Error)?.message ?? String(e);
  if (msg === "session_secret_missing") return "SESSION_SECRET is not set on the server, so keys can't be decrypted.";
  // A database error is not something the person can act on, and says how the server is built.
  if (looksInternal(msg)) {
    console.error("assistant request failed", e);
    return "The assistant ran into a problem on the server. Try again, and check the server log if it keeps happening.";
  }
  return msg.slice(0, 300);
}
