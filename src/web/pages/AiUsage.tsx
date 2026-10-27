import { BrandIcon } from "../components/BrandIcons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Bot, Check, ExternalLink, MessageSquareText, RotateCw, SlidersHorizontal, UserCheck, } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { aiFeatureName } from "@shared/aiFeatures";
import { useAiUsage } from "../api";
import { EmptyState, ErrorState, PageHeader } from "../components/EmptyState";
import { fmtDate, fmtRelative } from "../lib/format";
import { fillDays, fmtTokens } from "../lib/aiUsage";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];
const DAY = 86_400_000;
/** How many features the ranked list shows before "Show all". */
const TOP = 3;
type TabId = "chats" | "agents" | "let_in";

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const STATUS: Record<string, { label: string; tone?: "ok" | "warn" }> = {
  replied: { label: "Replied", tone: "ok" },
  drafted: { label: "Drafted", tone: "ok" },
  acted: { label: "Acted" },
  error: { label: "Error", tone: "warn" },
  running: { label: "Running" },
  let_in: { label: "Let in" },
  chat: { label: "Chat" },
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/80 bg-card px-3.5 py-3">
      <div className="text-xl font-semibold tracking-tight tnum">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function AiUsagePage() {
  const [days, setDays] = useState<Period>(30);
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<TabId | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useAiUsage(days);
  const series = useMemo(() => fillDays(data?.series ?? [], days), [data?.series, days]);

  if (error && !data) {
    return (
      <div className="max-w-5xl mx-auto w-full px-2">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const ov = data?.overview;
  const t = data?.totals;
  const tokens = t ? t.tokens_in + t.tokens_out : 0;
  const max = Math.max(1, ...series.map((s) => s.tokens));
  const features = data?.by_feature ?? [];
  const topFeature = Math.max(1, ...features.map((f) => f.tokens_in + f.tokens_out));
  const shown = showAll ? features : features.slice(0, TOP);
  const activity = data?.activity ?? [];
  const skipped = data?.skipped_runs ?? 0;
  // Recent items sorted into the three kinds they come in, each its own tab. Agents also holds the count of mails they skipped.
  const tabs = ([
    { id: "chats", label: "Conversations", count: activity.filter((a) => a.kind === "chat").length },
    { id: "agents", label: "Agent runs", count: activity.filter((a) => a.kind === "agent").length + skipped },
    { id: "let_in", label: "Let in", count: activity.filter((a) => a.kind === "let_in").length },
  ] as { id: TabId; label: string; count: number }[]).filter((t) => t.count > 0 || t.id !== "let_in");
  const tab: TabId = picked && tabs.some((t) => t.id === picked) ? picked : (tabs.find((t) => t.count > 0) ?? tabs[0]).id;
  const setTab = setPicked;
  const kind = tab === "chats" ? "chat" : tab === "agents" ? "agent" : "let_in";
  const rows = activity.filter((a) => a.kind === kind);
  const since = data?.counting_since ?? null;
  // A day of slack: counting that began on the first day of the period still covers it.
  const partial = since !== null && since > Date.now() - (days - 1) * DAY;

  return (
    <div className="max-w-5xl mx-auto w-full px-2 pb-16">
      <PageHeader
        title="AI usage"
        subtitle={ov ? `${ov.model || "No model chosen"} · ${ov.preset} · ${ov.configured ? "Ready" : "Setup needed"}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Period" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={days === p}
                  onClick={() => setDays(p)}
                  className={cn("rounded-md px-2.5 py-1 text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring", days === p ? "bg-background text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
                >
                  {p} days
                </button>
              ))}
            </div>
            <Button variant="outline" size="icon-sm" aria-label="Refresh" onClick={() => refetch()} disabled={isFetching}>
              <RotateCw className={cn(isFetching && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings/ai" aria-label="AI settings">
                <SlidersHorizontal /> <span className="max-sm:hidden">AI settings</span>
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading || !data ? (
        <div className="space-y-4" aria-busy>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[68px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ) : !ov?.configured && !t?.calls ? (
        <EmptyState
          icon={<BrandIcon name="assistant" />}
          title="No AI provider yet."
          body="Add one in AI settings and this page will show what each feature uses."
          action={
            <Button size="sm" asChild>
              <Link to="/settings/ai">Open AI settings</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat value={fmtTokens(tokens)} label={`tokens (${fmtTokens(t!.tokens_in)} in, ${fmtTokens(t!.tokens_out)} out)`} />
            <Stat value={t!.calls.toLocaleString()} label="model calls" />
            <Stat value={t!.calls ? `${((t!.failed / t!.calls) * 100).toFixed(t!.failed && t!.failed / t!.calls < 0.01 ? 1 : 0)}%` : "0%"} label={`failed (${t!.failed})`} />
            <Stat value={t!.calls ? fmtMs(t!.median_ms) : "-"} label="median time" />
          </div>
          {(partial || (t && t.estimated_calls > 0)) && (
            <p className="mt-2.5 text-[12.5px] text-muted-foreground">
              {partial && since !== null && <>Counting started {fmtDate(since)}. Earlier use was not recorded. </>}
              {t && t.estimated_calls > 0 && <>{t.estimated_calls.toLocaleString()} {t.estimated_calls === 1 ? "call was" : "calls were"} estimated from the text, because the provider did not report its counts.</>}
            </p>
          )}

          <div className="mt-7 grid gap-x-10 gap-y-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section aria-label="Tokens per day">
              <h2 className="mb-2 border-b border-border pb-1.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">Tokens per day</h2>
              {tokens === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">Nothing recorded in the last {days} days.</p>
              ) : (
                <>
                  <div role="img" aria-label={`Tokens per day for the last ${days} days. The busiest day used ${fmtTokens(max)}.`} className="mt-3 flex h-40 items-end gap-[3px]">
                    {series.map((s, i) => (
                      <div
                        key={s.day}
                        title={`${fmtDate(s.day * DAY)}: ${s.tokens ? `${fmtTokens(s.tokens)} tokens` : "none"}`}
                        className={cn("min-w-[3px] flex-1 rounded-t-[2px]", s.tokens ? (i === series.length - 1 ? "bg-foreground/50" : "bg-foreground") : "bg-muted")}
                        style={{ height: s.tokens ? `${Math.max(4, (s.tokens / max) * 100)}%` : "2px" }}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground">
                    <span>{fmtDate(series[0].day * DAY)}</span>
                    <span>Today</span>
                  </div>
                </>
              )}
            </section>

            <section aria-label="By feature">
              <h2 className="mb-2 border-b border-border pb-1.5 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted-foreground">{showAll ? "By feature" : "Top features"}</h2>
              {features.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">No calls yet.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border/60">
                    {shown.map((f) => {
                      const n = f.tokens_in + f.tokens_out;
                      return (
                        <li key={f.feature} className="py-2.5 text-sm">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate font-medium">{aiFeatureName(f.feature)}</span>
                            <span className="shrink-0 text-[13px] text-muted-foreground tnum">{tokens ? `${Math.round((n / tokens) * 100)}%` : ""}</span>
                          </div>
                          <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <div className="h-full rounded-full bg-foreground" style={{ width: `${Math.max(2, (n / topFeature) * 100)}%` }} />
                          </div>
                          <div className="text-xs text-muted-foreground tnum">
                            {f.calls.toLocaleString()} {f.calls === 1 ? "call" : "calls"} · {fmtTokens(n)} tokens
                            {f.failed > 0 && ` · ${f.failed} failed`}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {features.length > TOP && (
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                      {showAll ? "Show fewer" : `Show all ${features.length}`}
                    </button>
                  )}
                </>
              )}
            </section>
          </div>

          <section aria-label="Recent activity" className="mt-9">
            <div role="tablist" aria-label="Recent activity" className="flex gap-5 border-b border-border">
              {tabs.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === tb.id}
                  onClick={() => setTab(tb.id)}
                  className={cn("-mb-px border-b-[1.5px] pb-2 text-[13.5px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring", tab === tb.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                >
                  {tb.label} <span className="text-xs text-tertiary tnum">{tb.count}</span>
                </button>
              ))}
            </div>
            {rows.length === 0 && !(tab === "agents" && data.skipped_runs > 0) ? (
              <p className="py-5 text-sm text-muted-foreground">Nothing yet. Replies drafted by agents, people let in and chats show up here.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {rows.map((a) => {
                  const st = STATUS[a.status];
                  const Icon = a.kind === "chat" ? MessageSquareText : a.kind === "let_in" ? UserCheck : a.status === "acted" ? Check : Bot;
                  const body = (
                    <>
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{a.subtitle}</div>
                      </div>
                      {st && a.kind !== "chat" && (
                        <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[11.5px]", st.tone === "ok" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : st.tone === "warn" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{st.label}</span>
                      )}
                      <time className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground tnum">{fmtRelative(a.time)}</time>
                      {a.link && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />}
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {a.link ? (
                        <Link to={a.link} className="flex items-start gap-3 py-2.5 hover:bg-muted/30">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 py-2.5">{body}</div>
                      )}
                    </li>
                  );
                })}
                {tab === "agents" && data.skipped_runs > 0 && (
                  <li className="flex items-start gap-3 py-2.5">
                    <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{data.skipped_runs.toLocaleString()} {data.skipped_runs === 1 ? "mail" : "mails"} skipped by agents</div>
                      <div className="text-xs text-muted-foreground">Delivery notices and mail from no-reply addresses are left alone.</div>
                    </div>
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11.5px] text-muted-foreground">Skipped</span>
                  </li>
                )}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
