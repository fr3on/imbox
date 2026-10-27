import { BrandIcon } from "./BrandIcons";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@shared/types";
import { Check, Reply } from "lucide-react";
import { useMemo, useState } from "react";
import { cleanSnippet } from "../lib/snippet";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useBrief, useBulkAction, useGist, useThread } from "../api";
import { readableExcerpt } from "@shared/readable";
import { useAccount } from "../context/AccountContext";
import { liveMeetings } from "../lib/briefClock";
import { overlayOpen } from "../lib/focusStore";
import { fmtTime } from "../lib/format";
import { useKeys } from "../lib/keys";
import { Avatar } from "./Avatar";

/** A row of the list below is focused or selected; it owns the shortcut keys then. */
function listRowActive(): boolean {
  return !!document.querySelector("[data-row-id].bg-muted, [data-row-id].bg-accent");
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * What the top card says under its subject, and when it is final. The words arrive in three steps on a fresh page: the list's own snippet
 * at once, the start of the message once it has been read, and the AI's one line last. Each step is better than the one before, so the
 * card shows the best it has and says which step that is; the card fades only between steps, and never moves, because the paragraph holds
 * its height.
 */
function useDeckText(thread: ThreadSummary | undefined): { text: string; step: "snippet" | "message" | "gist" } {
  const detail = useThread(thread?.id, true).data;
  const lastText = detail?.messages.length ? detail.messages[detail.messages.length - 1].text_body : "";
  const gist = useGist(thread?.id).data?.gist ?? "";
  if (gist) return { text: gist, step: "gist" };
  const excerpt = readableExcerpt(lastText || "");
  if (excerpt) return { text: excerpt, step: "message" };
  return { text: cleanSnippet(thread?.snippet ?? ""), step: "snippet" };
}

/** The deck's place while the Imbox loads: the same size and shape as the card, so the page does not jump when it arrives. */
export function DeckSkeleton() {
  return (
    <section aria-label="New for you" aria-busy className="mb-8 mt-8 text-center">
      <div className="mx-auto mb-4 h-3 w-32 animate-pulse rounded bg-muted" />
      <div className="mx-auto mb-10 w-full max-w-[680px] rounded-2xl border border-border bg-background p-6 shadow-sm sm:p-9">
        <div className="mx-auto flex items-center justify-center gap-2.5">
          <div className="size-9 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-44 animate-pulse rounded bg-muted" />
        </div>
        <div className="mx-auto mt-5 h-8 w-4/5 animate-pulse rounded bg-muted" />
        <div className="mx-auto mt-5 grid max-w-[56ch] gap-2.5">
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="h-4 animate-pulse rounded bg-muted" />
          <div className="mx-auto h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-8 flex justify-center gap-2.5">
          {[88, 84, 84].map((w, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" style={{ width: w }} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The Imbox as a deck: the next new message is one large card in the middle of the page, the rest stacked beneath it.
 * Reply, Later and Seen each send the card away and bring up the next. When the stack is empty it says so, and points at what is next.
 */
/** How many of the Imbox threads that were read have had mail today, for the caught-up view to say how the day went. */
export function readToday(seen: ThreadSummary[] | undefined, now = Date.now()): number {
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  return (seen ?? []).filter((t) => t.last_message_at >= midnight).length;
}

export function ImboxDeck({ threads, read = 0 }: { threads: ThreadSummary[]; read?: number }) {
  const nav = useNavigate();
  const bulk = useBulkAction();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const items = useMemo(() => threads.filter((t) => !gone.has(t.id)), [threads, gone]);
  const top = items[0];
  const total = items.length + gone.size;

  const { text: body, step } = useDeckText(top);

  const leave = (payload: Parameters<typeof bulk.mutate>[0]) => {
    if (!top) return;
    const id = top.id;
    setGone((g) => new Set(g).add(id));
    bulk.mutate(payload, {
      onError: () => {
        setGone((g) => {
          const n = new Set(g);
          n.delete(id);
          return n;
        });
        toast.error("That didn’t work", { description: "Try again." });
      },
    });
  };
  const free = () => !!top && !overlayOpen() && !listRowActive();

  useKeys(
    {
      r: () => free() && nav(`/t/${top!.id}`),
      l: () => free() && leave({ thread_ids: [top!.id], action: "reply_later", on: true }),
      a: () => free() && leave({ thread_ids: [top!.id], action: "set_aside", on: true }),
      e: () => free() && leave({ thread_ids: [top!.id], action: "seen" }),
    },
    !!top,
  );

  if (!top) return <CaughtUp read={read} />;

  return (
    <section aria-label="New for you" className="mb-8 mt-6 text-center sm:mt-[clamp(2rem,10vh,7.5rem)]">
      <div className="mb-4 flex items-center justify-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
        <span className="tnum">
          New for you · {gone.size + 1} of {total}
        </span>
        {total <= 8 && (
          <span className="inline-flex gap-1.5" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <i key={i} className={cn("size-1.5 rounded-[2px]", i === gone.size ? "bg-foreground" : "bg-border")} />
            ))}
          </span>
        )}
      </div>

      <div className="relative mx-auto mb-10 w-full max-w-[680px]">
        {items.length > 2 && <div className="absolute inset-x-0 top-0 h-full translate-y-[30px] scale-[0.93] rounded-2xl border border-border bg-background opacity-90" aria-hidden />}
        {items.length > 1 && <div className="absolute inset-x-0 top-0 h-full translate-y-[15px] scale-[0.965] rounded-2xl border border-border bg-background" aria-hidden />}
        <article key={top.id} className={cn("relative z-10 rounded-2xl border border-border bg-background p-6 text-center shadow-sm sm:p-9", gone.size > 0 && "animate-in fade-in-0 slide-in-from-bottom-1 duration-200")}>
          <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[14.5px]">
            <Avatar email={top.last_from.email} name={top.last_from.name} src={top.last_from.avatar_url} size={36} />
            <span className="whitespace-nowrap font-semibold text-foreground">{top.last_from.name || top.last_from.email}</span>
            <span className="tnum whitespace-nowrap text-muted-foreground">
              {fmtTime(top.last_message_at)}
              {top.message_count > 1 ? ` · ${top.message_count} messages` : ""}
            </span>
          </div>
          <h2 className="mt-4 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[31px]">
            <Link to={`/t/${top.id}`} className="hover:underline underline-offset-4 decoration-border">
              {top.subject || "(no subject)"}
            </Link>
          </h2>
          {/* Holds three lines whatever it says, and fades only when a better version replaces the last one. */}
          <p key={step} className={cn("mx-auto mt-4 line-clamp-5 min-h-[4.9rem] max-w-[56ch] text-[16px] leading-relaxed text-muted-foreground sm:min-h-[5.3rem] sm:text-[17px]", step !== "snippet" && "animate-in fade-in-0 duration-300")}>
            {body}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button size="lg" className="h-10 px-4 text-[15px]" onClick={() => nav(`/t/${top.id}`)}>
              <Reply /> Reply <Kbd className="max-md:hidden">r</Kbd>
            </Button>
            <Button size="lg" variant="outline" className="h-10 px-4 text-[15px]" onClick={() => leave({ thread_ids: [top.id], action: "reply_later", on: true })}>
              <BrandIcon name="reply-later" /> Later <Kbd className="max-md:hidden">l</Kbd>
            </Button>
            <Button size="lg" variant="outline" className="h-10 px-4 text-[15px]" onClick={() => leave({ thread_ids: [top.id], action: "seen" })}>
              <Check /> Seen <Kbd className="max-md:hidden">e</Kbd>
            </Button>
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground max-md:hidden">
            <Kbd>a</Kbd> set aside
          </p>
          <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground md:hidden" onClick={() => leave({ thread_ids: [top.id], action: "set_aside", on: true })}>
            <BrandIcon name="set-aside" /> Set aside
          </Button>
        </article>
      </div>
    </section>
  );
}

/** Nothing new: say so, then point at what still needs you. */
function CaughtUp({ read }: { read: number }) {
  const { accounts } = useAccount();
  const brief = useBrief(accounts.length > 0).data?.brief;
  const now = Date.now();
  const meetings = brief ? liveMeetings(brief.meetings, now) : [];
  const next = meetings.find((m) => !m.all_day && m.starts_at > now) ?? meetings[0];
  const nextLine = next ? (next.all_day ? `Today: ${next.title}` : `next meeting at ${clock(next.starts_at)}`) : "";
  return (
    <section aria-label="All caught up" className="mb-8 mt-6 text-center sm:mt-[clamp(2rem,10vh,7.5rem)]">
      <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Check size={22} />
      </span>
      <h2 className="text-[clamp(1.9rem,4.5vw,2.7rem)] font-medium leading-[1.1] tracking-[-0.04em]">Nothing new.</h2>
      <p className="mt-2.5 text-[15.5px] text-muted-foreground">{[read > 0 ? `${read} read today` : "", nextLine].filter(Boolean).join(" · ") || "Go enjoy your day. Mail from people you’ve screened in shows up here."}</p>
      {read > 0 && (
        <div className="mt-4 flex justify-center gap-1" aria-hidden>
          {Array.from({ length: Math.min(read, 8) }, (_, i) => (
            <i key={i} className="h-1 w-5 rounded-full bg-emerald-500" />
          ))}
        </div>
      )}
    </section>
  );
}
