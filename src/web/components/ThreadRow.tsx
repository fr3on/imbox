import { BrandIcon } from "./BrandIcons";
import { memo } from "react";
import { Link } from "react-router-dom";
import { Paperclip, StickyNote, Undo2 } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { cn } from "@/lib/utils";
import { fmtTime, fmtFull } from "../lib/format";
import { cleanSnippet } from "../lib/snippet";
import { subjectParts } from "../lib/subject";
import { useAccount } from "../context/AccountContext";
import { Avatar, AvatarStack, AccountDot, AccountGlyph } from "./Avatar";
import { bucketName } from "./BulkBar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";

export type QuickAction = "reply_later" | "set_aside" | "bubble_up" | "trash" | "restore";

export { senderLine } from "../lib/senderLine";
import { senderLine } from "../lib/senderLine";

function Quick({ label, kbd, icon, onClick, active }: { label: string; kbd?: string; icon: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} className={cn("text-muted-foreground hover:text-foreground", active && "bg-accent text-foreground")}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Notion-dense thread row: 44px two-line (default) or 40px one-line (compact). */
/**
 * Memoised: see ThreadList, which keeps every callback it passes here referentially stable so that
 * a poll returning the same threads leaves the rows untouched.
 */
export const ThreadRow = memo(function ThreadRow({
  thread: t,
  selected,
  focused,
  onSelect,
  compact,
  showBucket,
  leaving,
  onQuickAction,
  quickActions = true,
}: {
  thread: ThreadSummary;
  selected: boolean;
  focused?: boolean;
  onSelect: (id: string, shift: boolean) => void;
  compact?: boolean;
  showBucket?: boolean;
  leaving?: boolean;
  onQuickAction?: (id: string, action: QuickAction) => void;
  quickActions?: boolean;
}) {
  const { multi, glyphFor, colorFor, accountFor } = useAccount();
  // "New" means you haven't opened it here yet — the same signal the sidebar counts and the Imbox's
  // "New for you" section use. Gmail's own unread flag also counts, but plenty of mail arrives already read.
  const unread = t.unread || !t.seen;
  const showQuick = quickActions && !!onQuickAction;
  const preview = cleanSnippet(t.snippet);
  const glyph = multi ? glyphFor(t.account_id) : "";
  const me = (accountFor(t.account_id)?.email ?? "").toLowerCase();
  const others = t.participants.filter((p) => p.email.toLowerCase() !== me);
  // Everyone else on the thread (a small stack next to the subject).
  const stack = others.length >= 2 ? [t.last_from, ...others.filter((p) => p.email.toLowerCase() !== t.last_from.email.toLowerCase())] : null;
  return (
    <div
      data-thread-id={t.id}
      data-row-id={t.id}
      className={cn(
        "group relative grid items-center gap-2.5 rounded-md px-2 scroll-mt-20 scroll-mb-4 transition-colors duration-100",
        compact ? "grid-cols-[20px_1fr_auto] h-11" : t.match?.excerpt || t.found_files?.length ? "grid-cols-[20px_1fr_auto] h-[76px]" : "grid-cols-[20px_1fr_auto] h-14",
        selected ? "bg-accent" : focused ? "bg-muted" : "hover:bg-muted",
        leaving && "row-out",
      )}
    >
      {focused && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-foreground" />}

      {/* avatar ↔ checkbox */}
      <div className="relative size-5">
        {!compact && (
          <div className={cn("transition-opacity duration-100", (selected || showQuick) && "group-hover:opacity-0", selected && "opacity-0")}>
            <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={20} />
          </div>
        )}
        <div className={cn("absolute inset-0 flex items-center justify-center transition-opacity duration-100", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}>
          <Checkbox checked={selected} onClick={(e) => onSelect(t.id, (e as React.MouseEvent).shiftKey)} aria-label="Select" className="size-4 rounded-[3px]" />
        </div>
      </div>

      <Link to={`/t/${t.id}`} className="min-w-0 block outline-none">
        {compact ? (
          <div className="flex items-center gap-1.5 min-w-0 leading-tight">
            {unread && <span className="size-1.5 rounded-full bg-foreground shrink-0" aria-label="Unread" />}
            {/* Subject leads, as in the two-line rows; unread is bold, read is muted. */}
            <span className={cn("truncate text-[13px] shrink-0 max-w-[55%]", unread ? "font-semibold text-foreground" : "font-normal text-muted-foreground")}>
              {t.subject || "(no subject)"}
            </span>
            {t.message_count > 1 && <span className="text-xs text-tertiary tnum shrink-0">{t.message_count}</span>}
            {glyph && <AccountGlyph glyph={glyph} label={accountFor(t.account_id)?.email} />}
            {t.bubbled && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">Bubbled up</Badge>}
            {t.imbox_hint && <Badge variant="outline" title={t.imbox_hint.reason} className="h-4 px-1 text-[10px] font-normal text-foreground">May need you</Badge>}
            {showBucket && t.bucket !== "imbox" && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">{bucketName(t.bucket)}</Badge>}
            <span className={cn("truncate text-[13px] min-w-0", unread ? "text-foreground" : "text-tertiary")}>
              {senderLine(t, me)}
              {preview && <span className={unread ? "text-foreground" : "text-tertiary"}> — {preview}</span>}
            </span>
          </div>
        ) : (
          <>
            {/* line 1: subject (+ participants) */}
            <div className="flex items-center gap-1.5 min-w-0 leading-tight">
              {unread && <span className="size-1.5 rounded-full bg-foreground shrink-0" aria-label="Unread" />}
              <span className={cn("truncate text-[13px]", unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
                {subjectParts(t.subject || "(no subject)").map((p, i) =>
                  p.code ? (
                    <span key={i} className="font-mono text-[11px] font-normal text-tertiary">{p.text}</span>
                  ) : (
                    <span key={i}>{p.text}</span>
                  ),
                )}
              </span>
              {stack && <AvatarStack people={stack} size={18} max={5} className="shrink-0" />}
              {t.message_count > 1 && <span className="text-xs text-tertiary tnum shrink-0">{t.message_count}</span>}
              {t.bubbled && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">Bubbled up</Badge>}
            {t.imbox_hint && <Badge variant="outline" title={t.imbox_hint.reason} className="h-4 px-1 text-[10px] font-normal text-foreground">May need you</Badge>}
              {showBucket && t.bucket !== "imbox" && <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">{bucketName(t.bucket)}</Badge>}
            </div>
            {/* line 2: who — snippet */}
            <div className="flex items-center gap-1.5 min-w-0 leading-tight mt-0.5">
              <span className={cn("truncate text-[13px] shrink-0 max-w-full sm:max-w-[45%]", unread ? "text-foreground" : "text-muted-foreground")}>{senderLine(t, me)}</span>
              {preview && !t.match?.excerpt && <span className={cn("hidden sm:inline truncate text-xs min-w-0", unread ? "text-foreground" : "text-muted-foreground")}>— {preview}</span>}
            </div>
            {/* line 3, in search only: where the words were found, and the text around them */}
            {(t.match?.excerpt || t.found_files?.length) && (
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-tight text-muted-foreground">
                {t.match?.excerpt && (
                  <>
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide">{t.match.why}</span>
                    <span className="min-w-0 flex-1 truncate" data-search-excerpt>{t.match.excerpt}</span>
                  </>
                )}
                {!t.match?.excerpt && <span className="flex-1" />}
                {t.found_files?.slice(0, 2).map((f) => (
                  <span key={f.id} data-no-highlight className="hidden shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-px sm:inline-flex" title={f.filename}>
                    <Paperclip className="size-3" aria-hidden="true" />
                    <span className="max-w-[9rem] truncate">{f.filename}</span>
                  </span>
                ))}
                {(t.found_files?.length ?? 0) > 2 && <span className="hidden shrink-0 sm:inline">+{(t.found_files?.length ?? 0) - 2}</span>}
              </div>
            )}
          </>
        )}
      </Link>

      {/* meta / quick actions */}
      <div className={cn("relative flex items-center justify-end gap-2 text-muted-foreground shrink-0 min-w-[56px]", showQuick && "group-hover:min-w-[116px] group-focus-within:min-w-[116px]")}>
        <div className={cn("flex items-center gap-2 transition-opacity duration-100", showQuick && "group-hover:opacity-0 group-focus-within:opacity-0")}>
          {multi && !compact && <AccountDot color={colorFor(t.account_id)} label={accountFor(t.account_id)?.email} />}
          {!compact && t.labels.slice(0, 2).map((l) => (
            <Badge key={l.id} variant="outline" className="hidden sm:inline-flex h-4 px-1.5 text-[10px] font-normal text-muted-foreground">{l.name}</Badge>
          ))}
          {t.note && (
            <Tooltip>
              <TooltipTrigger asChild><span className="flex"><StickyNote size={13} /></span></TooltipTrigger>
              <TooltipContent>Has a note</TooltipContent>
            </Tooltip>
          )}
          {t.trackers_blocked > 0 && (
            <Tooltip>
              <TooltipTrigger asChild><span className="flex"><BrandIcon name="let-in" size={13} /></span></TooltipTrigger>
              <TooltipContent>Blocked {t.trackers_blocked} spy tracker{t.trackers_blocked === 1 ? "" : "s"}</TooltipContent>
            </Tooltip>
          )}
          {t.has_attachments && <Paperclip size={13} />}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={cn("text-xs tnum whitespace-nowrap", unread ? "text-foreground" : "")}>{fmtTime(t.last_message_at)}</span>
            </TooltipTrigger>
            <TooltipContent>{fmtFull(t.last_message_at)}</TooltipContent>
          </Tooltip>
        </div>
        {showQuick && (
          <div className="absolute right-0 inset-y-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
            {t.bucket !== "trash" && (
              <>
                <Quick label="Reply later" kbd="l" icon={<BrandIcon name="reply-later" />} active={t.reply_later} onClick={() => onQuickAction!(t.id, "reply_later")} />
                <Quick label="Set aside" kbd="a" icon={<BrandIcon name="set-aside" />} active={t.set_aside} onClick={() => onQuickAction!(t.id, "set_aside")} />
                <Quick label="Bubble up" kbd="z" icon={<BrandIcon name="bubble-up" />} onClick={() => onQuickAction!(t.id, "bubble_up")} />
              </>
            )}
            {t.bucket === "trash" ? (
              <Quick label="Restore to the Imbox" icon={<Undo2 />} onClick={() => onQuickAction!(t.id, "restore")} />
            ) : (
              <Quick label="Trash" kbd="#" icon={<BrandIcon name="trash" />} onClick={() => onQuickAction!(t.id, "trash")} />
            )}
          </div>
        )}
      </div>
    </div>
  );
});
