import { useQuery } from "@tanstack/react-query";
import type { SystemInfo } from "@shared/types";
import { api } from "./client";

/** The server's specs and how busy it is. Refreshed while the Server tab is open. */
export function useSystemInfo() {
  return useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/system"), refetchInterval: 10_000, staleTime: 5_000, retry: false });
}
