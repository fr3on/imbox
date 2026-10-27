import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { assistant } from "../lib/assistantStore";
import { BrandIcon } from "../components/BrandIcons";
import { useIsMobile } from "../hooks/use-mobile";
import { PageHeader } from "../components/EmptyState";
import { useStartWorkflow } from "../components/WorkflowsSection";
import { TEMPLATES } from "../components/WorkflowsSection/Editor";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Making a workflow asks for a name, and nothing else. The steps are filled in on the workflow's own page, which opens next. */
export default function WorkflowNewPage() {
  const mobile = useIsMobile();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const { start, pending } = useStartWorkflow();
  const ready = !!name.trim() && !pending;

  return (
    <div className="mx-auto w-full max-w-xl px-2 sm:px-4">
      <Link to="/workflows" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Workflows</Link>
      <PageHeader title="New workflow" subtitle="Give it a name. On the next page you choose what it looks for and what it does." />

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) start({ name });
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="wf-new-name" className="text-sm font-medium">Name</label>
          <Input id="wf-new-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Newsletters to the Feed" className={cn("w-full", mobile && "h-11 text-[16px]")} />
        </div>
        <Button type="submit" size={mobile ? "lg" : "default"} className={cn(mobile && "w-full")} disabled={!ready}>
          {pending ? <Loader2 className="animate-spin" /> : null} Create and set up
        </Button>
      </form>

      <section className="mt-10" aria-label="Describe it">
        <h2 className="mb-1 text-sm font-medium">Or describe it to the assistant</h2>
        <p className="mb-2 text-[13px] text-muted-foreground">Say what you want in the Ask bar. It shows the steps on a card, and you save it when they look right. It's saved switched off.</p>
        <Button type="button" variant="outline" size={mobile ? "lg" : "default"} className={cn(mobile && "w-full")} onClick={() => {
            // On a phone the assistant is a page of its own.
            if (mobile) nav("/assistant/new");
            assistant.ask("Make a workflow that ", { panel: !mobile });
          }}>
          <BrandIcon name="assistant" /> Describe it in Ask
        </Button>
      </section>

      <section className="mt-10" aria-label="Start from a template">
        <h2 className="mb-2 text-sm font-medium">Or start from one of these</h2>
        <ul className="space-y-2">
          {TEMPLATES.map((t) => (
            <li key={t.label}>
              <button type="button" disabled={pending} onClick={() => start(t.def)} className="flex min-h-14 w-full flex-col items-start rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 active:bg-muted disabled:opacity-50">
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-[13px] text-muted-foreground">{t.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
