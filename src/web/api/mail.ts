import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import type { SearchPlan } from "@shared/searchPlan";
import { api, qs, } from "./client";
import { invalidateMail, keys } from "./keys";
import { useLivePoll } from "./live";
import { markThreadsSeen, removeThreadsFromLists, seenFromAction } from "./threadCache";

export function useCounts(enabled = true) {
  return useQuery({ queryKey: keys.counts, queryFn: () => api.get<T.Counts>("/api/counts"), refetchInterval: useLivePoll(60_000), enabled });
}

export function useImbox(enabled = true) {
  return useQuery({ queryKey: keys.imbox, queryFn: () => api.get<T.ImboxResponse>("/api/imbox"), refetchInterval: useLivePoll(60_000), enabled });
}

export interface SearchFacets {
  senders: { email: string; name: string; count: number }[];
  places: { bucket: string; count: number }[];
  years: { year: number; count: number }[];
  mailboxes: { email: string; count: number }[];
}

export interface ThreadsPage {
  threads: T.ThreadSummary[];
  /** Search: the words that were actually looked for, to mark in the results. */
  terms?: string[];
  /** Search: no mail had every word, so these are the ones that match fewer of them. */
  relaxed?: boolean;
  /** Search, first page: the counts that let the search be narrowed with a click. */
  facets?: SearchFacets | null;
  bundles?: T.Bundle[];
  contacts?: T.MergedContact[];
  files?: T.Attachment[];
  events?: T.CalEvent[];
  counts?: {
    threads: number;
    contacts: number;
    files: number;
    events: number;
    total: number;
  };
  next_page: number | null;
  q?: string;
}

export interface ThreadFilters {
  in?: string; // Everything only: imbox, feed, paper_trail or screener
  unread?: boolean;
  attach?: boolean;
  days?: number;
}

export function useThreads(bucket: string, opts: { q?: string; label?: string; filters?: ThreadFilters; enabled?: boolean } = {}) {
  const f = opts.filters ?? {};
  return useInfiniteQuery({
    queryKey: keys.threads(bucket, opts.q, opts.label, JSON.stringify(f)),
    queryFn: ({ pageParam }) =>
      api.get<ThreadsPage>(`/api/threads${qs({ bucket, q: opts.q, label: opts.label, in: f.in, unread: f.unread ? 1 : undefined, attach: f.attach ? 1 : undefined, days: f.days, page: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
    refetchInterval: useLivePoll(60_000),
    // Keep the old list on screen while a new search or filter loads, so typing does not flash the skeleton.
    placeholderData: (prev) => prev,
    enabled: opts.enabled ?? true,
  });
}

export type FeedBucket = "feed" | "paper_trail";

export type FeedThread = T.ThreadSummary & { latest_message: T.Message; files?: T.Attachment[]; /** The AI's saved one line about it, when there is one. */ gist?: string | null };

export interface FeedApiPage {
  threads: FeedThread[];
  next_page: number | null;
  /** Where the next page starts: after the last thread of this one. Paging by this does not skip anything when threads leave the list meanwhile. */
  next_cursor?: string | null;
}

/** What narrows the Updates list on the server: words to search for, and only the threads that carry files. */
export interface FeedFilters {
  q?: string;
  files?: boolean;
}

/** Backs both The Feed and Paper Trail — same full-card reading UI, two different screener destinations. */
export function useFeed(enabled = true, show: "new" | "all" = "new", bucket: FeedBucket | "library" = "feed", f: FeedFilters = {}) {
  const q = (f.q ?? "").trim();
  const files = !!f.files;
  return useInfiniteQuery({
    queryKey: [...keys.feed(bucket), show, q, files],
    queryFn: ({ pageParam }) => api.get<FeedApiPage>(`/api/feed${qs({ cursor: pageParam || undefined, show, bucket, q: q || undefined, files: files ? 1 : undefined })}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: useLivePoll(60_000),
    // Keep the old list on screen while a new search loads, so typing does not flash the skeleton.
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** `exact`: search the words as typed. `relax`: the request was read by the page, so look for fewer of its words if no mail has them all. */
export function useSearch(q: string, sort: "best" | "newest" = "best", opts: { exact?: boolean; relax?: boolean } = {}) {
  const { exact = false, relax = false } = opts;
  return useInfiniteQuery({
    queryKey: keys.search(q, sort, exact, relax),
    queryFn: ({ pageParam }) =>
      api.get<ThreadsPage>(`/api/search${qs({ q, page: pageParam, sort: sort === "newest" ? "newest" : undefined, exact: exact ? 1 : undefined, relax: relax ? 1 : undefined })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
    enabled: q.trim().length > 0,
  });
}

/** A request in plain words read into filters by the AI. Null when AI is off, slow, or could not read it: the page then uses its own rules. */
export async function readRequestWithAi(q: string, ms = 6000): Promise<SearchPlan | null> {
  try {
    const out = await Promise.race([
      api.post<{ plan: SearchPlan | null }>("/api/ai/search-plan", { q }),
      new Promise<null>((r) => setTimeout(() => r(null), ms)),
    ]);
    return out?.plan ?? null;
  } catch {
    return null;
  }
}

export interface SearchAnswer {
  answer: string;
  sources: { thread_id: string; subject: string; from: string; at: number }[];
  off?: boolean;
  error?: string;
}

/** A short answer to a question typed into search. Asked once per search, and only when asked for (`enabled`). `search` is the question read into
 *  words and filters, when the page did that: it finds the mail, and `q` is what the answer is written to. */
export function useSearchAnswer(q: string, enabled: boolean, search?: string) {
  return useQuery({
    queryKey: ["search-answer", q, search ?? ""],
    queryFn: () => api.post<SearchAnswer>("/api/ai/search-answer", { q, search }),
    enabled: enabled && q.trim().length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** What the current results are about, in a few sentences with the messages it came from. Only when asked for (`enabled`). */
export function useSearchOverview(q: string, relaxed: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ["search-overview", q, relaxed],
    queryFn: () => api.post<SearchAnswer>("/api/ai/search-answer", { q, mode: "overview", relaxed }),
    enabled: enabled && q.trim().length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  created_at: number;
}

export function useSavedSearches() {
  return useQuery({ queryKey: keys.savedSearches, queryFn: () => api.get<SavedSearch[]>("/api/searches") });
}

export function useSavedSearchMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: keys.savedSearches });
  return {
    save: useMutation({ mutationFn: (b: { q: string; name?: string }) => api.post<SavedSearch>("/api/searches", b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/searches/${id}`), onSuccess: inv }),
  };
}

export function useThread(id: string | undefined, peek = false) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: keys.thread(id ?? "", peek),
    queryFn: () => api.get<T.ThreadDetail>(`/api/threads/${id}${peek ? "?peek=1" : ""}`),
    enabled: !!id,
    // A thread that was peeked at (the assistant panel, the Reply Later page) paints from that copy
    // at once; the real fetch behind it is what marks it read.
    placeholderData: peek ? undefined : () => qc.getQueryData<T.ThreadDetail>(keys.thread(id ?? "", true)),
  });
  // Fetching a thread (not peeking at it) is what marks it read on the server. Going back to the
  // list should show that immediately, not whenever the list next happens to refetch.
  const seenId = !peek && q.data?.seen ? q.data.id : null;
  useEffect(() => {
    if (seenId) markThreadsSeen(qc, [seenId], true);
  }, [qc, seenId]);
  return q;
}

