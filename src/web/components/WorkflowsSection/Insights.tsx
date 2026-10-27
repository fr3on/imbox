import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Minus, X } from "lucide-react";
import { toast } from "sonner";
import { useRecentThreads, useWorkflowCheckup, useWorkflowSuggestions, useWorkflowThreadCheck, type WorkflowInput } from "../../api";
import { useIsMobile } from "../../hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const DISMISSED = "imbox.workflows.dismissed";
const readDismissed = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(DISMISSED) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** What the person keeps doing by hand, offered as a workflow. "Not now" is remembered on this device. */
export function Suggestions({ onMake, pending }: { onMake: (def: WorkflowInput) => void; pending: boolean }) {
  const q = useWorkflowSuggestions();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const shown = (q.data?.suggestions ?? []).filter((s) => !dismissed.includes(s.key));
  if (!shown.length) return null;
  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };
  return (
    <section aria-label="Suggestions" className="mb-5 rounded-lg bg-muted/50 p-3">
      <h2 className="text-sm font-medium">You keep doing these by hand</h2>
      <ul className="mt-2 divide-y divide-border/60">
        {shown.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
            <div className="min-w-0 flex-1 basis-56">
              <div className="truncate text-[13.5px] font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.why}</div>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onMake(s.def)}>Make it a workflow</Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => dismiss(s.key)}>Not now</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What is wrong with the workflows you have. Nothing here is shown when all is well. */
export function Checkup() {
  const q = useWorkflowCheckup();
  const notes = q.data?.notes ?? [];
  if (!notes.length) return null;
  return (
    <section aria-label="Checkup" className="mb-5 rounded-lg border border-border p-3">
      <h2 className="text-sm font-medium">Worth a look</h2>
      <ul className="mt-1.5 space-y-1.5">
        {notes.map((n, i) => (
          <li key={i} className="text-[13px] leading-5 text-muted-foreground">
            {n.message}{" "}
            <Link to={`/workflows/${n.workflow_ids[0]}`} className="text-foreground underline underline-offset-2">Open</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Pick one of your recent conversations and see whether this workflow would act on it, and which conditions hold. */
export function TestOnEmail({ id }: { id: string }) {
  const mobile = useIsMobile();
  const recent = useRecentThreads(true);
  const check = useWorkflowThreadCheck(id);
  const [pick, setPick] = useState("");
  const threads = recent.data?.threads ?? [];
  const r = check.data;
  return (
    <section className="mt-10" aria-label="Test it on an email">
      <h2 className="mb-1 text-base font-semibold">Test it on an email</h2>
      <p className="mb-2 text-[13px] text-muted-foreground">Pick a conversation to see whether this workflow would act on it, and which conditions hold. Nothing is changed.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          aria-label="Conversation to test"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className={cn("h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring", mobile && "h-11 text-[16px]")}
        >
          <option value="">Pick a conversation</option>
          {threads.map((t) => <option key={t.thread_id} value={t.thread_id}>{(t.subject || "(no subject)").slice(0, 60)} · {t.from.slice(0, 30)}</option>)}
        </select>
        <Button type="button" variant="outline" size={mobile ? "lg" : "default"} disabled={!pick || check.isPending} onClick={() => check.mutate(pick, { onError: (e) => toast.error((e as Error).message) })}>
          {check.isPending ? <Loader2 className="animate-spin" /> : null} Check it
        </Button>
      </div>
      {r && (
        <div role="status" className="mt-3 rounded-lg border border-border p-3 text-[13px]">
          <div className="font-medium">
            {r.would_act === true ? "It would act on this." : r.would_act === false ? "It would leave this alone." : "It depends on what the AI says, which isn't asked here."}
          </div>
          {r.blockers.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted-foreground">{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
          {r.conditions.length > 0 && (
            <ul className="mt-2 space-y-1">
              {r.conditions.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  {c.ok === true ? <Check size={14} className="mt-1 shrink-0 text-emerald-600" /> : c.ok === false ? <X size={14} className="mt-1 shrink-0 text-destructive" /> : <Minus size={14} className="mt-1 shrink-0 text-muted-foreground" />}
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
