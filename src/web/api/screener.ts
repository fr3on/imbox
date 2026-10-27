import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, qs } from "./client";
import { invalidateMail, keys } from "./keys";

export interface ScreenerAi {
  bucket: "imbox" | "feed" | "paper_trail" | "screened_out";
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface ScreenerSender {
  account_id: string;
  contact: T.Contact;
  /** The newest few; `thread_count` is how many the sender has waiting. */
  threads: T.ThreadSummary[];
  thread_count?: number;
  suggestion: "imbox" | "feed" | "paper_trail";
  /** The AI's read on this sender, when it has looked at them. */
  ai?: ScreenerAi;
}

export function useScreener(enabled = true) {
  // While the AI is still working through new senders, ask again every few seconds (a handful of times), then go back to the usual pace.
  const polls = useRef(0);
  return useQuery({
    queryKey: keys.screener,
    queryFn: () => api.get<{ senders: ScreenerSender[]; total?: number; ai_pending?: number }>("/api/screener"),
    refetchInterval: (q) => {
      if (!q.state.data?.ai_pending) {
        polls.current = 0;
        return 60_000;
      }
      polls.current += 1;
      return polls.current <= 6 ? 6_000 : 60_000;
    },
    enabled,
  });
}

/** People let in without asking, not yet looked over. Shown at the top of the Screener, each with an Undo. */
export function useAutoLetIns(enabled = true) {
  return useQuery({ queryKey: ["screener", "auto"], queryFn: () => api.get<{ people: T.AutoLetIn[] }>("/api/screener/auto"), enabled, refetchInterval: 60_000 });
}

export function useAutoLetInSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/api/screener/auto/seen"),
    onSuccess: () => qc.setQueryData(["screener", "auto"], { people: [] }),
  });
}

export function useUndoAutoLetIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/api/screener/auto/${id}/undo`),
    onMutate: (id) => qc.setQueryData<{ people: T.AutoLetIn[] }>(["screener", "auto"], (old) => (old ? { people: old.people.filter((p) => p.id !== id) } : old)),
    onSettled: () => invalidateMail(qc),
  });
}

/** "Not now" on a suggestion to move one Feeds or Paper Trail thread to the Imbox. */
export function useDismissImboxHint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/api/threads/${id}/hint/dismiss`),
    onSettled: () => invalidateMail(qc),
  });
}

export function useScreenerDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { contact_id: string; decision: T.ScreenStatus; scope?: T.DecisionScope; threads?: T.ThreadSummary[]; thread_count?: number }) =>
      api.post<{ ok: boolean }>("/api/screener/decide", { contact_id: p.contact_id, decision: p.decision, scope: p.scope }),
    // Waiting for the decide request and a fresh GET /api/imbox leaves the better part of a second of an
    // empty Screener. Drop their threads straight into the Imbox cache now; the refetch below reconciles
    // it with the server's own view.
    onMutate: ({ contact_id, decision, threads, thread_count }) => {
      const leaving = qc.getQueryData<{ senders: ScreenerSender[]; total?: number }>(keys.screener)?.senders.find((s) => s.contact.id === contact_id);
      qc.setQueryData<{ senders: ScreenerSender[]; total?: number }>(keys.screener, (old) => (old ? { ...old, senders: old.senders.filter((s) => s.contact.id !== contact_id), total: old.total === undefined ? undefined : Math.max(0, old.total - 1) } : old));
      // The Imbox's own "N senders waiting" banner reads a separate cached count/list. Every decision
      // (including screening someone out) updates it here, or it keeps the old count until the invalidated
      // GET /api/imbox comes back and reads as "still there for a few seconds".
      if (leaving) {
        qc.setQueriesData<T.ImboxResponse>({ queryKey: keys.imbox }, (old) => {
          if (!old?.screener_senders.some((s) => s.email === leaving.contact.email)) return old;
          return { ...old, screener_count: Math.max(0, old.screener_count - 1), screener_senders: old.screener_senders.filter((s) => s.email !== leaving.contact.email) };
        });
        qc.setQueryData<T.Counts>(keys.counts, (old) => (old ? { ...old, screener: Math.max(0, old.screener - 1) } : old));
      }
      if (decision === "imbox" && threads?.length) {
        const incoming = threads.map((t) => ({ ...t, bucket: "imbox" as const, seen: false, unread: true }));
        qc.setQueriesData<T.ImboxResponse>({ queryKey: keys.imbox }, (old) => {
          if (!old) return old;
          const existing = new Set(old.new_threads.map((t) => t.id));
          const fresh = incoming.filter((t) => !existing.has(t.id));
          if (!fresh.length) return old;
          return { ...old, new_threads: [...fresh, ...old.new_threads].sort((a, b) => b.last_message_at - a.last_message_at) };
        });
        qc.setQueryData<T.Counts>(keys.counts, (old) => (old ? { ...old, imbox_new: old.imbox_new + (thread_count ?? threads.length) } : old));
      }
    },
    onSettled: (_data, _err, { decision }) => {
      qc.invalidateQueries({ queryKey: keys.imbox });
      qc.invalidateQueries({ queryKey: keys.counts });
      qc.invalidateQueries({ queryKey: keys.screener });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      if (decision === "feed" || decision === "paper_trail") qc.invalidateQueries({ queryKey: keys.feed("library") });
      if (decision === "feed") qc.invalidateQueries({ queryKey: keys.feed("feed") });
      else if (decision === "paper_trail") qc.invalidateQueries({ queryKey: keys.feed("paper_trail") });
      else if (decision === "screened_out") qc.invalidateQueries({ queryKey: keys.screenedOut });
    },
  });
}

export interface ScreenedOutPage { contacts: T.MergedContact[]; total: number; page: number; pages: number; page_size: number }

export function useScreenedOut(q = "", page = 1) {
  return useQuery({
    queryKey: [...keys.screenedOut, q, page],
    queryFn: () => api.get<ScreenedOutPage>(`/api/screener/screened-out${qs({ q, page })}`),
    placeholderData: (prev) => prev,
  });
}
