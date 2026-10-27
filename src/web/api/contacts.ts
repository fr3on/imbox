import { useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, qs } from "./client";
import { invalidateMail, keys } from "./keys";

export function useContacts(q: string, enabled = true) {
  return useQuery({ queryKey: keys.contacts(q), queryFn: () => api.get<T.MergedContact[]>(`/api/contacts${qs({ q })}`), enabled, staleTime: 30_000 });
}

export interface Suggestion { email: string; name: string; avatar_url: string }

export function useSuggest(q: string, enabled = true) {
  return useQuery({ queryKey: ["suggest", q], queryFn: () => api.get<Suggestion[]>(`/api/contacts/suggest${qs({ q })}`), enabled, staleTime: 60_000 });
}

export function useContact(id: string | undefined, bucket?: string) {
  return useInfiniteQuery({
    queryKey: [...keys.contact(id ?? ""), bucket ?? ""],
    queryFn: ({ pageParam }) => api.get<{ contact: T.MergedContact; threads: T.ThreadSummary[]; next_page: number | null }>(`/api/contacts/${id}${qs({ bucket, page: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
    // The person comes from the first page; the conversations are every page loaded so far.
    select: (d) => ({ contact: d.pages[0].contact, threads: d.pages.flatMap((p) => p.threads) }),
    enabled: !!id,
  });
}

export interface OpenLoop { thread_id: string; account_id: string; subject: string; at: number; days: number }

export interface ContactInsights {
  waiting_on_you: OpenLoop[];
  waiting_on_them: OpenLoop[];
  months: { m: string; n: number }[];
  busiest: { m: string; n: number } | null;
  files: { id: string; filename: string; size: number; at: number; thread_id: string }[];
  file_count: number;
  conversations: number;
}

/** What the mail says about one person: what is open between you, messages per month, and files. */
export function useContactInsights(id: string | undefined) {
  return useQuery({ queryKey: ["contacts", "insights", id ?? ""], queryFn: () => api.get<ContactInsights>(`/api/contacts/${id}/insights`), enabled: !!id, staleTime: 60_000 });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; notes?: string; screen_status?: T.ScreenStatus; bundled?: boolean; scope?: T.DecisionScope }) => api.patch<T.MergedContact>(`/api/contacts/${id}`, body),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: keys.contact(v.id) });
      invalidateMail(qc);
    },
  });
}

export interface ContactReview {
  email: string;
  suggest: "imbox" | "feed" | "paper_trail";
  reason: string;
}

/** The AI's second look at where your senders are filed. While it is still working, ask again every few seconds (a handful of times). */
export function useContactReview(enabled = true) {
  const polls = useRef(0);
  return useQuery({
    queryKey: ["contact-review"],
    queryFn: () => api.get<{ suggestions: ContactReview[]; pending: boolean; enabled: boolean }>("/api/ai/contact-review"),
    enabled,
    staleTime: 60_000,
    retry: false,
    refetchInterval: (q) => {
      if (!q.state.data?.pending) {
        polls.current = 0;
        return false;
      }
      polls.current += 1;
      return polls.current <= 6 ? 6_000 : false;
    },
  });
}

export function markContactReview(email: string, state: "dismissed" | "applied") {
  return api.post("/api/ai/contact-review/state", { email, state }).catch(() => {});
}

export interface PersonPeek {
  known: boolean;
  email: string;
  id?: string;
  name?: string;
  avatar_url?: string;
  screen_status?: T.ScreenStatus | "mixed";
  message_count?: number;
  first_seen_at?: number;
  last_seen_at?: number;
  mailboxes?: number;
  note?: string;
}

/** What Imbox knows about an address, for the hover card on an avatar. Only asked once the card opens. */
export function usePersonPeek(email: string, enabled: boolean) {
  return useQuery({
    queryKey: ["contacts", "peek", email.toLowerCase()],
    queryFn: () => api.get<PersonPeek>(`/api/contacts/peek${qs({ email })}`),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Move several contacts at once. There is no bulk endpoint, so each is updated in turn and the lists refresh once at the end. */
export function useBulkContactStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: T.ScreenStatus }) => {
      const results = await Promise.allSettled(ids.map((id) => api.patch<T.MergedContact>(`/api/contacts/${id}`, { screen_status: status })));
      return { ok: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      invalidateMail(qc);
    },
  });
}
