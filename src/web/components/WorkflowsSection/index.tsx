import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { describeCondition } from "@shared/workflows";
import { BrandIcon } from "../BrandIcons";
import { useWorkflowMutations, useWorkflowRuns, useWorkflows, type Workflow, type WorkflowInput, type WorkflowRun } from "../../api";
import type { BrandIconName } from "../BrandIcons";
import { PageHeader } from "../EmptyState";
import { fmtRelative } from "../../lib/format";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { TRAY_LABEL } from "./Editor";
import { Checkup, Suggestions } from "./Insights";

export { WorkflowForm } from "./Editor";

const STATUS: Record<WorkflowRun["status"], string> = { done: "Done", partial: "Partly done", error: "Didn't work" };

function actionText(w: Workflow): string {
  return w.actions
    .map((a) => {
      switch (a.type) {
        case "label": return "add a label";
        case "collection": return "add to a collection";
        case "move": return `move to ${TRAY_LABEL[a.tray ?? "feed"]}`;
        case "mark_read": return "mark read";
        case "set_aside": return "set aside";
        case "reply_later": return "add to Reply Later";
        case "snooze": return `snooze ${a.hours ?? 24}h`;
      }
    })
    .join(", then ");
}

/** The workflow as one sentence. A new one with nothing in it yet says so. */
export function sentence(w: Workflow): string {
  if (w.actions.length === 0) return "Not set up yet. Open it to choose what it looks for and what it does.";
  const when = w.trigger === "no_reply" ? `a thread of yours has no reply for ${w.trigger_days} day${w.trigger_days === 1 ? "" : "s"}` : "mail arrives";
  const ifs = w.conditions.length ? ` and ${w.match === "all" ? "all of" : "any of"}: ${w.conditions.map(describeCondition).join("; ")}` : "";
  return `When ${when}${ifs}, ${actionText(w)}.`;
}

