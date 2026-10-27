import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { api } from "./client";
import { invalidateMail } from "./keys";

export interface VacationState {
  vacation: T.VacationSettings | null;
  active: boolean;
  replied: number;
  /** A model is set up, so the notices can be written by it. */
  ai: boolean;
}

export function useVacation() {
  return useQuery({ queryKey: ["vacation"], queryFn: () => api.get<VacationState>("/api/vacation"), staleTime: 15_000 });
}

export function useDraftVacationNotices() {
  return useMutation({
    mutationFn: (v: { from: number; until: number; guidance: string; contact: string }) =>
      api.post<{ notices: T.VacationSettings["notices"]; source: "ai" | "template" }>("/api/vacation/draft", v),
  });
}

export function useSaveVacation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: T.VacationSettings) => api.put<{ vacation: T.VacationSettings; active: boolean }>("/api/vacation", v),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["vacation"] });
      invalidateMail(qc);
    },
  });
}

export function useEndVacation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; replied?: number }>("/api/vacation/end"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["vacation"] });
      invalidateMail(qc);
    },
  });
}
