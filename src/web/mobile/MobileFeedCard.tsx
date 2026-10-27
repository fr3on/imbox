import { BrandIcon } from "../components/BrandIcons";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, ChevronDown, MoreHorizontal, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useBulkAction, type FeedThread, type FeedBucket } from "../api";
import { useClipMutations } from "../api/organize";
import { useAccount } from "../context/AccountContext";
import { HtmlBody } from "../components/HtmlBody";
import { Avatar, AccountGlyph } from "../components/Avatar";
import { fmtTime, unsubscribeTarget } from "../lib/format";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const CAP = 360;

/** Where "Move to" can send a thread besides the Imbox: the other half of Feed. */
const OTHER: Record<FeedBucket, { bucket: FeedBucket; label: string; icon: React.ReactNode }> = {
  feed: { bucket: "paper_trail", label: "Receipts", icon: <BrandIcon name="paper-trail" /> },
  paper_trail: { bucket: "feed", label: "Reading", icon: <BrandIcon name="feed" /> },
};

export function MobileFeedCard({ t, bucket, onLeave }: { t: FeedThread; bucket: FeedBucket; onLeave: (id: string, cb: () => void) => void }) {
  const bulk = useBulkAction();
  const clips = useClipMutations();
  const nav = useNavigate();
  const { multi, glyphFor, accountFor } = useAccount();
  const acct = accountFor(t.account_id);
  const m = t.latest_message;
  const unsub = unsubscribeTarget(m?.list_unsubscribe ?? "");
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const other = OTHER[bucket];
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > CAP + 24);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const t1 = window.setTimeout(check, 600);
    return () => {
      ro.disconnect();
      clearTimeout(t1);
    };
  }, [m?.id]);
  const move = (target: "imbox" | FeedBucket, label: string) => onLeave(t.id, () => bulk.mutate({ thread_ids: [t.id], action: "move", bucket: target }, { onSuccess: () => toast(`Moved to ${label}`) }));
  return (
    <article className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <header className="flex items-center gap-3 px-4 pt-4">
        <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[14.5px] font-semibold leading-5">
            {t.unread && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="New" />}
            <span className="truncate">{t.last_from.name || t.last_from.email}</span>
            {multi && acct && <AccountGlyph glyph={glyphFor(acct.id)} label={acct.email} />}
          </div>
          <div className="truncate text-[12px] leading-4 text-muted-foreground">{t.last_from.email}</div>
        </div>
        <time className="shrink-0 text-[12px] text-muted-foreground tnum">{fmtTime(t.last_message_at)}</time>
      </header>
      <button type="button" onClick={() => nav(`/t/${t.id}`)} className="block w-full px-4 pt-3 text-left text-[18px] font-semibold leading-snug tracking-[-0.01em]">
        {t.subject || "(no subject)"}
      </button>
      <div className="relative px-4 pt-2 pb-1">
        <div ref={bodyRef} className={cn(!expanded && "overflow-hidden")} style={!expanded ? { maxHeight: CAP } : undefined}>
          {m ? (
            <HtmlBody
              html={m.html_body}
              text={m.text_body}
              trackers={m.trackers}
              sender={m.from.email}
              onClip={(text) =>
                clips.create.mutate(
                  { thread_id: t.id, message_id: m.id, text },
                  {
                    onSuccess: () => toast("Clip saved"),
                    onError: (err: any) => toast.error(err?.message || "Failed to save clip"),
                  }
                )
              }
            />
          ) : (
            <p className="text-[15px]">{t.snippet}</p>
          )}
        </div>
        {!expanded && overflows && (
          <div className="absolute inset-x-0 bottom-0 flex h-24 items-end justify-center bg-gradient-to-t from-card via-card/85 to-transparent pb-1">
            <Button variant="outline" size="sm" className="h-9" onClick={() => setExpanded(true)}>
              Read more <ChevronDown />
            </Button>
          </div>
        )}
      </div>
      <footer className="mt-2 flex items-center gap-1 border-t border-border/60 bg-muted/25 px-2 py-2">
        <Button variant="ghost" size="sm" className="h-10 text-muted-foreground" onClick={() => nav(`/t/${t.id}`)}>Open</Button>
        {unsub.url ? (
          <Button variant="ghost" size="sm" className="h-10 text-muted-foreground" asChild>
            <a href={unsub.url} target="_blank" rel="noopener noreferrer">Unsubscribe <ArrowUpRight /></a>
          </Button>
        ) : unsub.mailto ? (
          <Button variant="ghost" size="sm" className="h-10 text-muted-foreground" asChild>
            <a href={`mailto:${unsub.mailto}`}>Unsubscribe <ArrowUpRight /></a>
          </Button>
        ) : null}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label="Move somewhere else">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="h-10 text-[15px]" onSelect={() => move(other.bucket, other.label)}>
              {other.icon} Move to {other.label}
            </DropdownMenuItem>
            <DropdownMenuItem className="h-10 text-[15px]" onSelect={() => move("imbox", "Imbox")}>
              <BrandIcon name="imbox" /> Move to Imbox
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" className="h-10 px-4 text-[14px]" onClick={() => onLeave(t.id, () => bulk.mutate({ thread_ids: [t.id], action: "seen" }, { onSuccess: () => toast("Done") }))}>
          <Check /> Done
        </Button>
      </footer>
    </article>
  );
}