export function RunLine({ r }: { r: WorkflowRun }) {
  return (
    <li className="flex items-start gap-2 py-2 text-[13px]">
      <span className={cn("mt-0.5 shrink-0 text-xs font-medium", r.status === "done" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{STATUS[r.status]}</span>
      <span className="min-w-0 flex-1">
        <Link to={`/t/${r.thread_id}`} className="block truncate hover:underline">{r.subject || "(no subject)"}</Link>
        <span className="block text-xs text-muted-foreground">{r.summary}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tnum">{fmtRelative(r.created_at)}</span>
    </li>
  );
}

export function History({ id }: { id: string }) {
  const q = useWorkflowRuns(id);
  if (q.isLoading) return <div className="py-3 text-center"><Loader2 className="mx-auto animate-spin text-muted-foreground" size={14} /></div>;
  const runs = q.data?.runs ?? [];
  return runs.length ? <ul className="divide-y divide-border/60">{runs.map((r) => <RunLine key={r.id} r={r} />)}</ul> : <p className="py-3 text-xs text-muted-foreground">It hasn't done anything yet.</p>;
}

/** Make a workflow and go to its page, where the rest is filled in. */
export function useStartWorkflow() {
  const nav = useNavigate();
  const { create } = useWorkflowMutations();
  const qc = useQueryClient();
  return {
    pending: create.isPending,
    start: (input: WorkflowInput, then?: () => void, state?: { notes: string[] }) =>
      create.mutate(input, {
        onSuccess: (w) => {
          // Its page reads the list, so it goes in before the page opens.
          qc.setQueryData<Workflow[]>(["workflows"], (old) => (old?.some((x) => x.id === w.id) ? old : [...(old ?? []), w]));
          then?.();
          nav(`/workflows/${w.id}`, { state });
        },
        onError: (e) => toast.error((e as Error).message),
      }),
  };
}

/** The few words a tile shows for what a workflow does. */
const ACTION_SHORT = (a: Workflow["actions"][number]): string => {
  switch (a.type) {
    case "move": return TRAY_LABEL[a.tray ?? "feed"];
    case "label": return "label";
    case "collection": return "collection";
    case "mark_read": return "mark read";
    case "set_aside": return "set aside";
    case "reply_later": return "Reply Later";
    case "snooze": return "snooze";
  }
};

/** "sender is amazon.com → Paper Trail": the rule in one line, for a tile. */
export function brief(w: Workflow): string {
  if (w.actions.length === 0) return "Not set up yet";
  const then = w.actions.map(ACTION_SHORT).join(", ");
  if (w.trigger === "no_reply") return `No reply for ${w.trigger_days} day${w.trigger_days === 1 ? "" : "s"} → ${then}`;
  const first = w.conditions[0] ? describeCondition(w.conditions[0]) : "any mail";
  const more = w.conditions.length > 1 ? ` +${w.conditions.length - 1}` : "";
  return `${first}${more} → ${then}`;
}

/** The icon of what a workflow mostly does: where it sends mail, or what it asks of you. */
export function iconFor(w: Workflow): BrandIconName {
  if (w.trigger === "no_reply") return "reply-later";
  // Where it sends mail says the most; otherwise its first step.
  const a = w.actions.find((x) => x.type === "move") ?? w.actions[0];
  if (!a) return "workflows";
  switch (a.type) {
    case "move": return a.tray === "paper_trail" ? "paper-trail" : a.tray === "feed" ? "feed" : "imbox";
    case "reply_later": return "reply-later";
    case "set_aside": return "set-aside";
    case "snooze": return "bubble-up";
    case "label": return "labels";
    case "collection": return "collection";
    case "mark_read": return "imbox";
  }
}

function Tile({ w }: { w: Workflow }) {
  const { update } = useWorkflowMutations();
  return (
    <li className={cn("relative flex min-h-28 flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/40 active:bg-muted/60", !w.enabled && "text-muted-foreground")}>
      {/* The whole tile opens the workflow; the switch sits above that and does only its own job. */}
      <Link to={`/workflows/${w.id}`} aria-label={`Open ${w.name}`} className="absolute inset-0 rounded-xl" />
      <div className="pointer-events-none relative flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80"><BrandIcon name={iconFor(w)} size={18} /></span>
        <span className="flex-1" />
        <Switch
          className="pointer-events-auto relative"
          checked={w.enabled}
          aria-label={w.enabled ? `Switch off ${w.name}` : `Switch on ${w.name}`}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => update.mutate({ id: w.id, enabled: v }, { onSuccess: () => toast(v ? `${w.name} is on. It will handle mail that arrives from now.` : `${w.name} is off`), onError: (e) => toast.error((e as Error).message) })}
        />
      </div>
      <div className="relative min-w-0 pointer-events-none">
        <div className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground">{w.name}</div>
        <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.35]">{brief(w)}</div>
      </div>
      <div className="relative mt-auto text-xs tnum pointer-events-none">
        {w.actions.length === 0 ? "Open to set it up" : !w.enabled ? "Off" : w.runs_total === 0 ? "Waiting for mail" : `${w.runs_total} handled${w.last_run_at ? ` · ${fmtRelative(w.last_run_at)}` : ""}`}
      </div>
    </li>
  );
}

export function WorkflowsPanel() {
  const list = useWorkflows();
  const nav = useNavigate();
  const { start, pending } = useStartWorkflow();
  const items = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="Small jobs imbox does to mail for you: label it, move it to a tray, snooze it. You choose when each runs and what it looks for. It never deletes, sends or forwards."
      />

      <Suggestions onMake={(def) => start(def)} pending={pending} />
      <Checkup />

      {list.isLoading ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto animate-spin text-muted-foreground" size={16} /></div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {items.map((w) => <Tile key={w.id} w={w} />)}
          <li>
            <button type="button" onClick={() => nav("/workflows/new")} className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground active:bg-muted/60">
              <Plus size={18} /> New workflow
            </button>
          </li>
        </ul>
      )}
      {!list.isLoading && items.length === 0 && (
        <p className="mx-auto mt-4 max-w-sm text-center text-[13px] text-muted-foreground">Send newsletters to the Feed, file receipts in Paper Trail, or get reminded when nobody answers you.</p>
      )}
    </>
  );
}
