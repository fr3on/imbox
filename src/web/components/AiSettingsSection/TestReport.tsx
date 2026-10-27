import { AlertTriangle, Braces, Check, MessageCircle, Repeat, Wrench, X, Zap } from "lucide-react";
import type { AiCheckResponse, AiCheckResult } from "@shared/types";
import { cn } from "@/lib/utils";

const TILE: Record<AiCheckResult["id"], { name: string; icon: React.ReactNode }> = {
  basic: { name: "Answers", icon: <MessageCircle /> },
  stream: { name: "Streams", icon: <Zap /> },
  tools: { name: "Calls tools", icon: <Wrench /> },
  roundtrip: { name: "Uses results", icon: <Repeat /> },
  json: { name: "JSON", icon: <Braces /> },
};

const time = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** What the last Test found: a verdict with the model and total time, then a tile for each thing the assistant needs, with what went wrong under any that did not pass. */
export function TestReport({ report, setReport }: { report: AiCheckResponse; setReport: (report: AiCheckResponse | null) => void }) {
  const good = report.summary.level === "good";
  const total = report.results.reduce((n, r) => n + r.ms, 0);
  const problems = report.results.filter((r) => r.status !== "pass");
  return (
    <div className="mx-4 mb-4 mt-4 sm:mx-5" aria-live="polite">
      <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", good ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive")}>
          {good ? <Check size={13} /> : <AlertTriangle size={13} />}
          {good ? "Everything works" : report.summary.level === "limited" ? "Works with limits" : "Not working"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {report.model} · {time(total)}
        </span>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Dismiss" onClick={() => setReport(null)}>
          <X size={14} />
        </button>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {report.results.map((r) => {
          const t = TILE[r.id] ?? { name: r.label, icon: null };
          return (
            <li
              key={r.id}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: the tile takes focus so its detail (the title) can be read from the keyboard
              tabIndex={0}
              title={`${r.label}: ${r.detail}`}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                r.status === "pass" ? "border-border/80 bg-muted/30" : r.status === "warn" ? "border-amber-500/40 bg-amber-500/10" : "border-destructive/40 bg-destructive/10",
              )}
            >
              <span className={cn("[&>svg]:size-4", r.status === "pass" ? "text-emerald-600 dark:text-emerald-400" : r.status === "warn" ? "text-amber-600" : "text-destructive")}>{r.status === "fail" ? <X /> : t.icon}</span>
              <div className="mt-1 text-[13px] font-medium text-foreground">{t.name}</div>
              <div className="text-[11px] tabular-nums text-muted-foreground">{time(r.ms)}</div>
            </li>
          );
        })}
      </ul>
      {problems.length > 0 ? (
        <ul className="mt-2.5 space-y-1 text-xs">
          {problems.map((r) => (
            <li key={r.id} className={cn("flex items-start gap-1.5", r.status === "fail" ? "text-destructive" : "text-muted-foreground")}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-medium">{r.label}.</span> {r.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">Hover a tile for what the check did.</p>
      )}
    </div>
  );
}
