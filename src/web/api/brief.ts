import { useEffect, useRef } from "react";
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface BriefItem {
  thread_id: string;
  account_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  kind: "reply" | "decide" | "deadline" | "waiting";
  why: string;
  urgent: boolean;
  age_days: number;
}

export interface BriefMeeting {
  id: string;
  title: string;
  starts_at: number;
  ends_at: number;
  all_day: boolean;
  join_url: string;
  location: string;
}

export interface DailyBrief {
  day: string;
  headline: string;
  items: BriefItem[];
  meetings: BriefMeeting[];
  source: "ai" | "rules";
  created_at: number;
  /** The day's thought, when the AI has written one. */
  thought?: { theme: string; quote: string; advice: string; affirmation: string } | null;
  /** Quotes of the thoughts shown today. */
  thought_history?: string[];
}

export interface BriefResponse {
  brief: DailyBrief;
  /** The AI is still writing its version; ask again shortly. */
  pending: boolean;
  ai_enabled: boolean;
  cooldown?: boolean;
}

export function useBrief(enabled = true) {
  const polls = useRef(0);
  return useQuery({
    queryKey: ["brief"],
    queryFn: () => api.get<BriefResponse>("/api/brief"),
    enabled,
    staleTime: 60_000,
    // While the AI is still working, ask again every few seconds (a handful of times); otherwise look now and then.
    refetchInterval: (q) => {
      if (!q.state.data?.pending) {
        polls.current = 0;
        return 10 * 60_000;
      }
      polls.current += 1;
      return polls.current <= 8 ? 5_000 : 10 * 60_000;
    },
  });
}

/** Ask for another thought now. The answer is today's brief with the new thought as its current one. */
export function useNextThought() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefResponse>("/api/brief/thought"),
    onSuccess: (r) => qc.setQueryData(["brief"], r),
  });
}

export interface ThoughtView {
  theme: string;
  quote: string;
  advice: string;
  affirmation: string;
  basis?: string;
}

export type Mood = "loved" | "happy" | "meh" | "sad";

export interface ThoughtReaction {
  key: string;
  thought: ThoughtView;
  reaction: Mood | null;
  saved: boolean;
  updated_at: number;
}

export function useThoughts(enabled = true) {
  return useQuery({ queryKey: ["thoughts"], queryFn: () => api.get<{ items: ThoughtReaction[] }>("/api/brief/thoughts"), enabled, staleTime: 60_000 });
}

/** Like, dislike or save a thought. The list updates at once and is put back if the server says no. */
export function useThoughtSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; thought: ThoughtView; reaction: Mood | null; saved: boolean }) => api.put(`/api/brief/thoughts/${v.key}`, { thought: v.thought, reaction: v.reaction, saved: v.saved }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["thoughts"] });
      const prev = qc.getQueryData<{ items: ThoughtReaction[] }>(["thoughts"]);
      const rest = (prev?.items ?? []).filter((i) => i.key !== v.key);
      const items = v.reaction || v.saved ? [{ key: v.key, thought: v.thought, reaction: v.reaction, saved: v.saved, updated_at: Date.now() }, ...rest] : rest;
      qc.setQueryData(["thoughts"], { items });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["thoughts"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["thoughts"] }),
  });
}

/** The AI's one line about a thread's newest message, or null (no AI, nothing to say, or still being written). Kept a good while. */
export function useGist(threadId: string | undefined) {
  return useQuery({
    queryKey: ["ai", "gist", threadId],
    queryFn: () => api.post<{ gist: string | null }>("/api/ai/gist", { thread_id: threadId }),
    enabled: !!threadId,
    staleTime: 60 * 60_000,
    retry: false,
  });
}

/** The saved one-line summary of a thread as the cache holds it, with `initial` (what the list sent along) as the start. It never asks the server. */
export function useGistLine(threadId: string, initial?: string | null): string | null {
  const q = useQuery({ queryKey: ["ai", "gist", threadId], queryFn: skipToken, initialData: initial ? { gist: initial } : undefined, staleTime: Infinity });
  return (q.data as { gist: string | null } | undefined)?.gist ?? initial ?? null;
}

/** How many missing lines one request asks for; the server writes them one after the other. */
const GIST_BATCH = 6;

/**
 * The cards of a list that came without their one-line summary get them in one request (and a follow-up for the rest), not one request each.
 * Each line lands in the cache where `useGistLine` reads it. Asked once per thread; with no AI set up it asks nothing.
 */
export function useFillGists(threads: { id: string; gist?: string | null }[], enabled: boolean) {
  const qc = useQueryClient();
  const asked = useRef<Set<string>>(new Set());
  const off = useRef(false);
  const missing = threads.filter((t) => !t.gist && !asked.current.has(t.id)).slice(0, GIST_BATCH).map((t) => t.id);
  const key = missing.join(",");
  useEffect(() => {
    if (!enabled || off.current || !key) return;
    const ids = key.split(",");
    for (const id of ids) asked.current.add(id);
    api
      .post<{ gists: Record<string, string>; off?: boolean }>("/api/ai/gists", { thread_ids: ids })
      .then((r) => {
        if (r.off) off.current = true;
        for (const [id, gist] of Object.entries(r.gists ?? {})) qc.setQueryData(["ai", "gist", id], { gist });
      })
      .catch(() => {});
  }, [key, enabled, qc]);
}

export function useBriefRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefResponse>("/api/brief/refresh"),
    onSuccess: (r) => qc.setQueryData(["brief"], r),
  });
}
