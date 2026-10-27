import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface AutoAgentRun {
  id: string;
  agent_id: string;
  thread_id: string;
  status: "replied" | "drafted" | "acted" | "skipped" | "error" | "running";
  summary: string;
  draft_id: string | null;
  subject: string;
  from_email: string;
  created_at: number;
}

export interface AutoAgent {
  id: string;
  name: string;
  instructions: string;
  account_ids: string[];
  mode: "draft" | "auto";
  enabled: boolean;
  only_screened_in: boolean;
  senders: string;
  daily_limit: number;
  last_run_at: number | null;
  replies_today: number;
  recent: AutoAgentRun[];
  memory_count?: number;
}

export type AutoAgentInput = Partial<Pick<AutoAgent, "name" | "instructions" | "account_ids" | "mode" | "enabled" | "only_screened_in" | "senders" | "daily_limit">>;

export type AutoAgentMemoryKind = "rule" | "faq" | "fact" | "tone" | "contact";

export interface AutoAgentMemoryItem {
  id: string;
  agent_id: string;
  kind: AutoAgentMemoryKind;
  content: string;
  source: "user" | "learned";
  created_at: number;
  updated_at: number;
}

export function useAutoAgents() {
  return useQuery({ queryKey: ["auto-agents"], queryFn: () => api.get<AutoAgent[]>("/api/auto-agents"), refetchInterval: 30_000 });
}

export function useAutoAgentRuns(id: string | null, skipped: boolean) {
  return useQuery({
    queryKey: ["auto-agents", id, "runs", skipped],
    queryFn: () => api.get<{ runs: AutoAgentRun[]; skipped_count: number }>(`/api/auto-agents/${id}/runs?skipped=${skipped ? 1 : 0}`),
    enabled: !!id,
  });
}

export function useAutoAgentMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["auto-agents"] });
  return {
    create: useMutation({ mutationFn: (b: AutoAgentInput) => api.post<AutoAgent>("/api/auto-agents", b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, ...b }: AutoAgentInput & { id: string }) => api.put<AutoAgent>(`/api/auto-agents/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/auto-agents/${id}`), onSuccess: inv }),
  };
}

/** How an agent with these instructions would answer a sample email. Nothing is sent or saved. */
export function useTryAgent() {
  return useMutation({
    mutationFn: (b: { name: string; instructions: string; sample: string }) => api.post<{ action: "reply" | "leave"; text: string }>("/api/auto-agents/try", b),
  });
}

export function useAutoAgentMemory(id: string | null) {
  return useQuery({
    queryKey: ["auto-agents", id, "memory"],
    queryFn: () => api.get<AutoAgentMemoryItem[]>(`/api/auto-agents/${id}/memory`),
    enabled: !!id,
  });
}

export function useAutoAgentMemoryMutations(agentId: string) {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["auto-agents", agentId, "memory"] });
    qc.invalidateQueries({ queryKey: ["auto-agents"] });
  };
  return {
    add: useMutation({
      mutationFn: (b: { kind: AutoAgentMemoryKind; content: string }) =>
        api.post<AutoAgentMemoryItem>(`/api/auto-agents/${agentId}/memory`, b),
      onSuccess: inv,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; kind?: AutoAgentMemoryKind; content?: string }) =>
        api.patch<AutoAgentMemoryItem>(`/api/auto-agents/${agentId}/memory/${id}`, b),
      onSuccess: inv,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/auto-agents/${agentId}/memory/${id}`),
      onSuccess: inv,
    }),
    clear: useMutation({
      mutationFn: () => api.del<{ ok: boolean }>(`/api/auto-agents/${agentId}/memory`),
      onSuccess: inv,
    }),
  };
}
