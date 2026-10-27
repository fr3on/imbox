import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { markDraftSent } from "@/lib/sentDrafts";
import { api } from "./client";
import { keys } from "./keys";

export function useDrafts() {
  return useQuery({ queryKey: keys.drafts, queryFn: () => api.get<T.Draft[]>("/api/drafts") });
}

export interface DraftBody {
  /** From account (unified inbox). Defaults server-side to the thread's account, else the first account. */
  account_id?: string;
  thread_id?: string | null;
  reply_to_message_id?: string | null;
  to: T.Address[];
  cc: T.Address[];
  bcc: T.Address[];
  subject: string;
  body_html: string;
  send_at?: number | null;
}

export function useDraftMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: keys.drafts });
  return {
    create: useMutation({ mutationFn: (b: DraftBody) => api.post<T.Draft>("/api/drafts", b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, ...b }: Partial<DraftBody> & { id: string }) => api.patch<T.Draft>(`/api/drafts/${id}`, b), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/drafts/${id}`), onSuccess: inv }),
    cancelScheduled: useMutation({ mutationFn: (draft_id: string) => api.post<{ ok: boolean }>("/api/send/cancel", { draft_id }), onSuccess: inv }),
  };
}

export interface SendPayload extends DraftBody {
  draft_id?: string;
  /** One per send, kept on every retry of it, so the server never sends the same message twice. */
  client_id?: string;
  attachments?: { filename: string; mime_type: string; data_base64: string }[];
}

export interface SendResult {
  ok: boolean;
  account_id?: string;
  thread_id?: string;
  message_id?: string;
  scheduled?: boolean;
  draft_id?: string;
}

export async function sendMail(payload: SendPayload): Promise<SendResult> {
  const res = await api.post<SendResult>("/api/send", payload);
  markDraftSent(payload.draft_id, res.thread_id);
  return res;
}
