import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./client";

export type Actor = "you" | "rules" | "ai" | "agent" | "sync" | "security";

export interface ActivityEvent {
  sid: string;
  at: number;
  actor: Actor;
  kind: string;
  summary: string;
  why: string;
  thread_id: string | null;
  account_id: string | null;
  level: "info" | "warn" | "error";
}

export interface ActivityFilters {
  actor?: Actor | "";
  problems?: boolean;
  q?: string;
  thread?: string;
}

/** The activity log a page at a time, newest first. */
export function useActivity(f: ActivityFilters) {
  return useInfiniteQuery({
    queryKey: ["activity", f.actor ?? "", !!f.problems, f.q ?? "", f.thread ?? ""],
    queryFn: ({ pageParam }) =>
      api.get<{ events: ActivityEvent[]; next: string | null }>(`/api/activity${qs({ actor: f.actor || undefined, problems: f.problems ? 1 : undefined, q: f.q || undefined, thread: f.thread || undefined, before: pageParam || undefined })}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
    // Keep the list on screen while a filter or a search loads.
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
}

export function useClearActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true }>("/api/activity"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity"] }),
  });
}
