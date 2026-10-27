import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { AiCheckResponse, AiMemoryEntry, AiPreset, AiSettings, AiUsageData } from "@shared/types";
import { html, NOW } from "./render";
import { AiSection, FeatureRow, MemorySection } from "@/components/AiSettingsSection";
import { TestReport } from "@/components/AiSettingsSection/TestReport";

// What the AI part of Settings shows when it is first drawn: the connection (a form until a provider works, a line after), the switches with their use
// bars, the memory summary, and the two lists that open from it, drawn on their own. Written before the file was split into parts. Clicks and effects do not
// run here, so the parts that open on a click (the model picker, the test report) are not shown; the compiler checks them through their props.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const PRESETS: AiPreset[] = [
  { id: "anthropic", label: "Anthropic", blurb: "Claude.", group: "popular", kind: "anthropic", base_url: "https://api.anthropic.test", default_model: "claude-test-1", models: ["claude-test-1", "claude-test-2"], key_placeholder: "sk-ant-…", key_url: "https://console.anthropic.test/keys" },
  { id: "openai", label: "OpenAI", blurb: "GPT.", group: "popular", kind: "openai_compatible", base_url: "https://api.openai.test/v1", default_model: "gpt-test", models: ["gpt-test"], key_placeholder: "sk-…" },
  { id: "custom", label: "Custom (OpenAI-compatible)", blurb: "Any OpenAI-style server.", group: "custom", editable_url: true, kind: "openai_compatible", base_url: "", default_model: "", models: [], key_placeholder: "API key" },
];
const SETTINGS: AiSettings = {
  configured: false, provider: "anthropic", preset: "anthropic", base_url: "", key_hint: "", model: "", learn: false, auto_send: false, screener_suggest: true, daily_brief: true, suggest_actions: true,
  presets: PRESETS, last_learned_at: null, server_ready: true,
};
const READY: AiSettings = { ...SETTINGS, configured: true, model: "claude-test-1", key_hint: "…wxyz", learn: true, last_learned_at: NOW - 3 * 3_600_000 };
const USAGE: AiUsageData = {
  overview: { configured: true, provider: "anthropic", preset: "anthropic", model: "claude-test-1" }, days: 30, counting_since: NOW - 40 * 86_400_000,
  totals: { calls: 90, tokens_in: 120_000, tokens_out: 30_000, failed: 1, estimated_calls: 0, median_ms: 900 }, series: [],
  by_feature: [
    { feature: "screener", calls: 40, tokens_in: 50_000, tokens_out: 10_000, failed: 0, estimated: 0 },
    { feature: "brief", calls: 20, tokens_in: 20_000, tokens_out: 5_000, failed: 0, estimated: 0 },
    { feature: "chat", calls: 30, tokens_in: 50_000, tokens_out: 15_000, failed: 1, estimated: 0 },
    { feature: "learn", calls: 4, tokens_in: 4_000, tokens_out: 1_000, failed: 0, estimated: 0 },
    { feature: "agents", calls: 3, tokens_in: 2_000, tokens_out: 1_000, failed: 0, estimated: 0 },
  ],
  skipped_runs: 0, activity: [],
};
const memory = (kind: AiMemoryEntry["kind"], i: number, source: AiMemoryEntry["source"] = "learned"): AiMemoryEntry => ({ id: `m-${kind}-${i}`, kind, content: `${kind} note ${i}`, source, created_at: NOW - i * 86_400_000, updated_at: NOW - i * 3_600_000 });
const MEMORY: AiMemoryEntry[] = [memory("profile", 1, "user"), memory("tone", 1), memory("tone", 2, "assistant"), memory("fact", 1, "learned"), memory("preference", 1), memory("contact", 1)];

const seed = (settings?: AiSettings, usage?: AiUsageData, mem?: AiMemoryEntry[]) => (qc: QueryClient) => {
  if (settings) qc.setQueryData(["ai", "settings"], settings);
  if (usage) qc.setQueryData(["ai", "usage", 30], usage);
  if (mem) qc.setQueryData(["ai", "memory"], mem);
};

