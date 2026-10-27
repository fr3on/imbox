import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api } from "./client";
import { invalidateMail, keys } from "./keys";

export const DOMAIN_ERRORS: Record<string, string> = {
  invalid_domain: "That doesn't look like a domain name.",
  domain_exists: "That domain is already added.",
  mailbox_exists: "That mailbox already exists.",
  invalid_local_part: "Use letters, numbers, dots, dashes, plus or underscores.",
  invalid_mailbox: "Pick one of this domain's mailboxes.",
  sending_not_configured: "Outbound mail isn't configured for this domain yet.",
};

export function domainErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const key = m.replace(/ /g, "_");
  return DOMAIN_ERRORS[key] ?? DOMAIN_ERRORS[m] ?? m;
}

export function useDomains(enabled = true) {
  return useQuery({ queryKey: ["domains"], queryFn: () => api.get<T.Domain[]>("/api/domains"), enabled, staleTime: 15_000 });
}

export function useDomainMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["domains"] });
    qc.invalidateQueries({ queryKey: keys.me });
  };
  return {
    create: useMutation({ mutationFn: (b: { name: string }) => api.post<T.Domain>("/api/domains", b), onSuccess: inv }),
    verify: useMutation({ mutationFn: (id: string) => api.post<T.Domain>(`/api/domains/${id}/verify`), onSuccess: inv }),
    patch: useMutation({ mutationFn: ({ id, ...b }: { id: string; catch_all_account_id?: string | null }) => api.patch<T.Domain>(`/api/domains/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/domains/${id}`), onSuccess: () => { inv(); invalidateMail(qc); } }),
    createMailbox: useMutation({
      mutationFn: ({ domain_id, ...b }: { domain_id: string; local_part: string; display_name?: string; catch_all?: boolean }) => api.post<T.Account>(`/api/domains/${domain_id}/mailboxes`, b),
      onSuccess: inv,
    }),
  };
}
