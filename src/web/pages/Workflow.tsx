import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkflowMutations, useWorkflows } from "../api";
import { BrandIcon } from "../components/BrandIcons";
import { PageHeader } from "../components/EmptyState";
import { History, WorkflowForm, sentence } from "../components/WorkflowsSection";
import { TestOnEmail } from "../components/WorkflowsSection/Insights";
import { Danger } from "../settings/parts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/** One workflow, on its own page: switch it on or off, change its steps, see what it did. */
export default function WorkflowPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const list = useWorkflows();
  const { update, remove } = useWorkflowMutations();
  const [del, setDel] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const notes = ((useLocation().state as { notes?: string[] } | null)?.notes ?? []).filter(Boolean);
  const w = list.data?.find((x) => x.id === id);

  // Just made: the list may not have caught up yet, so wait for it before deciding it is gone.
  if (list.isLoading || (!w && list.isFetching)) return <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-muted-foreground" size={18} /></div>;
  if (!w) return <Navigate to="/workflows" replace />;

  return (
    <div className="mx-auto w-full max-w-3xl px-2 sm:px-4">
      <Link to="/workflows" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Workflows</Link>
      <PageHeader
        title={w.name}
        subtitle={w.actions.length ? sentence(w) : "Not set up yet. Fill in the steps below, then switch it on."}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className={w.enabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{w.enabled ? "On" : "Off"}</span>
            <Switch
              checked={w.enabled}
              aria-label={w.enabled ? "Switch off" : "Switch on"}
              onCheckedChange={(v) => update.mutate({ id: w.id, enabled: v }, { onSuccess: () => toast(v ? `${w.name} is on. It will handle mail that arrives from now.` : `${w.name} is off`), onError: (e) => toast.error((e as Error).message) })}
            />
          </label>
        }
      />

      {notes.length > 0 && !dismissed && (
        <div role="note" className="mb-4 rounded-lg bg-muted/50 p-3 text-[13px] leading-5">
          <div className="font-medium">Drafted from your description</div>
          {notes.map((n, i) => <p key={i} className="text-muted-foreground">{n}</p>)}
          <p className="text-muted-foreground">Read the steps below, then switch it on. It is off until you do.</p>
          <button type="button" className="mt-1 text-xs underline underline-offset-2" onClick={() => setDismissed(true)}>Got it</button>
        </div>
      )}

      {/* Re-made from what was saved, so what is shown is what the server has. */}
      <WorkflowForm key={JSON.stringify([w.name, w.trigger, w.trigger_days, w.match, w.conditions, w.actions, w.account_ids, w.daily_limit])} workflow={w} />

      <TestOnEmail id={w.id} />

      <section className="mt-10" aria-label="History">
        <h2 className="mb-1 text-base font-semibold">History</h2>
        <p className="text-[13px] text-muted-foreground">{w.runs_today} today, {w.runs_total} in all. The same events are in Activity.</p>
        <History id={w.id} />
      </section>

      <section className="mb-10 mt-10 border-t border-border/60 pt-4">
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDel(true)}><BrandIcon name="trash" /> Delete workflow</Button>
      </section>
      <Danger
        open={del}
        onOpenChange={setDel}
        title={`Delete ${w.name}?`}
        body="It stops running and its history is removed. Mail it already moved or labelled stays as it is."
        action="Delete workflow"
        onConfirm={() => remove.mutate(w.id, { onSuccess: () => { toast("Workflow deleted"); nav("/workflows"); }, onError: (e) => toast.error((e as Error).message) })}
      />
    </div>
  );
}
