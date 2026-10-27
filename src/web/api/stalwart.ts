import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, request } from "./client";
import { invalidateMail, keys } from "./keys";

const stalwartKey = (serverId?: string, part?: string) => (serverId ? (["stalwart", serverId, part ?? ""] as const) : (["stalwart"] as const));

export function useStalwartServers(enabled = true) {
  return useQuery({ queryKey: ["stalwart", "servers"], queryFn: () => api.get<T.StalwartServer[]>("/api/stalwart"), enabled, staleTime: 15_000 });
}

export function useStalwartServerMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["stalwart"] });
  return {
    create: useMutation({
      mutationFn: (b: { name?: string; base_url: string; api_key: string; imap_host?: string; imap_port?: number; smtp_host?: string; smtp_port?: number }) =>
        api.post<T.StalwartServer>("/api/stalwart", b),
      onSuccess: inv,
    }),
    rotateKey: useMutation({
      mutationFn: ({ id, api_key }: { id: string; api_key: string }) => request<T.StalwartServer>("PUT", `/api/stalwart/${id}/key`, { api_key }),
      onSuccess: inv,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/stalwart/${id}`),
      onSuccess: () => { inv(); qc.invalidateQueries({ queryKey: keys.me }); },
    }),
  };
}

export function useStalwartDomains(serverId?: string) {
  return useQuery({ queryKey: stalwartKey(serverId, "domains"), queryFn: () => api.get<T.StalwartDomain[]>(`/api/stalwart/${serverId}/domains`), enabled: !!serverId, staleTime: 10_000, retry: false });
}

export function useStalwartMailboxes(serverId?: string) {
  return useQuery({ queryKey: stalwartKey(serverId, "mailboxes"), queryFn: () => api.get<T.StalwartMailbox[]>(`/api/stalwart/${serverId}/mailboxes`), enabled: !!serverId, staleTime: 10_000, retry: false });
}

export function useStalwartMutations(serverId: string) {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["stalwart"] });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  const base = `/api/stalwart/${serverId}`;
  return {
    createDomain: useMutation({ mutationFn: (name: string) => api.post<T.StalwartDomain>(`${base}/domains`, { name }), onSuccess: inv }),
    setDomainEnabled: useMutation({
      mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) => api.patch<{ ok: boolean }>(`${base}/domains/${id}`, { is_enabled }),
      onSuccess: inv,
    }),
    deleteDomain: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`${base}/domains/${id}`), onSuccess: inv }),
    createMailbox: useMutation({
      mutationFn: (b: { name: string; domain_id: string; display_name?: string; password?: string; agent?: boolean }) => api.post<T.StalwartMailboxCreated>(`${base}/mailboxes`, b),
      onSuccess: inv,
    }),
    connectMailbox: useMutation({
      mutationFn: ({ id, display_name, import_recent }: { id: string; display_name?: string; import_recent?: number }) =>
        api.post<T.StalwartMailboxCreated>(`${base}/mailboxes/${id}/connect`, { confirm_reset: true, display_name, import_recent }),
      onSuccess: inv,
    }),
    resetPassword: useMutation({
      mutationFn: ({ id, password }: { id: string; password?: string }) => api.post<{ ok: boolean; password?: string }>(`${base}/mailboxes/${id}/reset-password`, { password }),
      onSuccess: inv,
    }),
    deleteMailbox: useMutation({
      mutationFn: ({ id, email }: { id: string; email: string }) => api.del<{ ok: boolean }>(`${base}/mailboxes/${id}?confirm=${encodeURIComponent(email)}`),
      onSuccess: () => { inv(); invalidateMail(qc); },
    }),
    resyncAll: useMutation({
      mutationFn: ({ count, all }: { count?: number; all?: boolean }) => api.post<{ ok: boolean; mailboxes: number; queued: number }>(`${base}/resync`, { count, all }),
      onSuccess: inv,
    }),
    dnsCheck: (domainId: string) => api.get<{ domain: string; checked_at: number; records: T.DnsCheckResult[] }>(`${base}/domains/${domainId}/dns-check`),
    zone: (domainId: string) => api.get<{ zone: string }>(`${base}/domains/${domainId}/zone`),
  };
}

