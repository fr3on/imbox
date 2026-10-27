import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { ApiError, api, getScope, request } from "./client";

export function useAiSettings() {
  return useQuery({ queryKey: ["ai", "settings"], queryFn: () => api.get<T.AiSettings>("/api/ai/settings"), staleTime: 30_000 });
}

export function useAiUsage(days: 7 | 30 | 90 = 30) {
  return useQuery({ queryKey: ["ai", "usage", days], queryFn: () => api.get<T.AiUsageData>(`/api/ai/usage?days=${days}`), staleTime: 10_000, placeholderData: (prev) => prev });
}

export function useAiModels(enabled: boolean, preset: string, baseUrl: string, apiKey: string) {
  return useQuery({
    queryKey: ["ai", "models", preset, baseUrl, apiKey ? "k" : ""],
    queryFn: () => api.post<{ models: string[]; error?: string }>("/api/ai/models", { preset, base_url: baseUrl, api_key: apiKey }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAiMemory() {
  return useQuery({ queryKey: ["ai", "memory"], queryFn: () => api.get<T.AiMemoryEntry[]>("/api/ai/memory"), staleTime: 15_000 });
}

export function useAiConversations() {
  return useQuery({ queryKey: ["ai", "conversations"], queryFn: () => api.get<T.AiConversation[]>("/api/ai/conversations"), staleTime: 10_000 });
}

export interface AiStoredMessage {
  id: string;
  role: "user" | "assistant";
  content: unknown[];
  created_at: number;
}

export function useAiConversation(id: string | undefined) {
  return useQuery({ queryKey: ["ai", "conversation", id ?? ""], queryFn: () => api.get<{ conversation: T.AiConversation; messages: AiStoredMessage[] }>(`/api/ai/conversations/${id}`), enabled: !!id });
}

export function useAiMutations() {
  const qc = useQueryClient();
  const invSettings = () => qc.invalidateQueries({ queryKey: ["ai", "settings"] });
  const invMemory = () => qc.invalidateQueries({ queryKey: ["ai", "memory"] });
  const invConvs = () => qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
  return {
    saveSettings: useMutation({
      mutationFn: (b: { preset?: string; base_url?: string; api_key?: string | null; model?: string; learn?: boolean; auto_send?: boolean; screener_suggest?: boolean; daily_brief?: boolean; suggest_actions?: boolean}) =>
        request<{ ok: boolean }>("PUT", "/api/ai/settings", b),
      onSuccess: invSettings,
    }),
    test: useMutation({ mutationFn: () => api.post<{ ok: boolean; model?: string; reply?: string; error?: string }>("/api/ai/settings/test") }),
    check: useMutation({ mutationFn: () => api.post<T.AiCheckResponse>("/api/ai/settings/check") }),
    learn: useMutation({ mutationFn: () => api.post<{ changed: number; skipped?: string }>("/api/ai/learn"), onSuccess: () => { invMemory(); invSettings(); } }),
    addMemory: useMutation({ mutationFn: (b: { kind: T.AiMemoryKind; content: string }) => api.post<T.AiMemoryEntry>("/api/ai/memory", b), onSuccess: invMemory }),
    updateMemory: useMutation({ mutationFn: ({ id, ...b }: { id: string; kind?: T.AiMemoryKind; content?: string }) => api.patch<T.AiMemoryEntry>(`/api/ai/memory/${id}`, b), onSuccess: invMemory }),
    deleteMemory: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/ai/memory/${id}`), onSuccess: invMemory }),
    clearMemory: useMutation({ mutationFn: () => api.del<{ ok: boolean }>("/api/ai/memory"), onSuccess: () => { invMemory(); invSettings(); } }),
    newConversation: useMutation({ mutationFn: () => api.post<T.AiConversation>("/api/ai/conversations"), onSuccess: invConvs }),
    renameConversation: useMutation({ mutationFn: ({ id, title }: { id: string; title: string }) => api.patch<{ ok: boolean }>(`/api/ai/conversations/${id}`, { title }), onSuccess: invConvs }),
    deleteConversation: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/ai/conversations/${id}`), onSuccess: invConvs }),
    reply: useMutation({ mutationFn: (b: { thread_id: string; brief: string; tone?: "match" | "formal" | "friendly" | "brief" }) => api.post<{ subject: string | null; body_text: string; body_html: string; reply_to_message_id: string | null }>("/api/ai/reply", b) }),
    summarize: useMutation({ mutationFn: (thread_id: string) => api.post<{ summary: string }>("/api/ai/summarize", { thread_id }) }),
  };
}

export type AiSseEvent =
  | { type: "start"; conversation_id: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" | "error"; summary: string }
  | { type: "draft"; draft: T.AiDraftCard }
  | { type: "event_proposal"; proposal: T.AiEventProposal }
  | { type: "workflow_proposal"; proposal: T.AiWorkflowProposal }
  | { type: "bulk_action_proposal"; proposal: T.AiBulkActionProposal }
  | { type: "sent"; draft_id: string; thread_id: string }
  | { type: "done"; conversation_id: string }
  | { type: "error"; message: string };

/** Streams one assistant turn. Resolves when the server sends `done` (or the stream ends). */
export async function aiChatStream(body: { conversation_id?: string; message: string; context_thread_ids?: string[] }, onEvent: (e: AiSseEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", "X-Account-Id": getScope() }, credentials: "include", body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      msg = j.error || msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AiSseEvent);
      } catch {}
    }
  }
}

/* ---------- Jev: fast decisions from TypeSafe AI ---------- */

export interface JevCapabilityInfo {
  id: "phishing" | "screener" | "checks";
  label: string;
  decides: string;
  sees: string;
  runs: string;
  enabled: boolean;
  calls_30d: number;
  last_at: number | null;
}

export interface JevInfo {
  configured: boolean;
  enabled: boolean;
  key_hint: string;
  model: string;
  capabilities: JevCapabilityInfo[];
}

export interface JevSample {
  id: "phishing" | "screener";
  label: string;
  input: string;
  output: string;
  ms: number;
  tokens: number;
}

export function useJev() {
  return useQuery({ queryKey: ["ai", "jev"], queryFn: () => api.get<JevInfo>("/api/ai/jev"), staleTime: 60_000 });
}

export function useJevMutations() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (b: { enabled?: boolean; api_key?: string | null; features?: Partial<Record<"phishing" | "screener" | "checks", boolean>> }) => request<JevInfo>("PUT", "/api/ai/jev", b),
      onSuccess: (info) => qc.setQueryData(["ai", "jev"], info),
    }),
    sample: useMutation({ mutationFn: (api_key?: string) => api.post<{ ok: boolean; model: string; samples: JevSample[] }>("/api/ai/jev/test", { api_key }) }),
  };
}

/** Jev's view of a message, asked once and kept. Only when the check is on and the message is worth asking about. */
export function useJevPhishing(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ai", "jev", "phishing", threadId],
    queryFn: () => api.post<{ enabled: boolean; probability?: number; pressure?: number; error?: string; skipped?: string }>("/api/ai/jev/phishing", { thread_id: threadId }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

export interface JevCheckRow {
  id: string;
  label: string;
  text: string;
  pct: number;
  flag: boolean;
}

export interface JevChecksResult {
  enabled: boolean;
  configured?: boolean;
  checks?: JevCheckRow[];
  model?: string;
  ms?: number;
  tokens?: number;
  error?: string;
}

/** Quick checks on one message, asked when a person chooses them. */
export function useJevChecks() {
  return useMutation({ mutationFn: (threadId: string) => api.post<JevChecksResult>("/api/ai/jev/checks", { thread_id: threadId }) });
}
