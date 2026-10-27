import { BrandIcon } from "@/components/BrandIcons";
import { type Neighbours } from "@/lib/threadNav";
import { ArrowLeft, ChevronDown, ChevronUp, Reply } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** A slim bar under the app header while a long thread is scrolled: which thread this is, and the few things you reach for. */
export function SlimHeader({
  top,
  col,
  subject,
  names,
  neighbours,
  onBack,
  onGo,
  onReply,
  onReplyLater,
  replyLaterOn,
  onSetAside,
  setAsideOn,
  hideReply,
}: {
  top: number;
  col: { left: number; width: number } | null;
  subject: string;
  names: string[];
  neighbours: Neighbours | null;
  onBack: () => void;
  onGo: (id: string) => void;
  onReply: () => void;
  onReplyLater: () => void;
  replyLaterOn: boolean;
  onSetAside: () => void;
  setAsideOn: boolean;
  hideReply: boolean;
}) {
  return (
    <div
      role="banner"
      aria-label="Thread"
      className="fixed z-20 border-b border-border/60 bg-background/95 backdrop-blur animate-in fade-in-0 slide-in-from-top-1 duration-150"
      style={{ top, left: col?.left ?? 0, width: col?.width ?? "100%" }}
    >
      <div className="mx-auto flex h-10 max-w-5xl items-center gap-1.5 px-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back" className="-ml-1 text-muted-foreground" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1 truncate text-[13px]">
          <span className="font-semibold text-foreground">{subject || "(no subject)"}</span>
          {names.length > 0 && <span className="ml-2 hidden text-muted-foreground sm:inline">{names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}</span>}
        </div>
        {neighbours && (
          <div className="hidden items-center sm:flex">
            <Button variant="ghost" size="icon-sm" aria-label="Previous thread" disabled={!neighbours.prev} className="text-muted-foreground" onClick={() => neighbours.prev && onGo(neighbours.prev)}>
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next thread" disabled={!neighbours.next} className="text-muted-foreground" onClick={() => neighbours.next && onGo(neighbours.next)}>
              <ChevronDown />
            </Button>
          </div>
        )}
        <Button variant="ghost" size="sm" className={cn("text-muted-foreground", replyLaterOn && "bg-muted text-foreground")} aria-pressed={replyLaterOn} onClick={onReplyLater}>
          <BrandIcon name="reply-later" /> <span className="hidden md:inline">Reply later</span>
        </Button>
        <Button variant="ghost" size="sm" className={cn("text-muted-foreground", setAsideOn && "bg-muted text-foreground")} aria-pressed={setAsideOn} onClick={onSetAside}>
          <BrandIcon name="set-aside" /> <span className="hidden md:inline">Set aside</span>
        </Button>
        {!hideReply && (
          <Button size="sm" onClick={onReply}>
            <Reply /> Reply
          </Button>
        )}
      </div>
    </div>
  );
}
