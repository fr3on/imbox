import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action, Condition, Trigger } from "@shared/workflows";
import { api } from "./client";

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  thread_id: string;
  status: "done" | "partial" | "error";
  summary: string;
  subject: string;
  created_at: number;
}

export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  trigger_days: number;
  match: "all" | "any";
  conditions: Condition[];
  actions: Action[];
  account_ids: string[];
  daily_limit: number;
  last_run_at: number | null;
  runs_today: number;
  runs_total: number;
  recent: WorkflowRun[];
}

export type WorkflowInput = Partial<Pick<Workflow, "name" | "enabled" | "trigger" | "trigger_days" | "match" | "conditions" | "actions" | "account_ids" | "daily_limit">>;

export interface WorkflowPreview {
  scanned: number;
  total: number;
  /** An AI condition was left out of the check: the AI is not asked for a preview. */
  ai_skipped: boolean;
  matches: { thread_id: string; subject: string; from: string }[];
}

export function useWorkflows() {
  return useQuery({ queryKey: ["workflows"], queryFn: () => api.get<Workflow[]>("/api/workflows"), refetchInterval: 30_000 });
}

export function useWorkflowRuns(id: string | null) {
  return useQuery({ queryKey: ["workflows", id, "runs"], queryFn: () => api.get<{ runs: WorkflowRun[] }>(`/api/workflows/${id}/runs`), enabled: !!id });
}

export function useWorkflowMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["workflows"] });
  return {
    create: useMutation({ mutationFn: (b: WorkflowInput) => api.post<Workflow>("/api/workflows", b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, ...b }: WorkflowInput & { id: string }) => api.put<Workflow>(`/api/workflows/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/workflows/${id}`), onSuccess: inv }),
  };
}

/** Which recent conversations a workflow would pick out. Nothing is changed. */
export function useWorkflowPreview() {
  return useMutation({ mutationFn: (b: WorkflowInput) => api.post<WorkflowPreview>("/api/workflows/preview", b) });
}

export interface WorkflowSuggestion {
  key: string;
  title: string;
  why: string;
  def: WorkflowInput;
}

/** What the person keeps doing by hand that a workflow could do. */
export function useWorkflowSuggestions() {
  return useQuery({ queryKey: ["workflows", "suggestions"], queryFn: () => api.get<{ suggestions: WorkflowSuggestion[] }>("/api/workflows/suggestions"), staleTime: 60_000 });
}

export interface CheckupNote {
  kind: string;
  workflow_ids: string[];
  message: string;
}

export function useWorkflowCheckup() {
  return useQuery({ queryKey: ["workflows", "checkup"], queryFn: () => api.get<{ notes: CheckupNote[] }>("/api/workflows/checkup"), staleTime: 60_000 });
}

export function useRecentThreads(enabled: boolean) {
  return useQuery({ queryKey: ["workflows", "recent"], queryFn: () => api.get<{ threads: { thread_id: string; subject: string; from: string }[] }>("/api/workflows/recent"), enabled, staleTime: 30_000 });
}

export interface ThreadCheck {
  subject: string;
  would_act: boolean | null;
  blockers: string[];
  conditions: { text: string; ok: boolean | null }[];
}

/** Whether a workflow would act on one conversation, and why. Nothing is changed. */
export function useWorkflowThreadCheck(id: string) {
  return useMutation({ mutationFn: (thread_id: string) => api.post<ThreadCheck>(`/api/workflows/${id}/check`, { thread_id }) });
}
