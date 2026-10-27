import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { useBulkAction } from "../api";
import { fmtRelative } from "../lib/format";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { useAssistant } from "../lib/assistantStore";
import { cn } from "@/lib/utils";

type Tray = "reply" | "aside";

/**
 * Reply Later and Set Aside as one card above the assistant box, with the rest of the pile showing as two edges behind it. A small
 * switch at the left picks the tray; the card, arrows and counter stay where they are. Reply Later offers Reply and Done, since
 * something is waiting on you; Set Aside is a stash, so it offers Open and Remove. Empty trays leave the switch.
 */
export function Piles({ replyLater, setAside }: { replyLater: ThreadSummary[]; setAside: ThreadSummary[] }) {
  const bulk = useBulkAction();
  const assistant = useAssistant();
  const navigate = useNavigate();
  const [pick, setPick] = useState<Tray>("reply");
  const [at, setAt] = useState<Record<Tray, number>>({ reply: 0, aside: 0 });
  if (replyLater.length === 0 && setAside.length === 0) return null;
  // The tray that was picked may have emptied since; fall to the other one.
  const tray: Tray = pick === "reply" ? (replyLater.length ? "reply" : "aside") : setAside.length ? "aside" : "reply";
  const threads = tray === "reply" ? replyLater : setAside;
  const n = threads.length;
  const i = Math.min(at[tray], n - 1);
  const t = threads[i];
  const step = (d: number) => setAt((a) => ({ ...a, [tray]: (i + d + n) % n }));
  const trays: { id: Tray; label: string; count: number }[] = [
    { id: "reply", label: "Reply later", count: replyLater.length },
    { id: "aside", label: "Set aside", count: setAside.length },
  ];
  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-[136px] left-1/2 z-40 w-[min(720px,calc(100vw-32px))] -translate-x-1/2 transition-all duration-200",
        assistant.open && "pointer-events-none translate-y-2 opacity-0"
      )}
    >
      <div className="relative pb-3">
        {n > 2 && <div aria-hidden className="absolute inset-x-5 -bottom-1.5 h-6 rounded-b-xl border border-border bg-background/50 dark:bg-card/50" />}
        {n > 1 && <div aria-hidden className="absolute inset-x-2.5 bottom-0 h-6 rounded-b-xl border border-border bg-background/70 dark:bg-card/70" />}
        <div className="pointer-events-auto relative z-10 flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-background/95 py-2 pl-2 pr-2 shadow-xs backdrop-blur-md dark:bg-card/95">
          <div role="tablist" aria-label="Tray" className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5 text-[12px]">
            {trays.filter((x) => x.count > 0).map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tray === x.id}
                className={cn("tnum whitespace-nowrap rounded-md px-2.5 py-1 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring", tray === x.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setPick(x.id)}
              >
                {x.label} {x.count}
              </button>
            ))}
          </div>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => navigate(`/t/${t.id}`)} aria-label={`Open ${t.subject || "(no subject)"}`}>
            <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={26} />
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-medium text-foreground">{t.subject || "(no subject)"}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">
                {t.last_from.name || t.last_from.email} · {fmtRelative(t.last_message_at)}
              </span>
            </span>
          </button>
          {n > 1 && (
            <span className="flex shrink-0 items-center text-muted-foreground">
              <Button variant="ghost" size="icon-xs" aria-label="Previous" onClick={() => step(-1)}>
                <ChevronLeft />
              </Button>
              <Link to={tray === "reply" ? "/reply-later" : "/set-aside"} title={tray === "reply" ? "Open all in Reply later" : "Open all in Set aside"} className="tnum rounded px-1 text-[12px] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
                {i + 1} of {n}
              </Link>
              <Button variant="ghost" size="icon-xs" aria-label="Next" onClick={() => step(1)}>
                <ChevronRight />
              </Button>
            </span>
          )}
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => bulk.mutate({ thread_ids: [t.id], action: tray === "reply" ? "reply_later" : "set_aside", on: false })}>
            {tray === "reply" ? "Done" : "Remove"}
          </Button>
          <Button size="sm" className="shrink-0" onClick={() => navigate(tray === "reply" ? `/t/${t.id}?reply=1` : `/t/${t.id}`)}>
            {tray === "reply" ? "Reply" : "Open"}
          </Button>
        </div>
      </div>
    </div>
  );
}
