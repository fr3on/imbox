import { useEffect, useState } from "react";
import { cleanSnippet } from "@/lib/snippet";
import { Recipients } from "@/components/Recipients";
import { PersonCard } from "@/components/PersonCard";
import { MessageSourceDialog, messageSourceUrl } from "@/components/MessageSourceDialog";
import { Link } from "react-router-dom";
import { ChevronsDownUp, Download, FileText, Forward, Mail, MoreHorizontal, Paperclip, Reply, ReplyAll, Printer, FileCode } from "lucide-react";
import type { Message } from "@shared/types";
import { cn } from "@/lib/utils";
import { HtmlBody } from "@/components/HtmlBody";
import { type ReplyMode } from "@/lib/reply";
import { Avatar } from "@/components/Avatar";
import { fmtFull, fmtTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AttachmentItem } from "./AttachmentItem";

export function MessageRow({ m, expanded, focused, index, onToggle, onReply, onClip, onMarkUnread, onPrint, isLast }: { m: Message; onPrint: (m: Message) => void; expanded: boolean; focused: boolean; index: number; onToggle: () => void; onReply: (mode: ReplyMode, m: Message) => void; onClip: (text: string) => void; onMarkUnread: () => void; isLast: boolean }) {
  const [plain, setPlain] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [mounted, setMounted] = useState(expanded);
  useEffect(() => {
    if (expanded) setMounted(true);
  }, [expanded]);
  const files = m.attachments.filter((a) => !a.is_inline);
  const who = m.is_from_me ? "You" : m.from.name || m.from.email;
  return (
    <article
      data-msg-index={index}
      className={cn("py-3 scroll-mt-20", (!expanded || focused) && "rounded-md px-2 -mx-2", !expanded && "cursor-pointer hover:bg-muted", focused && "ring-1 ring-ring")}
      onClick={!expanded ? onToggle : undefined}
    >
      <header className="flex items-start gap-2.5">
        {m.is_from_me ? (
          <Avatar email={m.from.email} name={m.from.name} src={m.from.avatar_url} size={24} strong={m.unread} className="mt-px" />
        ) : (
          <PersonCard person={m.from}>
            <Avatar email={m.from.email} name={m.from.name} src={m.from.avatar_url} size={24} strong={m.unread} className="mt-px" />
          </PersonCard>
        )}
        <div className="flex-1 min-w-0 leading-tight">
          <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
            {m.is_from_me ? (
              <span className="text-[13px] font-semibold text-foreground">You</span>
            ) : (
              <Link to={`/contacts/email/${encodeURIComponent(m.from.email)}?account=${encodeURIComponent(m.account_id)}&name=${encodeURIComponent(m.from.name ?? "")}`} className="text-[13px] font-semibold text-foreground hover:underline underline-offset-2 truncate" onClick={(e) => e.stopPropagation()}>
                {who}
              </Link>
            )}
            <span className="text-xs text-muted-foreground truncate">{m.from.email}</span>
            {m.unread && <span className="size-1.5 rounded-full bg-foreground self-center" aria-label="Unread" />}
          </div>
          <div className={cn("text-xs text-muted-foreground mt-0.5", expanded ? "leading-4" : "truncate")}>
            {expanded ? (
              <Recipients to={m.to} cc={m.cc} />
            ) : (
              cleanSnippet(m.snippet)
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 -mt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground tnum font-normal" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
                {fmtTime(m.date)}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{fmtFull(m.date)}</TooltipContent>
          </Tooltip>
          {expanded && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Reply" className="hidden sm:inline-flex text-muted-foreground" onClick={() => onReply("reply", m)}>
                    <Reply />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reply <Kbd className="ml-1">r</Kbd></TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="More" className="text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => onReply("reply", m)}><Reply /> Reply <DropdownMenuShortcut>r</DropdownMenuShortcut></DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onReply("replyAll", m)}><ReplyAll /> Reply all</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onReply("forward", m)}><Forward /> Forward <DropdownMenuShortcut>f</DropdownMenuShortcut></DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onMarkUnread}><Mail /> Mark unread</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPlain((p) => !p)}><FileText /> {plain ? "Rich text" : "Plain text"}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setSourceOpen(true)}><FileCode /> Show original</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onPrint(m)}><Printer /> Print</DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={messageSourceUrl(m.id, true)} download><Download /> Download .eml</a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {!isLast && <DropdownMenuItem onSelect={onToggle}><ChevronsDownUp /> Collapse</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>
      {expanded && mounted && (
        <div className="pl-[34px] pt-3">
          <HtmlBody html={m.html_body} text={m.text_body} trackers={m.trackers} sender={m.from.email} onClip={onClip} plain={plain} />
          {files.length > 0 && (
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <Paperclip size={12} /> {files.length} attachment{files.length === 1 ? "" : "s"}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {files.map((a) => (
                  <AttachmentItem key={a.id} a={a} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {sourceOpen && <MessageSourceDialog messageId={m.id} open={sourceOpen} onOpenChange={setSourceOpen} />}
    </article>
  );
}
