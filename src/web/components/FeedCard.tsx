import { BrandIcon } from "./BrandIcons";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronDown, MoreHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBulkAction, useGistLine, type FeedThread, type FeedBucket } from "../api";
import { useClipMutations } from "../api/organize";
import { readableExcerpt } from "@shared/readable";
import { useAccount } from "../context/AccountContext";
import { HtmlBody } from "./HtmlBody";
import { Avatar, AccountGlyph } from "./Avatar";
import { useToast } from "./Toast";
import { fmtTime, fmtFull, unsubscribeTarget } from "../lib/format";
import { ImboxHintBanner } from "./ImboxHintBanner";
import { cleanSnippet } from "../lib/snippet";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const CAP = 480;

/** Where "Move to" can send a thread besides the Imbox: the other half of Feed. */
const OTHER: Record<FeedBucket, { bucket: FeedBucket; label: string; icon: React.ReactNode }> = {
  feed: { bucket: "paper_trail", label: "Receipts", icon: <BrandIcon name="paper-trail" /> },
  paper_trail: { bucket: "feed", label: "Reading", icon: <BrandIcon name="feed" /> },
};

export function FeedCard({ t, bucket, onLeave }: { t: FeedThread; bucket: FeedBucket; onLeave: (id: string, cb: () => void) => void }) {
  const bulk = useBulkAction();
  const clips = useClipMutations();
  const { toast } = useToast();
  const { multi, glyphFor, accountFor } = useAccount();
  const acct = accountFor(t.account_id);
  const m = t.latest_message;
  const unsub = unsubscribeTarget(m?.list_unsubscribe ?? "");
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const other = OTHER[bucket];

  // Detect whether the (iframe-sized) body exceeds the cap; re-check as the iframe resizes.
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

  const move = (target: "imbox" | FeedBucket, label: string) =>
    onLeave(t.id, () => bulk.mutate({ thread_ids: [t.id], action: "move", bucket: target }, { onSuccess: () => toast(`Moved to ${label}`, { kind: "success" }) }));

  return (
    <article className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <header className="flex items-center gap-3 px-5 pt-5">
        <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={32} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {t.unread && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-label="New" />}
            <span className="truncate text-sm font-semibold leading-5">{t.last_from.name || t.last_from.email}</span>
            {multi && acct && <AccountGlyph glyph={glyphFor(acct.id)} label={acct.email} />}
          </div>
          <div className="hidden truncate text-xs leading-4 text-muted-foreground sm:block">{t.last_from.email}</div>
        </div>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <time className="text-xs text-muted-foreground tnum shrink-0">{fmtTime(t.last_message_at)}</time>
          </TooltipTrigger>
          <TooltipContent>{fmtFull(t.last_message_at)}</TooltipContent>
        </Tooltip>
      </header>

      <div className="px-5 pt-3.5">
        <Link to={`/t/${t.id}`} className="block text-xl font-semibold leading-snug tracking-[-0.01em] hover:underline underline-offset-2">
          {t.subject || "(no subject)"}
        </Link>
      </div>
      <ImboxHintBanner thread={t} className="mx-5 mt-3" />

      <div className="relative max-w-[46rem] px-5 pt-3 pb-1">
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
                    onError: (err: any) => toast(err?.message || "Failed to save clip", { kind: "error" }),
                  }
                )
              }
            />
          ) : (
            <p className="text-sm">{t.snippet}</p>
          )}
        </div>
        {!expanded && overflows && (
          <div className="absolute inset-x-0 bottom-0 h-24 flex items-end justify-center pb-2 bg-gradient-to-t from-card via-card/85 to-transparent">
            <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
              Read more <ChevronDown />
            </Button>
          </div>
        )}
      </div>

      <footer className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/60 bg-muted/25 px-3 py-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
          <Link to={`/t/${t.id}`}>Open thread</Link>
        </Button>
        {unsub.url ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <a href={unsub.url} target="_blank" rel="noopener noreferrer">
              Unsubscribe <ArrowUpRight />
            </a>
          </Button>
        ) : unsub.mailto ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
                <a href={`mailto:${unsub.mailto}`}>
                  Unsubscribe <ArrowUpRight />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Email {unsub.mailto} to unsubscribe</TooltipContent>
          </Tooltip>
        ) : null}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label="Move somewhere else">
              <MoreHorizontal /> <span className="hidden sm:inline">Move to</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => move(other.bucket, other.label)}>
              {other.icon} {other.label}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move("imbox", "Imbox")}>
              <BrandIcon name="imbox" /> Imbox
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => onLeave(t.id, () => bulk.mutate({ thread_ids: [t.id], action: "seen" }, { onSuccess: () => toast("Done", { kind: "success" }) }))}>
              <Check /> Done
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Finished with this one <Kbd className="ml-1">e</Kbd>
          </TooltipContent>
        </Tooltip>
      </footer>
    </article>
  );
}

/** The words under a headline on the front page: the AI's one line when there is one, else the start of the message, cleaned. */
export function Gist({ t, max = 280, className }: { t: FeedThread; max?: number; className?: string }) {
  const gist = useGistLine(t.id, t.gist);
  const text = gist || readableExcerpt(t.latest_message?.text_body || "", max) || cleanSnippet(t.snippet);
  return text ? <p className={className}>{text}</p> : null;
}
