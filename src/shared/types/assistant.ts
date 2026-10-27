import type { Address } from "./common";

export interface AiPreset {
  id: "anthropic" | "openai" | "gemini" | "xai" | "openrouter" | "groq" | "together" | "fireworks" | "cerebras" | "deepseek" | "mistral" | "bedrock" | "ollama" | "lmstudio" | "custom";
  label: string;
  /** One line on what it is, shown in the picker. */
  blurb: string;
  /** Where it sits in the picker. */
  group: "popular" | "hosted" | "cloud" | "local" | "custom";
  /** The address can be changed (a server on your own machine, or a region). Otherwise it is fixed. */
  editable_url?: boolean;
  kind: "anthropic" | "openai_compatible";
  base_url: string;
  default_model: string;
  models: string[];
  key_placeholder: string;
  key_url?: string;
}

export interface AiSettings {
  configured: boolean;
  provider: "anthropic" | "openai_compatible";
  preset: AiPreset["id"];
  base_url: string;
  key_hint: string;
  model: string;
  learn: boolean;
  auto_send: boolean;
  screener_suggest: boolean;
  daily_brief: boolean;
  suggest_actions: boolean;
  presets: AiPreset[];
  last_learned_at: number | null;
  server_ready: boolean;
}

export type AiMemoryKind = "profile" | "tone" | "fact" | "preference" | "contact";

export interface AiMemoryEntry {
  id: string;
  kind: AiMemoryKind;
  content: string;
  source: "user" | "assistant" | "learned";
  created_at: number;
  updated_at: number;
}

export interface AiConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface AiUsageData {
  overview: { configured: boolean; provider: string; preset: string; model: string };
  days: 7 | 30 | 90;
  /** When the first call was written down. Earlier history was not measured. */
  counting_since: number | null;
  totals: { calls: number; tokens_in: number; tokens_out: number; failed: number; estimated_calls: number; median_ms: number };
  /** Tokens per day, the day being a count of 24-hour spans since the epoch (UTC). Days with no calls are left out. */
  series: Array<{ day: number; tokens: number }>;
  by_feature: Array<{ feature: string; calls: number; tokens_in: number; tokens_out: number; failed: number; estimated: number }>;
  skipped_runs: number;
  activity: Array<{ id: string; kind: "agent" | "chat" | "let_in"; title: string; subtitle: string; status: string; time: number; link?: string }>;
}

export interface AiDraftCard {
  draft_id: string;
  account_id: string;
  from: string;
  thread_id: string | null;
  to: Address[];
  cc: Address[];
  subject: string;
  body_text: string;
}

export interface AiEventProposal {
  id: string;
  title: string;
  starts_at: number;
  ends_at: number;
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  location?: string;
  description?: string;
  attendees?: string[];
  calendar_id?: string;
}

export interface AiBulkThreadItem {
  id: string;
  subject: string;
  from: string;
  previous_bucket?: string;
  previous_unread?: boolean;
}

export interface AiBulkActionProposal {
  id: string;
  description: string;
  action: "move" | "mark_read" | "mark_unread" | "reply_later" | "set_aside" | "trash";
  bucket?: string;
  thread_ids: string[];
  threads: AiBulkThreadItem[];
  applied?: boolean;
}

/** One thing the assistant needs from a model, tried for real by Settings → AI → Check features. */
export interface AiCheckResult {
  id: "basic" | "stream" | "tools" | "roundtrip" | "json";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  ms: number;
}

export interface AiCheckResponse {
  ok: boolean;
  model: string;
  results: AiCheckResult[];
  summary: { level: "good" | "limited" | "broken"; text: string };
}

/** A workflow the assistant drafted, shown on a card. It is saved, switched off, only when the person chooses to. */
export interface AiWorkflowProposal {
  id: string;
  def: {
    name: string;
    trigger: "message_arrives" | "no_reply";
    trigger_days: number;
    match: "all" | "any";
    conditions: { field: string; op: string; value: string }[];
    actions: { type: string; id?: string; tray?: string; hours?: number }[];
    account_ids: string[];
    daily_limit: number;
  };
  summary: string;
  notes: string[];
}
