import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, KeyRound, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, TriangleAlert, User, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useActivity, useClearActivity, type Actor, type ActivityEvent } from "../api";
import { ErrorState, PageHeader, SkeletonRows } from "../components/EmptyState";
import { Danger } from "../settings/parts";
import { useDebounced } from "../lib/useDebounced";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ACTORS: { id: Actor | ""; label: string }[] = [
  { id: "", label: "Everything" },
  { id: "you", label: "You" },
  { id: "rules", label: "imbox rules" },
  { id: "ai", label: "AI" },
  { id: "agent", label: "Agents" },
  { id: "sync", label: "Sync" },
  { id: "security", label: "Sign-ins" },
];

const WHO: Record<Actor, { label: string; icon: React.ReactNode }> = {
  you: { label: "You", icon: <User /> },
  rules: { label: "Rules", icon: <ShieldCheck /> },
  ai: { label: "AI", icon: <Sparkles /> },
  agent: { label: "Agent", icon: <Bot /> },
  sync: { label: "Sync", icon: <RefreshCw /> },
  security: { label: "Sign-in", icon: <KeyRound /> },
};

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Today", "Yesterday", or the weekday and date. */
function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

function EventRow({ e, onlyThis }: { e: ActivityEvent; onlyThis: (id: string) => void }) {
  const who = WHO[e.actor] ?? WHO.sync;
  const bad = e.level !== "info";
  const text = (
    <>
      <span className="block text-[13.5px] leading-5 text-foreground">{e.summary}</span>
      {e.why && <span className="block text-xs leading-4 text-muted-foreground">{e.why}</span>}
    </>
  );
  return (
    <li className="group/ev grid grid-cols-[3.75rem_1.25rem_minmax(0,1fr)_auto] sm:grid-cols-[4.25rem_1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 border-t border-border/60 px-1 py-2 first:border-t-0">
      <time className="whitespace-nowrap pt-0.5 text-xs text-muted-foreground tnum" dateTime={new Date(e.at).toISOString()}>
        {clock(e.at)}
      </time>
      <span className={cn("pt-0.5 [&>svg]:size-4", bad ? "text-destructive" : "text-muted-foreground")} aria-hidden="true">
        {bad ? <TriangleAlert /> : who.icon}
      </span>
      <div className="min-w-0">
        {e.thread_id ? (
          <Link to={`/t/${e.thread_id}`} className="block rounded-sm outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring">
            {text}
          </Link>
        ) : (
          text
        )}
      </div>
      <span className="flex items-center gap-2">
        {e.thread_id && (
          <button type="button" onClick={() => onlyThis(e.thread_id!)} className="hidden text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground group-hover/ev:inline group-focus-within/ev:inline">
            This conversation
          </button>
        )}
        <span className={cn("rounded-full px-2 py-px text-[11px]", bad ? "bg-destructive/10 text-destructive" : e.actor === "ai" ? "bg-muted text-foreground" : "bg-muted text-muted-foreground")}>{who.label}</span>
      </span>
    </li>
  );
}

/** Everything that happened in this imbox, by whom, and why: a feed by day with a filter for who did it, a search, and a view of one conversation. */
export default function Logs() {
  const [sp, setSp] = useSearchParams();
  const actor = (sp.get("actor") ?? "") as Actor | "";
  const problems = sp.get("problems") === "1";
  const thread = sp.get("thread") ?? "";
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const [confirm, setConfirm] = useState(false);
  const clear = useClearActivity();
  const query = useActivity({ actor, problems, q, thread });

  const set = (patch: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
        return next;
      },
      { replace: true },
    );

  const events = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.events), [query.data]);
  const days = useMemo(() => {
    const out: { label: string; items: ActivityEvent[] }[] = [];
    for (const e of events) {
      const label = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [events]);
  const filtered = !!(actor || problems || q || thread);

  return (
    <div className="mx-auto w-full max-w-3xl px-2 sm:px-4">
      <PageHeader
        title="Activity"
        subtitle="What you did, and what imbox decided, and why. Kept for 90 days."
        actions={
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirm(true)}>
            <Trash2 /> Clear
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Who did it">
        {ACTORS.map((a) => (
          <button
            key={a.id || "all"}
            type="button"
            aria-pressed={actor === a.id}
            onClick={() => set({ actor: a.id || null })}
            className={cn("rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", actor === a.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {a.label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={problems}
          onClick={() => set({ problems: problems ? null : "1" })}
          className={cn("rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", problems ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground")}
        >
          Problems only
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search the log" aria-label="Search the log" className="pl-9 pr-9" maxLength={100} />
        {text && (
          <button type="button" aria-label="Clear the search" onClick={() => setText("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>

      {thread && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">
          <span className="flex-1">Showing one conversation.</span>
          <Link to={`/t/${thread}`} className="underline underline-offset-2 hover:text-foreground">
            Open it
          </Link>
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => set({ thread: null })}>
            Show everything
          </button>
        </div>
      )}

      {query.isLoading ? (
        <SkeletonRows />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : days.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filtered ? "Nothing matches. Try another filter or clear the search." : "Nothing yet. What you do, and what imbox decides, will show up here."}
        </p>
      ) : (
        <>
          {days.map((d) => (
            <section key={d.label} aria-label={d.label} className="mb-5">
              <h2 className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-tertiary">{d.label}</h2>
              <ul>
                {d.items.map((e) => (
                  <EventRow key={e.sid} e={e} onlyThis={(id) => set({ thread: id })} />
                ))}
              </ul>
            </section>
          ))}
          {query.hasNextPage && (
            <div className="pb-8 text-center">
              <Button variant="outline" size="sm" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                {query.isFetchingNextPage ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </>
      )}

      <Danger
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear the activity log?"
        body="This removes what imbox wrote down about your actions and its decisions. Your mail is not touched. The sync messages and the AI usage record are kept for their own pages."
        action="Clear the log"
        onConfirm={() => clear.mutate(undefined, { onSuccess: () => toast("Activity log cleared"), onError: (e) => toast.error((e as Error).message) })}
      />
    </div>
  );
}
