import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api } from "./client";
import { keys } from "./keys";

export interface ExtensionToken {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export function useExtensionTokens() {
  return useQuery({ queryKey: keys.extensionTokens, queryFn: () => api.get<ExtensionToken[]>("/api/me/extension-tokens") });
}

export function useExtensionTokenMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: keys.extensionTokens });
  return {
    create: useMutation({ mutationFn: (b: { name: string }) => api.post<ExtensionToken & { token: string }>("/api/me/extension-tokens", b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/me/extension-tokens/${id}`), onSuccess: inv }),
  };
}

export function useTwoFactor() {
  return useQuery({ queryKey: ["2fa"], queryFn: () => api.get<T.TwoFactorStatus>("/api/me/2fa"), staleTime: 10_000 });
}

export function useTwoFactorMutations() {
  const qc = useQueryClient();
  const inv = () => { qc.invalidateQueries({ queryKey: ["2fa"] }); qc.invalidateQueries({ queryKey: keys.me }); };
  return {
    setup: useMutation({ mutationFn: () => api.post<{ secret: string; otpauth_url: string }>("/api/me/2fa/setup") }),
    enable: useMutation({ mutationFn: (b: { code: string }) => api.post<{ ok: boolean; recovery_codes: string[] }>("/api/me/2fa/enable", b), onSuccess: inv }),
    regenerate: useMutation({ mutationFn: (b: { code: string }) => api.post<{ ok: boolean; recovery_codes: string[] }>("/api/me/2fa/recovery-codes", b), onSuccess: inv }),
    disable: useMutation({ mutationFn: (b: { password: string; code?: string }) => api.post<{ ok: boolean }>("/api/me/2fa/disable", b), onSuccess: inv }),
  };
}

export interface PasskeyItem {
  id: string;
  name: string;
  device_type: string;
  backed_up: number;
  created_at: number;
  last_used_at: number | null;
}

export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api.get<{ passkeys: PasskeyItem[] }>("/api/me/passkeys"),
    staleTime: 10_000,
  });
}

export function usePasskeyMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["passkeys"] });
  };
  return {
    register: useMutation({
      mutationFn: async (name?: string) => {
        const { startRegistration } = await import("@simplewebauthn/browser");
        const options = await api.post<any>("/api/me/passkeys/register-options");
        const response = await startRegistration({ optionsJSON: options });
        return api.post<{ ok: boolean; passkey: PasskeyItem }>("/api/me/passkeys/register-verify", { response, name });
      },
      onSuccess: inv,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) => api.patch<{ ok: boolean }>(`/api/me/passkeys/${id}`, { name }),
      onSuccess: inv,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/me/passkeys/${id}`),
      onSuccess: inv,
    }),
  };
}
