import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, Flag, ListTodo, Loader2, } from "lucide-react";
import { toast } from "sonner";
import type { ThreadDetail } from "@shared/types";
import { api, useAiSettings, useEventFromThread, useThreadAction } from "../api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface When {
  all_day: boolean;
  start_date: string | null;
  end_date: string | null;
  starts_at: number;
  ends_at: number;
}

interface SuggestedAction {
  id: string;
  kind: "event" | "deadline" | "task";
  title: string;
  why: string;
  when: When | null;
  where: string;
}

/** What the mail is about at a glance: what it is, what is asked, when it is due, and the numbers worth having. */
interface Overview {
  id: string;
  what: string;
  ask: string;
  due: When | null;
  urgent: boolean;
  facts: { label: string; value: string }[];
}

const ICON = { event: <BrandIcon name="scheduled" />, deadline: <Flag />, task: <ListTodo /> };

function whenLabel(w: When): string {
  const day = new Date(w.starts_at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  if (w.all_day) return day;
  const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(w.starts_at)} – ${t(w.ends_at)}`;
}

/** "today", "tomorrow", "in 4 days" for an all-day due date. */
function dueIn(w: When): string {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.round((w.starts_at - startOfToday.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Anything the buttons can act on: a suggested action, or the overview's own deadline. */
interface Item {
  id: string;
  kind: "event" | "deadline" | "task";
  title: string;
  why: string;
  when: When | null;
  where: string;
}

/**
 * What this mail asks of you, pulled out of the text. At the top, when it matters, a strip that says what the mail is, what is wanted,
 * by when and the numbers involved; below it, any meeting, deadline or request as its own suggestion. Each says what to do about it
 * (put it in the calendar, park the thread for later); nothing happens until you press a button.
 */
export function ActionsCard({ thread, className }: { thread: ThreadDetail; className?: string }) {
  const nav = useNavigate();
  const ai = useAiSettings();
  const toEvent = useEventFromThread();
  const act = useThreadAction(thread.id);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const last = thread.messages[thread.messages.length - 1];
  // Newsletters and the Screener are skipped; the Paper Trail is looked at, because that is where the notice that demands something lands.
  const enabled = ai.data?.configured === true && ai.data.suggest_actions !== false && (thread.bucket === "imbox" || thread.bucket === "paper_trail" || thread.reply_later) && !!last;
  const q = useQuery({
    queryKey: ["ai", "actions", thread.id, last?.id ?? "", thread.messages.length],
    queryFn: () => api.post<{ actions: SuggestedAction[]; overview: Overview | null }>("/api/ai/actions", { thread_id: thread.id }),
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  const actions = (q.data?.actions ?? []).filter((a) => !gone.has(a.id));
  const overview = q.data?.overview && !gone.has(q.data.overview.id) ? q.data.overview : null;
  if (!enabled || q.isError || (actions.length === 0 && !overview)) return null;

  const mark = (id: string, state: "done" | "dismissed") => {
    setGone((g) => new Set([...g, id]));
    void api.post("/api/ai/actions/state", { thread_id: thread.id, action_id: id, state }).catch(() => {});
  };

  const addToCalendar = async (a: Item) => {
    if (!a.when) return;
    setBusyId(a.id);
    try {
      const base = await toEvent.mutateAsync(thread.id);
      const w = a.when;
      // The event sheet opens filled in and you pick the calendar and confirm; nothing is saved here.
      nav("/calendar", {
        state: {
          newEvent: {
            ...base,
            suggestions: undefined,
            title: a.kind === "event" ? a.title : `Due: ${a.title}`,
            description: a.why,
            location: a.where,
            all_day: w.all_day,
            start_date: w.start_date,
            end_date: w.end_date,
            starts_at: w.starts_at,
            ends_at: w.ends_at,
          },
        },
      });
      mark(a.id, "done");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't open the calendar");
    } finally {
      setBusyId(null);
    }
  };

  const replyLater = async (a: Item) => {
    setBusyId(a.id);
    try {
      const line = `To do: ${a.title}${a.when ? ` (${whenLabel(a.when)})` : ""}`;
      await act.mutateAsync({ action: "reply_later", on: true });
      await act.mutateAsync({ action: "note", note: thread.note ? `${thread.note}\n${line}` : line });
      toast("Parked in Reply Later, with a note");
      mark(a.id, "done");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't do that");
    } finally {
      setBusyId(null);
    }
  };

  const ovItem: Item | null = overview ? { id: overview.id, kind: "deadline", title: overview.ask || overview.what, why: overview.what, when: overview.due, where: "" } : null;

  return (
    <div className={cn("space-y-2", className)}>
      {overview && ovItem && (
        <section className={cn("rounded-lg border px-3 py-2.5", overview.urgent ? "border-amber-500/40 bg-amber-500/10" : "border-border/70 bg-muted/50")}>
          <div className="flex items-center gap-2 text-[13px] font-medium">
            {overview.urgent ? <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" /> : <BrandIcon name="assistant" className="size-3.5 text-muted-foreground" />}
            {overview.urgent ? "Needs your attention" : "What this asks of you"}
            <span className="flex-1" />
            {overview.due && (
              <span className={cn("rounded-md px-1.5 py-0.5 text-[12px] font-medium tnum", overview.urgent ? "bg-amber-500/20 text-amber-900 dark:text-amber-200" : "bg-background text-foreground shadow-[0_0_0_1px_var(--border)]")}>
                Due {whenLabel(overview.due)} · {dueIn(overview.due)}
              </span>
            )}
          </div>
          {overview.ask && <p className="mt-1.5 text-[14px] font-medium leading-5">{overview.ask}</p>}
          {overview.what && <p className={cn("text-[13px] leading-5 text-muted-foreground", !overview.ask && "mt-1.5 text-foreground")}>{overview.what}</p>}
          {overview.facts.length > 0 && (
            <dl className="mt-2 flex flex-wrap gap-1.5">
              {overview.facts.map((f) => (
                <div key={f.label} className="inline-flex items-baseline gap-1.5 rounded-md bg-background/80 px-2 py-1 text-[12.5px] shadow-[0_0_0_1px_var(--border)]">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="font-medium tnum">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {overview.due && (
              <Button size="xs" variant="outline" disabled={busyId === ovItem.id} onClick={() => addToCalendar(ovItem)}>
                {busyId === ovItem.id ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Add deadline to calendar
              </Button>
            )}
            {overview.ask && (
              <Button size="xs" variant="outline" disabled={busyId === ovItem.id} onClick={() => replyLater(ovItem)}>
                <BrandIcon name="reply-later" /> Reply later
              </Button>
            )}
            <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busyId === ovItem.id} onClick={() => mark(overview.id, "dismissed")}>
              Dismiss
            </Button>
          </div>
        </section>
      )}

      {actions.length > 0 && (
        <div className="rounded-lg bg-muted/50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <BrandIcon name="assistant" className="size-3.5 text-muted-foreground" /> {overview ? "Also in this mail" : actions.length === 1 ? "Something in this mail" : "Things in this mail"}
          </div>
          <ul className="mt-1 divide-y divide-border/50">
            {actions.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 py-2.5">
                <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">{ICON[a.kind]}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium leading-5">{a.title}</div>
                  {a.when && <div className="text-[12.5px] leading-4 text-foreground/80 tnum">{whenLabel(a.when)}</div>}
                  {a.why && <div className="mt-0.5 text-[12.5px] leading-4 text-muted-foreground">{a.why}</div>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {a.when && (
                      <Button size="xs" variant="outline" disabled={busyId === a.id} onClick={() => addToCalendar(a)}>
                        {busyId === a.id ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Add to calendar
                      </Button>
                    )}
                    {a.kind !== "event" && (
                      <Button size="xs" variant="outline" disabled={busyId === a.id} onClick={() => replyLater(a)}>
                        <BrandIcon name="reply-later" /> Reply later
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={busyId === a.id} onClick={() => mark(a.id, "dismissed")}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