export type ThreadAction =
  | { action: "mark_unread" | "mark_read" | "seen" | "delete" }
  | { action: "reply_later"; on: boolean }
  | { action: "set_aside"; on: boolean }
  | { action: "bubble_up"; at: number | null }
  | { action: "move"; bucket: T.Bucket }
  | { action: "rename"; subject: string | null }
  | { action: "note"; note: string }
  | { action: "merge"; thread_ids: string[] }
  | { action: "labels"; add?: string[]; remove?: string[] }
  | { action: "collections"; add?: string[]; remove?: string[] }
  | { action: "bundle"; on: boolean };

export function useThreadAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ThreadAction) => api.post<T.ThreadDetail>(`/api/threads/${id}/actions`, a),
    onMutate: (a) => {
      const seen = seenFromAction(a);
      if (seen !== null) markThreadsSeen(qc, [id], seen);
    },
    onSuccess: (data) => {
      qc.setQueryData(keys.thread(id), data);
      qc.setQueryData(keys.thread(id, true), data);
      invalidateMail(qc);
    },
  });
}

export function useBulkAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ thread_ids, ...a }: ThreadAction & { thread_ids: string[] }) => api.post<{ ok: boolean }>("/api/threads/bulk", { thread_ids, ...a }),
    onMutate: ({ thread_ids, ...a }) => {
      // Optimistic: actions that remove the thread from the current list
      const removing = ["reply_later", "set_aside", "bubble_up", "move", "delete"].includes(a.action) && !("on" in a && a.on === false) && !("at" in a && a.at === null);
      if (removing) removeThreadsFromLists(qc, thread_ids);
      const seen = seenFromAction(a as ThreadAction);
      if (seen !== null) markThreadsSeen(qc, thread_ids, seen);
    },
    onSettled: () => invalidateMail(qc),
  });
}

/** Delete everything in the trash for good. */
export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; deleted: number }>("/api/threads/empty-trash", {}),
    onSettled: () => invalidateMail(qc),
  });
}
