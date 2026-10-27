import { Loader2 } from "lucide-react";
import type { AiWorkflowProposal } from "@shared/types";
import type { WorkflowInput } from "../api";
import { BrandIcon } from "../components/BrandIcons";
import { useStartWorkflow } from "../components/WorkflowsSection";
import { Button } from "@/components/ui/button";

/** A workflow the assistant drafted. Nothing is saved until the button is pressed, and then it is saved switched off, on its own page. */
export function WorkflowProposalCard({ p }: { p: AiWorkflowProposal }) {
  const { start, pending } = useStartWorkflow();
  return (
    <div className="mt-2 rounded-xl border border-border bg-card p-3 text-[13px]">
      <div className="flex items-center gap-2 font-medium">
        <BrandIcon name="workflows" size={16} className="text-muted-foreground" />
        <span className="truncate">{p.def.name}</span>
      </div>
      <p className="mt-1.5 leading-5 text-muted-foreground">{p.summary}</p>
      {p.notes.map((n, i) => <p key={i} className="mt-1 text-xs leading-5 text-muted-foreground">{n}</p>)}
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(p.def as WorkflowInput, undefined, { notes: p.notes })}>
          {pending ? <Loader2 className="animate-spin" /> : null} Review and save
        </Button>
        <span className="text-xs text-muted-foreground">Saved switched off.</span>
      </div>
    </div>
  );
}
