import { describe, expect, it } from "vitest";
import type { AiWorkflowProposal } from "@shared/types";
import { html } from "./render";
import { WorkflowProposalCard } from "@/assistant/WorkflowProposalCard";
import { applyEvent, toolLabel, type Turn } from "@/assistant/turns";

// A workflow the assistant drafted arrives as an event, and lands on the turn being written as a card to review.

const proposal: AiWorkflowProposal = {
  id: "p-1",
  def: { name: "Shop mail", trigger: "message_arrives", trigger_days: 3, match: "all", conditions: [{ field: "from", op: "is", value: "shop.com" }], actions: [{ type: "move", tray: "feed" }], account_ids: [], daily_limit: 200 },
  summary: "When mail arrives and all of: sender is shop.com, move it to the Feed.",
  notes: [],
};
const live = (): Turn => ({ role: "assistant", text: "", tools: [], drafts: [], sent: {} }) as unknown as Turn;

describe("a drafted workflow in the chat", () => {
  it("is added to the turn, after any already there", () => {
    const one = applyEvent(live(), { type: "workflow_proposal", proposal });
    expect(one?.workflowProposals).toEqual([proposal]);
    const two = applyEvent(one, { type: "workflow_proposal", proposal: { ...proposal, id: "p-2" } });
    expect(two?.workflowProposals?.map((p) => p.id)).toEqual(["p-1", "p-2"]);
  });

  it("changes nothing when there is no turn to write to", () => {
    expect(applyEvent(null, { type: "workflow_proposal", proposal })).toBeNull();
  });

  it("shows the steps as a sentence, says what happens next, and does not save by itself", () => {
    const out = html(<WorkflowProposalCard p={{ ...proposal, notes: ["Left out a label that is not there."] }} />);
    expect(out).toContain("Shop mail");
    expect(out).toContain("sender is shop.com, move it to the Feed.");
    expect(out).toContain("Left out a label that is not there.");
    expect(out).toContain("Review and save");
    expect(out).toContain("Saved switched off.");
  });

  it("is named in the tool line", () => {
    expect(toolLabel("draft_workflow", { name: "Shop mail" })).toMatch(/Drafted workflow/);
  });
});
