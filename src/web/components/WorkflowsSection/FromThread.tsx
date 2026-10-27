import type { ThreadDetail } from "@shared/types";
import type { WorkflowInput } from "../../api";
import { useStartWorkflow } from "./index";

/** A workflow made from one email: every email from the same sender goes to the Feed. It opens on its own page, where anything that does not fit is changed. */
export function seedFromThread(t: Pick<ThreadDetail, "last_from" | "bucket" | "account_id">): WorkflowInput {
  const email = t.last_from.email.toLowerCase();
  const who = t.last_from.name || email;
  return {
    name: `Mail from ${who}`.slice(0, 80),
    conditions: email ? [{ field: "from", op: "is", value: email }] : [],
    actions: [{ type: "move", tray: t.bucket === "feed" ? "paper_trail" : "feed" }],
    account_ids: [t.account_id],
  };
}

export function useWorkflowFromThread(thread: ThreadDetail | undefined) {
  const { start, pending } = useStartWorkflow();
  return { pending, run: () => thread && start(seedFromThread(thread)) };
}
