import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJevChecks, type JevCheckRow } from "../api";
import { FormShell } from "../settings/parts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Which checks have a size worth drawing as a bar, and the groups they sit in.
const GROUPS: { title: string; ids: string[]; bar: string[] }[] = [
  { title: "Is it safe", ids: ["phishing", "pressure"], bar: ["phishing", "pressure"] },
  { title: "What it wants", ids: ["needs_reply", "has_deadline"], bar: ["needs_reply", "has_deadline"] },
  { title: "Who and where", ids: ["person", "place", "tone"], bar: ["person"] },
];

function Row({ c, bar }: { c: JevCheckRow; bar: boolean }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-border/60 py-2 first:border-t-0">
      <span className="text-[13.5px]">{c.label}</span>
      <span className={cn("flex items-center gap-1.5 text-[13.5px] font-medium", c.flag && "text-destructive")}>
        {c.flag && <TriangleAlert className="size-3.5" aria-hidden />}
        {c.text}
        <span className="w-9 text-right text-xs font-normal text-muted-foreground tnum">{c.pct}%</span>
      </span>
      {bar && (
        <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={cn("block h-full rounded-full", c.flag ? "bg-destructive" : "bg-foreground")} style={{ width: `${Math.max(2, c.pct)}%` }} />
        </span>
      )}
    </li>
  );
}

/** "Check with Jev": a handful of quick questions about one message, answered when the person asks. It runs as the dialog opens. */
export function JevChecksDialog({ threadId, open, onOpenChange, variant = "dialog" }: { threadId: string; open: boolean; onOpenChange: (o: boolean) => void; variant?: "dialog" | "drawer" }) {
  const nav = useNavigate();
  const checks = useJevChecks();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      asked.current = null;
      return;
    }
    if (asked.current !== threadId) {
      asked.current = threadId;
      checks.mutate(threadId);
    }
  }, [open, threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = checks.data;
  const byId = new Map((d?.checks ?? []).map((c) => [c.id, c]));
  const off = d && d.enabled === false;

  return (
    <FormShell
      open={open}
      onClose={() => onOpenChange(false)}
      variant={variant}
      title="Quick checks"
      description="Answered by Jev, from TypeSafe AI, usually in under a second. It sees the sender, the subject and the start of this message."
      footer={
        <>
          {!off && (
            <Button type="button" variant="ghost" className="text-muted-foreground" disabled={checks.isPending} onClick={() => checks.mutate(threadId)}>
              <RefreshCw className={cn(checks.isPending && "animate-spin")} /> Run again
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      {off ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{d.configured ? "Quick checks are switched off." : "Jev is not set up yet. Add a TypeSafe key to use it."}</p>
          <Button size="sm" onClick={() => { onOpenChange(false); nav("/settings/ai"); }}>
            Open fast decisions
          </Button>
        </div>
      ) : checks.isError ? (
        <p className="text-sm text-muted-foreground">{(checks.error as Error).message || "The checks could not be run."}</p>
      ) : d?.error ? (
        <p className="text-sm text-muted-foreground">{d.error}</p>
      ) : !d ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
          <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Asking Jev…
          </p>
        </div>
      ) : (
        <div className="space-y-4" aria-live="polite">
          {GROUPS.map((g) => {
            const rows = g.ids.map((id) => byId.get(id)).filter((c): c is JevCheckRow => !!c);
            if (!rows.length) return null;
            return (
              <section key={g.title} aria-label={g.title}>
                <h3 className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-tertiary">{g.title}</h3>
                <ul>
                  {rows.map((c) => (
                    <Row key={c.id} c={c} bar={g.bar.includes(c.id)} />
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-xs text-muted-foreground tnum">
            {d.ms} ms · {d.tokens} tokens · a guess, not a verdict
          </p>
        </div>
      )}
    </FormShell>
  );
}
