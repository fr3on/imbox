import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api";
import type { ThreadDetail } from "@shared/types";

/**
 * "Not waiting": you wrote last, so the brief lists the thread as waiting on a reply until you say nothing is expected back.
 * `waiting` is whether to offer it; `stop` marks the thread at once and tells the server, and puts it back if that fails.
 */
export function useStopWaiting(t: ThreadDetail | undefined): { waiting: boolean; stop: () => void } {
  const qc = useQueryClient();
  const last = t?.messages[t.messages.length - 1];
  const waiting = !!t && !!last?.is_from_me && !t.not_waiting && t.bucket !== "trash";
  const mark = (on: boolean) => qc.setQueriesData<ThreadDetail>({ queryKey: ["thread", t?.id] }, (old) => (old ? { ...old, not_waiting: on } : old));
  const stop = () => {
    if (!t) return;
    mark(true);
    api
      .post("/api/ai/actions/state", { thread_id: t.id, action_id: "not_waiting", state: "done" })
      .then(() => {
        toast("Not waiting on this any more");
        void qc.invalidateQueries({ queryKey: ["brief"] });
      })
      .catch((e) => {
        mark(false);
        toast((e as Error).message);
      });
  };
  return { waiting, stop };
}
