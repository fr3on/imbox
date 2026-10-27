import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, qs } from "./client";
import { invalidateMail } from "./keys";

export function useBundle(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["bundle", id ?? ""],
    queryFn: ({ pageParam }) => api.get<T.BundleDetail>(`/api/bundles/${id}${qs({ page: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
    // The summary comes from the first page; the threads are every page loaded so far.
    select: (d): T.BundleDetail => ({ bundle: d.pages[0].bundle, threads: d.pages.flatMap((p) => p.threads) }),
    enabled: !!id,
  });
}

export function useBundleMutations() {
  const qc = useQueryClient();
  const inv = (id: string) => {
    qc.invalidateQueries({ queryKey: ["bundle", id] });
    invalidateMail(qc);
  };
  return {
    seen: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean }>(`/api/bundles/${id}/seen`), onSuccess: (_r, id) => inv(id) }),
    unseen: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean }>(`/api/bundles/${id}/unseen`), onSuccess: (_r, id) => inv(id) }),
    dissolve: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/bundles/${id}`), onSuccess: (_r, id) => inv(id) }),
  };
}
