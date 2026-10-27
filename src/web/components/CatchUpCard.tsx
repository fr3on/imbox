import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadDetail } from "@shared/types";
import { api, useAiSettings } from "../api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CatchUpResult {
  changes: string[];
  ask: string;
  new_count: number;
}

/** A thread this short is quick enough to read whole. */
const MIN_MESSAGES = 4;
/** Nothing new, but a thread this long is still worth catching up on. */
const LONG_THREAD = 6;
/** How many of the latest messages the on-demand catch-up covers. */
const RECENT = 5;
/** New text beyond this is worth summarising even when only one message brought it. */
const LONG_NEW_TEXT = 1200;

/**
 * Opening a thread marks it read at once, so what was new has to be remembered from that first load. It is kept for the session,
 * per thread; a later load (which sees nothing new, because it is read now) does not wipe it.
 */
const remembered = new Map<string, string[]>();

function newIdsFor(t: ThreadDetail): string[] {
  const seen = remembered.get(t.id);
  if (seen) return seen;
  if (t.new_message_ids?.length) {
    remembered.set(t.id, t.new_message_ids);
    return t.new_message_ids;
  }
  return [];
}

/**
 * "Catch me up" on a long thread that has grown since it was last read: only what changed, in a few lines, and what is now
 * needed from you. Runs by itself when a lot is new, and on request when only a little is.
 */
export function CatchUpCard({ thread, className }: { thread: ThreadDetail; className?: string }) {
  const ai = useAiSettings();
  const newIds = newIdsFor(thread);
  // With nothing new, a long thread can still be caught up on by hand: its latest few messages.
  const recent = newIds.length === 0;
  const ids = recent ? thread.messages.slice(-RECENT).map((m) => m.id) : newIds;
  const [asked, setAsked] = useState(false);
  const [hidden, setHidden] = useState(false);

  const fresh = thread.messages.filter((m) => ids.includes(m.id));
  const newChars = fresh.reduce((n, m) => n + (m.text_body?.length || m.html_body?.length || 0), 0);
  const eligible = ai.data?.configured === true && ids.length > 0 && thread.messages.length >= (recent ? LONG_THREAD : MIN_MESSAGES);
  const auto = !recent && (ids.length >= 2 || newChars >= LONG_NEW_TEXT);

  const q = useQuery({
    queryKey: ["ai", "catchup", thread.id, ids.join(","), recent],
    queryFn: () => api.post<CatchUpResult>("/api/ai/catchup", { thread_id: thread.id, message_ids: ids, recent }),
    enabled: eligible && (auto || asked),
    staleTime: Infinity,
    retry: false,
  });

  if (!eligible || hidden) return null;
  const shell = "rounded-lg bg-muted/50 px-3 py-2.5";
  const count = recent ? `the latest ${ids.length}` : `${ids.length} new ${ids.length === 1 ? "message" : "messages"}`;

  if (!auto && !asked) {
    return (
      <div className={cn(shell, "flex items-center gap-2 text-[13px]", className)}>
        <BrandIcon name="assistant" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-muted-foreground">{recent ? `A long thread · ${thread.messages.length} messages` : `${count} since you last read`}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => setAsked(true)}>
          {recent ? `Catch me up on ${count}` : "Catch me up"}
        </Button>
      </div>
    );
  }
  if (q.isLoading) {
    return (
      <div className={cn(shell, "flex items-center gap-2 text-[13px] text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin" /> Catching you up on {count}{recent ? " messages" : ""}…
      </div>
    );
  }
  // A failure, or nothing worth saying: stay out of the way rather than show an empty box.
  const r = q.data;
  if (q.isError || !r || (!r.changes.length && !r.ask)) return null;

  return (
    <div className={cn(shell, className)}>
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <BrandIcon name="assistant" className="size-3.5 text-muted-foreground" /> {recent ? "Where it stands now" : "Since you last read"}
        <span className="text-[11px] font-normal text-muted-foreground">{recent ? `from ${count} messages` : count}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setHidden(true)} aria-label="Hide" className="text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      {r.changes.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-5 marker:text-muted-foreground">
          {r.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {r.ask && (
        <p className="mt-2 rounded-md bg-background/80 px-2.5 py-1.5 text-[13px] leading-5">
          <span className="font-medium">Needs you: </span>
          {r.ask}
        </p>
      )}
    </div>
  );
}
