import { BrandIcon } from "./BrandIcons";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, RefreshCw, Sun, Video, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api, useBrief, useBriefRefresh, useBulkAction, type BriefItem } from "../api";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "../context/AccountContext";
import { openExternalUrl } from "../lib/native";
import { liveHeadline, liveMeetings, meetingLength, meetingTiming, type BriefMeeting } from "../lib/briefClock";
import { Button } from "@/components/ui/button";
import { DailyMotivationCard } from "./DailyMotivationCard";

const KIND_LABEL: Record<BriefItem["kind"], string> = { reply: "Reply", decide: "Decide", deadline: "Deadline", waiting: "Waiting" };

const DISMISS_KEY = "inbox.brief.dismissed";
function dismissedDay(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? "";
  } catch {
    return "";
  }
}

/** "Reda · asks which date works", or just the reason when it already starts with the sender's name. */
function byline(it: BriefItem): string {
  const who = it.from_name || it.from_email;
  return it.why.toLowerCase().startsWith(who.toLowerCase()) ? it.why : `${who} · ${it.why}`;
}

/** Re-renders every so often, so a meeting can move from "in 10 min" to "Started" to gone without a reload. */
function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const people = (n: number) => (n > 1 ? `${n} people` : "");

/** The meeting that is next (or just started) gets a block with its time, length, place and Join; the rest of the day follows as quiet lines. */
function Meetings({ meetings, now }: { meetings: BriefMeeting[]; now: number }) {
  const next = meetings.find((m) => !m.all_day);
  const rest = meetings.filter((m) => m !== next);
  const shown = rest.slice(0, 4);
  const t = next ? meetingTiming(next, now) : null;
  const [hm, ap] = next ? clock(next.starts_at).split(/\s+/) : ["", ""];
  const sub = next ? [t?.label || "Next", meetingLength(next), people(next.attendees ?? 0)].filter(Boolean).join(" · ") : "";
  return (
    <div className="mx-4 mt-3">
      {next && t && (
        <div className="flex items-center gap-3.5 rounded-lg bg-muted/60 px-3.5 py-3">
          <div className="min-w-[3.25rem] text-center leading-tight">
            <div className="text-xl font-medium tnum">{hm}</div>
            {ap && <div className="text-xs text-muted-foreground">{ap}</div>}
          </div>
          <span className="w-px self-stretch bg-border" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-muted-foreground">{sub}</div>
            <div className="truncate text-[15px] font-medium">{next.title}</div>
            {next.location && <div className="truncate text-xs text-muted-foreground">{next.location}</div>}
          </div>
          {next.join_url && (
            <Button size="xs" variant={t.started || t.soon ? "default" : "outline"} className="shrink-0" onClick={() => openExternalUrl(next.join_url)}>
              <Video /> Join
            </Button>
          )}
        </div>
      )}
      {shown.length > 0 && (
        <ul className={cn("space-y-0.5", next && "mt-2")}>
          {shown.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 px-1 py-1 text-[13.5px]">
              <span className="w-16 shrink-0 text-xs text-muted-foreground tnum">{m.all_day ? "All day" : clock(m.starts_at)}</span>
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{[meetingLength(m), people(m.attendees ?? 0)].filter(Boolean).join(" · ")}</span>
              {m.join_url && (
                <Button size="xs" variant="outline" className="shrink-0" onClick={() => openExternalUrl(m.join_url)}>
                  <Video /> Join
                </Button>
              )}
            </li>
          ))}
          {rest.length > 4 && <li className="pl-[4.6rem] text-xs text-muted-foreground">+{rest.length - 4} more today</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * The top of the Imbox: what needs you today. Meetings with a Join button, then the few threads that matter most, each with the
 * reason it is there, and the thought of the day as its last line. Written by plain rules at once and refined by the AI when one is set up. Hidden when there is nothing to say,
 * and for the rest of the day once dismissed.
 */
export function BriefCard({ compact }: { compact?: boolean }) {
  const { accounts } = useAccount();
  const q = useBrief(accounts.length > 0);
  const refresh = useBriefRefresh();
  const bulk = useBulkAction();
  const qc = useQueryClient();
  // Rows parked with Reply later leave the card at once; the brief itself is rewritten on its next look.
  const [parked, setParked] = useState<Set<string>>(() => new Set());
  const [hiddenDay, setHiddenDay] = useState(dismissedDay);
  const now = useNow();
  const data = q.data;
  const brief = data?.brief;
  const meetings = brief ? liveMeetings(brief.meetings, now) : [];
  if (brief && hiddenDay === brief.day) return null;
  // With nothing to say about the day, the thought still stands on its own.
  if (!brief || (brief.items.length === 0 && meetings.length === 0)) return <DailyMotivationCard compact={compact} />;

  const busy = refresh.isPending || !!data?.pending;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, brief.day);
    } catch {
      /* private mode: it just comes back on reload */
    }
    setHiddenDay(brief.day);
  };
  const date = new Date().toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  return (
    <section className={cn("rounded-xl border border-border/70 bg-card", compact ? "mx-4 mb-3" : "mb-6")} aria-label="Today">
      <header className="flex items-start gap-3 px-4 pt-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80">
          <Sun size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">Today · {date}</div>
          <p className={cn("font-semibold leading-snug", compact ? "text-[15px]" : "text-[15px]")}>{liveHeadline(brief, now)}</p>
        </div>
        <div className="-mr-1.5 flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Look again"
            disabled={busy}
            onClick={() => refresh.mutate(undefined, { onSuccess: (r) => r.cooldown && toast("Just looked. Try again in a few minutes.") })}
          >
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Hide for today" onClick={dismiss}>
            <X />
          </Button>
        </div>
      </header>

      {meetings.length > 0 && <Meetings meetings={meetings} now={now} />}

      {brief.items.length > 0 && (
        <ul className={cn("mx-2 mt-2 divide-y divide-border/50", meetings.length > 0 && "border-t border-border/50 pt-1")}>
          {brief.items.filter((it) => !parked.has(it.thread_id)).map((it) => (
            <li key={it.thread_id} className="group relative">
              <Link to={`/t/${it.thread_id}`} className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/60 active:bg-muted/60">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-5 w-[4.3rem] shrink-0 items-center justify-center rounded text-[11px] font-medium",
                    it.urgent ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {it.urgent ? "Today" : KIND_LABEL[it.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium leading-5">{it.subject}</span>
                  <span className="block truncate text-[12.5px] leading-4 text-muted-foreground">
                    {byline(it)}
                  </span>
                </span>
              </Link>
              {!compact && it.kind === "waiting" && (
                <Button
                  variant="outline"
                  size="xs"
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-background opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    const unpark = () =>
                      setParked((p) => {
                        const n = new Set(p);
                        n.delete(it.thread_id);
                        return n;
                      });
                    setParked((p) => new Set(p).add(it.thread_id));
                    api
                      .post("/api/ai/actions/state", { thread_id: it.thread_id, action_id: "not_waiting", state: "done" })
                      .then(() => {
                        toast("Not waiting on this any more");
                        void qc.invalidateQueries({ queryKey: ["brief"] });
                      })
                      .catch((e) => {
                        unpark();
                        toast((e as Error).message);
                      });
                  }}
                >
                  <Check /> Not waiting
                </Button>
              )}
              {!compact && it.kind !== "waiting" && (
                <Button
                  variant="outline"
                  size="xs"
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-background opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    setParked((p) => new Set(p).add(it.thread_id));
                    bulk.mutate({ thread_ids: [it.thread_id], action: "reply_later", on: true }, {
                      onSuccess: () => toast("Moved to Reply Later"),
                      onError: (e) => {
                        setParked((p) => {
                          const n = new Set(p);
                          n.delete(it.thread_id);
                          return n;
                        });
                        toast((e as Error).message);
                      },
                    });
                  }}
                >
                  <BrandIcon name="reply-later" /> Reply later
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <DailyMotivationCard embedded />

      <footer className="flex items-center gap-1.5 px-4 pb-3 pt-1.5 text-[11.5px] text-tertiary">
        {data?.pending ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Refining with AI…
          </>
        ) : brief.source === "ai" ? (
          <>
            <BrandIcon name="assistant" size={12} /> Picked by AI · updated {clock(brief.created_at)}
          </>
        ) : (
          <>Sorted from your mail · updated {clock(brief.created_at)}</>
        )}
      </footer>
    </section>
  );
}