describe("AiSection", () => {
  it("is the empty page while nothing has loaded", () => {
    expect(html(<AiSection />, "/settings", seed())).toMatchSnapshot();
  });
  it("shows the form with its three steps until a provider works", () => {
    const out = html(<AiSection />, "/settings", seed(SETTINGS));
    expect(out).toMatchSnapshot();
    expect(out).toContain("Choose a provider.");
    expect(out).toContain("Get a key");
    expect(out).not.toContain("key stored");
  });
  it("says when the server cannot store keys yet", () => {
    expect(html(<AiSection />, "/settings", seed({ ...SETTINGS, server_ready: false }))).toContain("SESSION_SECRET isn&#x27;t set on the server");
  });
  it("shows the working connection as one line, with use over 30 days, the bars and what is remembered", () => {
    const out = html(<AiSection />, "/settings", seed(READY, USAGE, MEMORY));
    expect(out).toMatchSnapshot();
    expect(out).toContain("claude-test-1");
    expect(out).toContain("Anthropic");
    expect(out).toContain("key stored");
    expect(out).toContain("6 things remembered");
    expect(out).toContain("Last learned");
    expect(out).not.toContain("Choose a provider.");
  });
  it("names the host of a custom endpoint", () => {
    const out = html(<AiSection />, "/settings", seed({ ...READY, preset: "custom", base_url: "http://llm.example.test:11434/v1", model: "llama-test" }, USAGE, []));
    expect(out).toContain("Custom (OpenAI-compatible) · llm.example.test:11434");
    expect(out).toContain("Nothing remembered yet");
  });
  it("shows each switch as it is set, and the tokens left over for what the reader asked for", () => {
    const out = html(<AiSection />, "/settings", seed({ ...READY, screener_suggest: false, daily_brief: false, suggest_actions: false, learn: false, auto_send: true }, USAGE, []));
    expect((out.match(/role="switch"[^>]*/g) ?? []).map((m) => /aria-checked="(\w+)"/.exec(m)?.[1])).toEqual(["false", "false", "false", "false", "true"]);
    expect(out).toContain("Chat, reply drafts and summaries you ask for used 57k tokens");
  });
  it("draws the same for the phone, with taller fields", () => {
    expect(html(<AiSection compact />, "/settings", seed(SETTINGS))).toMatchSnapshot("form");
    expect(html(<AiSection compact />, "/settings", seed(READY, USAGE, MEMORY))).toMatchSnapshot("connected");
  });
});

describe("FeatureRow", () => {
  it("fills the bar in proportion to the busiest feature, and says none yet when there is no use", () => {
    expect(html(<FeatureRow label="A" hint="h" tokens={500} top={1000}>x</FeatureRow>)).toContain("width:50%");
    expect(html(<FeatureRow label="A" hint="h" tokens={5} top={1000}>x</FeatureRow>)).toContain("width:3%");
    const none = html(<FeatureRow label="A" hint="h" tokens={0} top={1000}>x</FeatureRow>);
    expect(none).toContain("none yet");
    expect(none).toContain("width:0%");
  });
  it("has no bar while the use is still loading, and warns when asked", () => {
    expect(html(<FeatureRow label="A" hint="h" top={1}>x</FeatureRow>)).not.toContain("rounded-full bg-foreground");
    expect(html(<FeatureRow warn label="A" hint="h" top={1}>x</FeatureRow>)).toContain("bg-amber-500/[0.07]");
  });
});

describe("MemorySection", () => {
  it("lists what is remembered by kind, newest first, with where each came from", () => {
    expect(html(<MemorySection onClear={() => {}} />, "/settings", seed(undefined, undefined, MEMORY))).toMatchSnapshot();
  });
  it("offers starting points when nothing is remembered", () => {
    const out = html(<MemorySection onClear={() => {}} />, "/settings", seed(undefined, undefined, []));
    expect(out).toMatchSnapshot();
    expect(out).not.toContain("Forget all");
  });
  it("keeps the edit buttons showing on the phone, and stacks the add box", () => {
    expect(html(<MemorySection compact onClear={() => {}} />, "/settings", seed(undefined, undefined, MEMORY))).toMatchSnapshot();
  });
});

describe("the model list", () => {
  it("leaves out models that are not for chatting", async () => {
    const { NOT_CHAT } = await import("@/components/AiSettingsSection");
    const out = ["gpt-5", "gpt-4.1-mini", "claude-sonnet-5", "google.gemma-4-31b", "meta-llama/llama-4-maverick", "o3"];
    const skipped = ["text-embedding-3-large", "whisper-1", "tts-1-hd", "dall-e-3", "omni-moderation-latest", "gpt-realtime", "gpt-image-1", "cohere.rerank-v3"];
    for (const id of out) expect(NOT_CHAT.test(id), id).toBe(false);
    for (const id of skipped) expect(NOT_CHAT.test(id), id).toBe(true);
  });
});

describe("the test report", () => {
  const ok = (id: AiCheckResponse["results"][number]["id"], label: string, ms: number) => ({ id, label, status: "pass" as const, detail: "fine", ms });
  const good: AiCheckResponse = {
    ok: true,
    model: "google.gemma-4-31b",
    summary: { level: "good", text: "Everything the assistant needs works with this model." },
    results: [ok("basic", "Answers a question", 615), ok("stream", "Streams its reply", 602), ok("tools", "Calls tools", 464), ok("roundtrip", "Continues after a tool result", 458), ok("json", "Answers in JSON", 386)],
  };
  it("is one tile for each check, with the model and the total time", () => {
    const out = html(<TestReport report={good} setReport={() => {}} />);
    for (const t of ["Everything works", "google.gemma-4-31b · 2.5 s", "Answers", "Streams", "Calls tools", "Uses results", "JSON", "615 ms"]) expect(out).toContain(t);
    expect(out).not.toContain("Not working");
  });
  it("says what went wrong under a check that failed", () => {
    const bad: AiCheckResponse = { ...good, ok: false, summary: { level: "limited", text: "It can chat but not call tools." }, results: [good.results[0], { id: "tools", label: "Calls tools", status: "fail", detail: "The model ignored the tool.", ms: 900 }] };
    const out = html(<TestReport report={bad} setReport={() => {}} />);
    expect(out).toContain("Works with limits");
    expect(out).toContain("The model ignored the tool.");
  });
});
