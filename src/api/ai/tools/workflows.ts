import { uid } from "../../db";
import { shapeDraft } from "../../workflows/ai";
import type { Handler } from "./context";

/**
 * Draft a workflow and show it on a card. Nothing is written: the person reads it and chooses to save it, and it is saved switched off. The draft
 * can only use the actions a workflow has, none of which deletes, sends or forwards, so an email the model has read cannot talk it into more.
 */
export const draft_workflow: Handler = async ({ ctx, input, ok, fail }) => {
  const r = await shapeDraft(ctx.env, ctx.user.id, input);
  if ("error" in r) return fail(r.error);
  const proposal = { id: uid(), def: r.def, summary: r.summary, notes: r.notes };
  ctx.emit({ type: "workflow_proposal", proposal });
  return ok({ summary: r.summary, notes: r.notes, note: "The workflow card has been shown to the user. It is not saved or switched on until they choose to save it." }, `Drafted workflow \u201c${r.def.name}\u201d`);
};
