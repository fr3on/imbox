import { BrandIcon } from "@/components/BrandIcons";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Pencil, } from "lucide-react";
import { useAccount } from "@/context/AccountContext";
import { LabelChip } from "@/components/Pickers";
import { bucketName } from "@/components/BulkBar";
import { AvatarStack, AccountGlyph } from "@/components/Avatar";
import { fmtRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Account, ThreadDetail, } from "@shared/types";
import type { Neighbours } from "@/lib/threadNav";
import { bucketIcon } from "./rail";
import type { Run } from "./types";
import { useStopWaiting } from "./stopWaiting";

export function ThreadHeader({ t, neighbours, names, account, renamed, renaming, setRenaming, subjectDraft, setSubjectDraft, saveRename, titleRef, run }: { t: ThreadDetail; neighbours: Neighbours | null; names: string[]; account: Account | undefined; renamed: boolean; renaming: boolean; setRenaming: (v: boolean) => void; subjectDraft: string; setSubjectDraft: (v: string) => void; saveRename: () => void; titleRef: React.RefObject<HTMLDivElement | null>; run: Run }) {
  const nav = useNavigate();
  const { glyphFor, multi } = useAccount();
  const { waiting, stop: stopWaiting } = useStopWaiting(t);
  const meta = (
    <>
      {t.bucket !== "imbox" && t.bucket !== "trash" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`In ${bucketName(t.bucket)}. Move it somewhere else`}
              className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&>svg]:size-3"
            >
              {t.bucket in bucketIcon ? bucketIcon[t.bucket as keyof typeof bucketIcon] : null}
              {bucketName(t.bucket)}
              <ChevronDown />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["imbox", "feed", "paper_trail"] as const).map((b) => (
              <DropdownMenuItem key={b} disabled={b === t.bucket} onSelect={() => run({ action: "move", bucket: b }, `Moved to ${bucketName(b)}`)}>
                {bucketIcon[b]} {bucketName(b)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {t.bucket === "trash" && <Badge variant="outline" className="font-normal text-muted-foreground"><BrandIcon name="trash" />Trash</Badge>}
      {waiting && (
        <button
          type="button"
          onClick={stopWaiting}
          className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&>svg]:size-3"
        >
          <Check /> Not waiting
        </button>
      )}
      {t.reply_later && <Badge variant="secondary" className="font-normal"><BrandIcon name="reply-later" />Reply later</Badge>}
      {t.set_aside && <Badge variant="secondary" className="font-normal"><BrandIcon name="set-aside" />Set aside</Badge>}
      {t.bubble_up_at && <Badge variant="secondary" className="font-normal"><BrandIcon name="bubble-up" />Bubbles up {fmtRelative(t.bubble_up_at)}</Badge>}
    </>
  );
  return (
    <>
      {/* Top row */}
      <div className="flex items-center gap-2 mb-4 -ml-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => nav(-1)}>
          <ArrowLeft /> Back <Kbd>esc</Kbd>
        </Button>
        {neighbours && (
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Previous thread" disabled={!neighbours.prev} className="text-muted-foreground" onClick={() => neighbours.prev && nav(`/t/${neighbours.prev}`, { replace: true })}>
                  <ChevronUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous thread</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Next thread" disabled={!neighbours.next} className="text-muted-foreground" onClick={() => neighbours.next && nav(`/t/${neighbours.next}`, { replace: true })}>
                  <ChevronDown />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next thread</TooltipContent>
            </Tooltip>
            <span className="ml-1 text-xs text-tertiary tnum">{neighbours.position} of {neighbours.total}</span>
          </div>
        )}
        <span className="flex-1" />
        <div className="flex items-center gap-1.5 flex-wrap justify-end">{meta}</div>
      </div>

      {/* Title */}
      <div ref={titleRef}>
      {renaming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveRename();
          }}
        >
          <input
            autoFocus
            className="w-full bg-transparent outline-none text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-foreground border-b border-ring pb-1"
            value={subjectDraft}
            onChange={(e) => setSubjectDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
            placeholder={t.original_subject}
          />
          <div className="flex items-center gap-1 mt-2">
            <Button type="submit" size="sm"><Check /> Save</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setRenaming(false)}>Cancel</Button>
            <span className="text-xs text-muted-foreground ml-2">Only you see this name.</span>
          </div>
        </form>
      ) : (
        <h1 className="group flex items-start gap-1 min-w-0 text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-foreground">
          <span className="min-w-0 break-words">{t.subject || <span className="text-tertiary">(no subject)</span>}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Rename subject"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 mt-1 shrink-0 text-muted-foreground"
            onClick={() => {
              setSubjectDraft(t.subject);
              setRenaming(true);
            }}
          >
            <Pencil />
          </Button>
        </h1>
      )}
      </div>
      {renamed && !renaming && <div className="text-xs text-muted-foreground mt-1">originally “{t.original_subject}”</div>}

      {/* Meta row */}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap min-w-0 text-[13px]">
        <AvatarStack people={t.participants} size={24} max={4} />
        <span className="text-foreground/80 truncate min-w-0" title={names.join(", ")}>{names.slice(0, 2).join(", ")}{names.length > 2 ? ` +${names.length - 2}` : ""}</span>
        <span className="text-muted-foreground tnum">· {t.message_count} message{t.message_count === 1 ? "" : "s"}</span>
        {multi && account && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <AccountGlyph glyph={glyphFor(account.id)} /> {account.email}
          </span>
        )}
        {t.labels.map((l) => (
          <Link key={l.id} to={`/labels/${l.id}`} className="hover:opacity-80">
            <LabelChip label={l} />
          </Link>
        ))}
        {t.collections.map((c) => (
          <Link key={c.id} to={`/collections/${c.id}`} className="hover:opacity-80">
            <Badge variant="outline" className="font-normal text-foreground/90"><BrandIcon name="collection" />{c.name}</Badge>
          </Link>
        ))}
      </div>
    </>
  );
}
