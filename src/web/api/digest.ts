import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface DigestSection {
  theme: string;
  text: string;
  sources: { thread_id: string; from: string; subject: string }[];
}

export interface DigestResponse {
  digest: { day: string; sections: DigestSection[]; count: number; created_at: number } | null;
  /** How many unread newsletters, receipts and notices there are to write about. */
  count: number;
  /** New mail has come in since the digest was written (or none was written yet). */
  stale: boolean;
  ai_enabled: boolean;
  /** Which mail it covers; the page asks for a fresh digest once per key. */
  key: string;
}

/** Today's Updates digest as last written. Reading it never calls the model. */
export function useDigest(enabled = true) {
  return useQuery({ queryKey: ["digest"], queryFn: () => api.get<DigestResponse>("/api/digest"), enabled, staleTime: 60_000 });
}

/** Have the AI write it now (a few seconds). The answer replaces what the page holds. */
export function useDigestRefresh() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { force?: boolean } = {}) => api.post<DigestResponse>("/api/digest/refresh", opts),
    onSuccess: (r) => qc.setQueryData(["digest"], r),
  });
}
