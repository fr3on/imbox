import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { AutoAgent, AutoAgentRun } from "../../api";
import { useAutoAgentRuns } from "../../api";
import { Section } from "../../settings/parts";
import { fmtRelative } from "../../lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { STATUS } from "./templates";

export function RunLine({ r }: { r: AutoAgentRun }) {
  const s = STATUS[r.status];
  const Icon = s.icon;
  return (
    <li className="flex items-start gap-2.5 py-2">
      <Icon size={14} className={cn("mt-0.5 shrink-0", s.tone, r.status === "running" && "animate-spin")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn("shrink-0 text-xs font-medium", s.tone)}>{s.label}</span>
          <Link to={`/t/${r.thread_id}`} className="min-w-0 flex-1 truncate text-[13px] hover:underline underline-offset-2">{r.subject || "(no subject)"}</Link>
          <span className="shrink-0 text-[11px] text-muted-foreground tnum">{fmtRelative(r.created_at)}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{r.from_email}{r.summary ? ` · ${r.summary}` : ""}</div>
      </div>
    </li>
  );
}

export function ActivityPage({ agent, onBack }: { agent: AutoAgent; onBack: () => void }) {
  const [skipped, setSkipped] = useState(false);
  const q = useAutoAgentRuns(agent.id, skipped);
  const runs = q.data?.runs ?? [];
  return (
    <Section
      title={`${agent.name} · activity`}
      description="What it did with each new email, and why it left the rest alone."
      actions={<Button size="sm" variant="outline" onClick={onBack}><ArrowLeft /> Agents</Button>}
    >
      {q.isLoading ? (
        <div className="py-8 text-center text-[13px] text-muted-foreground"><Loader2 className="mx-auto mb-2 animate-spin" size={16} /></div>
      ) : runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">Nothing yet. It looks at new mail about once a minute.</div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border px-3">{runs.map((r) => <RunLine key={r.id} r={r} />)}</ul>
      )}
      {(q.data?.skipped_count ?? 0) > 0 && (
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={skipped} onCheckedChange={(v) => setSkipped(v === true)} />
          Also show the {q.data?.skipped_count} it left alone
        </label>
      )}
    </Section>
  );
}
