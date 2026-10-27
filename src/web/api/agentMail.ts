import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api, request } from "./client";
import { keys } from "./keys";

/** An agent mailbox, or `{ enabled: false }` when the mailbox is not one yet. */
export type AgentState = (T.AgentMailbox & { enabled?: true }) | { account_id: string; email: string; enabled: false };

export function useAgent(accountId: string | null) {
  return useQuery({
    queryKey: ["agents", accountId],
    queryFn: () => api.get<AgentState>(`/api/agents/${accountId}`),
    enabled: !!accountId,
    staleTime: 5_000,
    // Deliveries finish in the background; keep the list of them fresh while the panel is open.
    refetchInterval: 20_000,
  });
}

export function useAgentMutations(accountId: string) {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["agents"] });
    qc.invalidateQueries({ queryKey: ["stalwart"] });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  const base = `/api/agents/${accountId}`;
  return {
    setEnabled: useMutation({ mutationFn: (enabled: boolean) => request<AgentState>("PUT", base, { enabled }), onSuccess: inv }),
    createKey: useMutation({
      mutationFn: (b: { name: string; scopes: ("read" | "send")[]; expires_in_days?: number | null }) => api.post<T.AgentKeyCreated>(`${base}/keys`, b),
      onSuccess: inv,
    }),
    revokeKey: useMutation({ mutationFn: (keyId: string) => api.del<{ ok: boolean }>(`${base}/keys/${keyId}`), onSuccess: inv }),
    setWebhook: useMutation({
      mutationFn: (b: { url: string | null; rotate_secret?: boolean }) => request<{ ok: boolean; webhook_url: string; secret?: string }>("PUT", `${base}/webhook`, b),
      onSuccess: inv,
    }),
    testWebhook: useMutation({ mutationFn: () => api.post<{ ok: boolean; status: number; error?: string }>(`${base}/webhook/test`) }),
  };
}
