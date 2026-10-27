import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, getAccountId, qs } from "./client";
import { invalidateMail, keys } from "./keys";

export function useLabels(enabled = true) {
  return useQuery({ queryKey: keys.labels, queryFn: () => api.get<T.Label[]>("/api/labels"), enabled, staleTime: 60_000 });
}

export function useLabelMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: keys.labels });
    invalidateMail(qc);
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string; color: string; account_id?: string }) => api.post<T.Label>("/api/labels", b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string }) => api.patch<T.Label>(`/api/labels/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/labels/${id}`), onSuccess: inv }),
  };
}

export function useLabelThreads(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["threads", "label", id],
    queryFn: ({ pageParam }) => api.get<{ threads: T.ThreadSummary[]; next_page: number | null }>(`/api/labels/${id}/threads${qs({ page: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
    enabled: !!id,
    refetchInterval: 60_000,
  });
}

export function useCollections(enabled = true) {
  return useQuery({ queryKey: keys.collections, queryFn: () => api.get<T.Collection[]>("/api/collections"), enabled });
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: keys.collection(id ?? ""),
    queryFn: () => api.get<{ collection: T.Collection; threads: T.ThreadSummary[]; files: T.Attachment[] }>(`/api/collections/${id}`),
    enabled: !!id,
  });
}

export function useCollectionMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: keys.collections });
    qc.invalidateQueries({ queryKey: ["collection"] });
    qc.invalidateQueries({ queryKey: ["thread"] });
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string; description?: string; account_id?: string }) => api.post<T.Collection>("/api/collections", b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; description?: string }) => api.patch<T.Collection>(`/api/collections/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/collections/${id}`), onSuccess: inv }),
  };
}

export function useClips() {
  return useQuery({ queryKey: keys.clips, queryFn: () => api.get<T.Clip[]>("/api/clips") });
}

export function useClipMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: keys.clips });
    qc.invalidateQueries({ queryKey: ["thread"] });
  };
  return {
    create: useMutation({ mutationFn: (b: { thread_id: string; message_id?: string; text: string; account_id?: string }) => api.post<T.Clip>("/api/clips", b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/clips/${id}`), onSuccess: inv }),
  };
}

export interface FilesPage {
  files: T.Attachment[];
  next_page: number | null;
}

export function useFiles() {
  return useInfiniteQuery({
    queryKey: keys.files,
    queryFn: ({ pageParam }) => api.get<FilesPage>(`/api/files${qs({ page: pageParam })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_page ?? undefined,
  });
}

export function attachmentUrl(messageId: string, attId: string, download = false) {
  const acc = getAccountId();
  return `/api/messages/${messageId}/attachments/${attId}${qs({ download: download ? 1 : undefined, account: acc && acc !== "all" ? acc : undefined })}`;
}
