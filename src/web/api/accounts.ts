import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, request } from "./client";
import { invalidateMail, keys } from "./keys";

export interface SyncManyResult {
  ok: boolean;
  added: number;
  results: { id: string; ok: boolean; added: number; status: string }[];
}

export const syncAccounts = (ids?: string[]) => api.post<SyncManyResult>("/api/accounts/sync", ids ? { ids } : {});

export function useAccountMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: keys.me });
  return {
    update: useMutation({ mutationFn: ({ id, ...b }: { id: string; signature?: string; cover_art?: string; display_name?: string }) => api.patch<T.Account>(`/api/accounts/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/accounts/${id}`), onSuccess: () => { inv(); invalidateMail(qc); } }),
    sync: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean; added?: number }>(`/api/accounts/${id}/sync`), onSuccess: () => { inv(); invalidateMail(qc); } }),
    /** Sync several mailboxes (all of them by default) in one request. */
    syncMany: useMutation({ mutationFn: (ids?: string[]) => syncAccounts(ids), onSuccess: () => { inv(); invalidateMail(qc); } }),
    reset: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean; account: T.Account; sync_error: string | null }>(`/api/accounts/${id}/reset`), onSuccess: () => { inv(); invalidateMail(qc); } }),
    syncPhotos: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean; updated: number }>(`/api/accounts/${id}/sync-photos`), onSuccess: () => { inv(); invalidateMail(qc); } }),
  };
}

export function useMeMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: keys.me });
  return {
    update: useMutation({ mutationFn: (b: { name?: string; settings?: T.UserSettings }) => api.patch<{ user: T.User }>("/api/me", b), onSuccess: inv }),
    password: useMutation({ mutationFn: (b: { current: string; next: string }) => api.post<{ ok: boolean }>("/api/me/password", b) }),
  };
}

export interface OAuthCredentialStatus {
  provider: "google" | "microsoft";
  configured: boolean;
  /** Which credentials are in use right now. */
  source: "env" | "db" | "none";
  /** An environment variable exists for this provider, whether or not it is the one in use. */
  env_available: boolean;
  /** Stored credentials are deliberately overriding an environment variable. */
  overriding: boolean;
  client_id: string;
  secret_hint: string;
}

export function useOAuthCredentials() {
  return useQuery({ queryKey: ["oauth"], queryFn: () => api.get<OAuthCredentialStatus[]>("/api/oauth"), staleTime: 30_000 });
}

export function useOAuthMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["oauth"] });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  return {
    save: useMutation({
      mutationFn: (b: { provider: string; client_id?: string; client_secret?: string | null; override_env?: boolean }) =>
        request<OAuthCredentialStatus>("PUT", `/api/oauth/${b.provider}`, {
          client_id: b.client_id,
          client_secret: b.client_secret,
          override_env: b.override_env,
        }),
      onSuccess: inv,
    }),
  };
}

export interface ImapDraft {
  email: string;
  display_name?: string;
  imap_host: string;
  imap_port: number;
  imap_security: "tls" | "starttls";
  smtp_host: string;
  smtp_port: number;
  smtp_security: "tls" | "starttls";
  username?: string;
  password: string;
  folder?: string;
  /** Newest messages to import on the first sync (0 = none). */
  import_recent?: number;
}

export function useImapMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["domains"] });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  return {
    create: useMutation({
      mutationFn: (b: ImapDraft) => api.post<{ ok: boolean; account: T.Account }>("/api/accounts/imap", b),
      onSuccess: inv,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: Partial<ImapDraft> & { id: string }) =>
        request<{ ok: boolean; account: T.Account }>("PATCH", `/api/accounts/${id}/imap`, b),
      onSuccess: inv,
    }),
    test: useMutation({
      mutationFn: (id: string) => api.post<{ ok: boolean; error?: string }>(`/api/accounts/${id}/imap/test`),
    }),
    /** Re-check the inbox and import anything missing. Non-destructive. */
    resync: useMutation({
      mutationFn: ({ id, count, all }: { id: string; count?: number; all?: boolean }) =>
        api.post<{ ok: boolean; queued: number }>(`/api/accounts/${id}/imap/resync`, { count, all }),
      onSuccess: inv,
    }),
  };
}

