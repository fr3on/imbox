
import { fmtTokens } from "../../lib/aiUsage";
import { cn } from "@/lib/utils";

/** One AI feature: what it does, how much it used in the last 30 days, and its switch (or a note where there is none). */
export function FeatureRow({ label, hint, tokens, top, warn, children }: { label: string; hint: string; tokens?: number; top: number; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid items-center gap-x-5 gap-y-2 border-b border-border/60 px-4 py-3.5 last:border-b-0 sm:px-5 sm:grid-cols-[minmax(0,1fr)_7.5rem_5rem]", warn && "bg-amber-500/[0.07]")}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className={cn("mt-0.5 text-xs", warn ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>{hint}</div>
      </div>
      <div className="min-w-0 max-sm:hidden" aria-label={tokens === undefined ? undefined : `${fmtTokens(tokens)} tokens in the last 30 days`}>
        {tokens !== undefined && (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-foreground" style={{ width: tokens ? `${Math.max(3, (tokens / top) * 100)}%` : "0%" }} />
            </div>
            <div className="mt-1 text-right text-[11.5px] text-muted-foreground tnum">{tokens ? fmtTokens(tokens) : "none yet"}</div>
          </>
        )}
      </div>
      <div className="min-w-0 sm:justify-self-end">{children}</div>
    </div>
  );
}
