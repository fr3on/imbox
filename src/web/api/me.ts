import { useQuery } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api } from "./client";
import { keys } from "./keys";

export interface MeResponse {
  user: T.User | null;
  google_configured?: boolean;
  microsoft_configured?: boolean;
  /** What this deployment calls itself (the APP_NAME variable). */
  app_name?: string;
  accounts: T.Account[];
  setup_required: boolean;
}

export function useMe(enabled = true) {
  // The one query that still refetches on focus: connecting an account in another tab (or, in the
  // apps, in the system browser) has to show up when you come back, and nothing else refreshes `me`.
  return useQuery({ queryKey: keys.me, queryFn: () => api.get<MeResponse>("/api/me"), retry: false, enabled, staleTime: 30_000, refetchOnWindowFocus: true });
}
