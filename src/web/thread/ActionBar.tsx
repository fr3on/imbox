import { BrandIcon } from "@/components/BrandIcons";
import * as React from "react";
import { useEffect, useRef } from "react";
import { printMessages } from "@/lib/printMessages";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Forward, GitMerge, Mail, MoreHorizontal, Pencil, ScanSearch, ScrollText, Reply, ReplyAll, CalendarPlus, StickyNote, X, Layers, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { assistant } from "@/lib/assistantStore";
import { useEventFromThread } from "@/api";
import { DateTimePicker } from "@/components/DatePicker";
import { CollectionMenuItems, LabelMenuItems } from "@/components/Pickers";
import { bucketName } from "@/components/BulkBar";
import { fmtRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useThreadSummary } from "@/components/AiReply";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ThreadDetail, } from "@shared/types";
import type { MainColumn } from "./layout";
import { Bar, MENU_GROUP, RailGroup, RailLabel, RailRow, RailSep, bucketIcon } from "./rail";
import type { OpenReply, ReplyState, Run } from "./types";
import { JevChecksDialog } from "./JevChecks";
import { useWorkflowFromThread } from "../components/WorkflowsSection/FromThread";

export function ActionBar({ t, col, reply, railOpen, setRailOpen, bubbleOpen, setBubbleOpen, openReply, toggleReplyLater, toggleSetAside, run, summ, toEvent, setNoteOpen, setSubjectDraft, setRenaming, setMergeOpen, setConfirmDelete }: { t: ThreadDetail; col: MainColumn | null; reply: ReplyState | null; railOpen: boolean; setRailOpen: (v: boolean) => void; bubbleOpen: boolean; setBubbleOpen: (v: boolean) => void; openReply: OpenReply; toggleReplyLater: () => void; toggleSetAside: () => void; run: Run; summ: ReturnType<typeof useThreadSummary>; toEvent: ReturnType<typeof useEventFromThread>; setNoteOpen: (v: boolean) => void; setSubjectDraft: (v: string) => void; setRenaming: (v: boolean) => void; setMergeOpen: (v: boolean) => void; setConfirmDelete: (v: boolean) => void }) {
  const nav = useNavigate();
  const [checksOpen, setChecksOpen] = React.useState(false);
  const workflow = useWorkflowFromThread(t);
  // With room in the margin beside the message, the actions sit there as a slim rail; otherwise they stay in the bottom bar.
  const COLUMN_MAX = 1024;
  const gutter = col ? (col.width - Math.min(COLUMN_MAX, col.width)) / 2 : 0;
  const rail = !!col && gutter >= 76;
  const railLeft = col ? col.left + gutter + 8 - 60 : 0;
  const Grp = (rail ? RailGroup : ButtonGroup) as React.ElementType;
  const railRef = useRef<HTMLDivElement>(null);
  const closeThen = (fn: () => void) => () => {
    setRailOpen(false);
    fn();
  };
  useEffect(() => {
    if (!railOpen) return;
    const away = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      // Clicks inside the rail, and inside a menu or popover it opened, are not "away".
      if (railRef.current?.contains(el) || el.closest('[role="menu"],[role="dialog"],[data-slot="popover-content"]')) return;
      setRailOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [railOpen, setRailOpen]);
  return (
    <>
      {/* Docked action bar (hidden while the reply composer is open; it has its own Send) */}
      <div
        className={cn("fixed z-40 flex pointer-events-none", rail ? "top-40 justify-start" : "bottom-4 justify-center px-3", reply && "hidden")}
        style={rail ? { left: railLeft } : col ? { left: col.left, width: col.width } : { left: 0, right: 0 }}
      >
        <div
          ref={railRef}
          data-compact-bar={col?.compact || undefined}
          className={cn(
            "pointer-events-auto flex gap-1 bg-background/90 backdrop-blur ring-1 ring-border",
            rail ? "flex-col rounded-xl p-1" : "items-center rounded-lg shadow-md p-1 max-w-full overflow-x-auto",
            rail && (railOpen ? "w-60 max-h-[calc(100vh-11rem)] gap-0 overflow-y-auto overscroll-contain bg-background shadow-md" : "items-center"),
          )}
        >
          {rail && railOpen ? (
            <>
              <div className="flex items-center px-2.5 pb-0.5 pt-1 text-[11px] font-medium text-muted-foreground/80">
                Actions
                <button type="button" aria-label="Fold the actions away" className="ml-auto flex items-center gap-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring" onClick={() => setRailOpen(false)}>
                  <Kbd>esc</Kbd>
                </button>
              </div>
              <RailRow primary icon={<Reply />} label="Reply" kbd="r" onClick={closeThen(() => openReply("reply"))} />
              <RailRow icon={<ReplyAll />} label="Reply all" onClick={closeThen(() => openReply("replyAll"))} />
              <RailRow icon={<Forward />} label="Forward" kbd="f" onClick={closeThen(() => openReply("forward"))} />
              <RailSep />
              <RailRow icon={<BrandIcon name="reply-later" />} label={t.reply_later ? "Remove from Reply later" : "Reply later"} kbd="l" active={!!t.reply_later} onClick={closeThen(toggleReplyLater)} />
              <RailRow icon={<BrandIcon name="set-aside" />} label={t.set_aside ? "Remove from Set aside" : "Set aside"} kbd="a" active={!!t.set_aside} onClick={closeThen(toggleSetAside)} />
              <Popover open={bubbleOpen} onOpenChange={setBubbleOpen}>
                <PopoverTrigger asChild>
                  <RailRow icon={<BrandIcon name="bubble-up" />} label="Bubble up" kbd="z" active={!!t.bubble_up_at} />
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-auto p-1">
                  <div className="px-2 h-7 flex items-center text-xs font-medium text-muted-foreground">Bubble up · out of sight until then</div>
                  <DateTimePicker embedded onPick={(at) => { setBubbleOpen(false); setRailOpen(false); run({ action: "bubble_up", at }, `Will bubble up ${fmtRelative(at)}`); }} />
                  {t.bubble_up_at && (
                    <>
                      <ButtonGroupSeparator orientation="horizontal" className="my-1" />
                      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => { setBubbleOpen(false); setRailOpen(false); run({ action: "bubble_up", at: null }, "Bubble up cancelled"); }}>
                        <X /> Cancel bubble up
                      </Button>
                    </>
                  )}
                </PopoverContent>
              </Popover>
              <RailRow icon={<BrandIcon name="assistant" />} label="Ask the assistant" kbd="⌘J" onClick={closeThen(() => assistant.open())} />

              <RailSep />
              <RailLabel>Move to</RailLabel>
              {(["imbox", "feed", "paper_trail"] as const).map((b) => (
                <RailRow key={b} icon={bucketIcon[b]} label={bucketName(b)} checked={t.bucket === b} onClick={closeThen(() => b !== t.bucket && run({ action: "move", bucket: b }, `Moved to ${bucketName(b)}`))} />
              ))}

              <RailLabel>Organise</RailLabel>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <RailRow icon={<BrandIcon name="labels" />} label="Labels" chevron />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="w-52">
                  <LabelMenuItems current={new Set(t.labels.map((l) => l.id))} onToggle={(lid, on) => run({ action: "labels", ...(on ? { add: [lid] } : { remove: [lid] }) })} onManage={() => nav("/labels")} />
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <RailRow icon={<BrandIcon name="collection" />} label="Collections" chevron />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="w-52">
                  <CollectionMenuItems current={new Set(t.collections.map((c) => c.id))} onToggle={(cid, on) => run({ action: "collections", ...(on ? { add: [cid] } : { remove: [cid] }) })} onManage={() => nav("/collections")} />
                </DropdownMenuContent>
              </DropdownMenu>
              <RailRow icon={<StickyNote />} label={t.note ? "Edit note" : "Stick a note on it"} kbd="n" onClick={closeThen(() => setNoteOpen(true))} />
              <RailRow icon={<Pencil />} label="Rename subject" onClick={closeThen(() => { setSubjectDraft(t.subject); setRenaming(true); })} />

              <RailLabel>Do more</RailLabel>
              <RailRow icon={<BrandIcon name="assistant" />} label={summ.pending ? "Summarising…" : "Summarise with AI"} disabled={summ.pending} onClick={closeThen(() => summ.run())} />
              <RailRow
                icon={<CalendarPlus />}
                label="Create event"
                disabled={toEvent.isPending}
                onClick={closeThen(async () => {
                  try {
                    const prefill = await toEvent.mutateAsync(t.id);
                    nav("/calendar", { state: { newEvent: prefill } });
                  } catch {
                    /* the calendar page will still open empty if this fails */
                  }
                })}
              />
              <RailRow icon={<ScanSearch />} label="Check with Jev" onClick={closeThen(() => setChecksOpen(true))} />
              <RailRow icon={<BrandIcon name="workflows" />} label="Create a workflow" disabled={workflow.pending} onClick={closeThen(() => workflow.run())} />
              <RailRow icon={<ScrollText />} label="What happened to this" onClick={closeThen(() => nav(`/logs?thread=${t.id}`))} />
              <RailRow icon={<Printer />} label="Print thread" onClick={closeThen(() => printMessages(t.subject, t.messages))} />
              <RailRow icon={<GitMerge />} label="Merge with…" onClick={closeThen(() => setMergeOpen(true))} />
              {(t.bucket === "imbox" || t.bucket === "paper_trail") && (
                <RailRow icon={<Layers />} label={t.sender_bundled ? "Unbundle this sender" : "Bundle up this sender"} onClick={closeThen(() => run({ action: "bundle", on: !t.sender_bundled }, t.sender_bundled ? "Unbundled sender" : "Bundled up sender"))} />
              )}

              <RailSep />
              <RailRow icon={<Mail />} label="Mark unread" kbd="u" onClick={closeThen(() => run({ action: "mark_unread" }, "Marked unread"))} />
              {t.bucket !== "trash" && <RailRow destructive icon={<BrandIcon name="trash" />} label="Move to trash" kbd="#" onClick={closeThen(() => { run({ action: "move", bucket: "trash" }, "Moved to trash"); nav(-1); })} />}
              <RailRow destructive icon={<X />} label="Delete forever…" onClick={closeThen(() => setConfirmDelete(true))} />
            </>
          ) : (
          <>
          <Grp>
            {rail ? (
              <Bar label="Reply" kbd="r" side="right"><Button size="icon" aria-label="Reply" onClick={() => openReply("reply")}><Reply /></Button></Bar>
            ) : (
              <Button size="sm" onClick={() => openReply("reply")}><Reply /> Reply</Button>
            )}
            <Bar label="Reply all" side={rail ? "right" : undefined}><Button size={rail ? "icon" : "sm"} variant={rail ? "ghost" : "outline"} aria-label="Reply all" onClick={() => openReply("replyAll")}><ReplyAll />{!rail && <span className="hidden sm:inline">All</span>}</Button></Bar>
            <Bar label="Forward" kbd="f" side={rail ? "right" : undefined}><Button size={rail ? "icon" : "sm"} variant={rail ? "ghost" : "outline"} aria-label="Forward" onClick={() => openReply("forward")}><Forward />{!rail && <span className="hidden sm:inline">Forward</span>}</Button></Bar>
          </Grp>
          {rail && <div className="my-0.5 h-px w-5 bg-border" />}
          <Grp>
            <Bar label={t.reply_later ? "Remove from Reply Later" : "Reply later"} kbd="l" side={rail ? "right" : undefined}>
              <Button size={rail ? "icon" : "sm"} variant={rail ? "ghost" : "outline"} aria-label="Reply later" onClick={toggleReplyLater} className={cn(t.reply_later && "bg-muted")}><BrandIcon name="reply-later" />{!rail && <span className="hidden sm:inline">Reply later</span>}</Button>
            </Bar>
            <Bar label={t.set_aside ? "Remove from Set Aside" : "Set aside"} kbd="a" side={rail ? "right" : undefined}>
              <Button size={rail ? "icon" : "sm"} variant={rail ? "ghost" : "outline"} aria-label="Set aside" onClick={toggleSetAside} className={cn(t.set_aside && "bg-muted")}><BrandIcon name="set-aside" />{!rail && <span className="hidden sm:inline">Set aside</span>}</Button>
            </Bar>
            <Popover open={bubbleOpen} onOpenChange={setBubbleOpen}>
              <Bar label="Bubble up" kbd="z" side={rail ? "right" : undefined}>
                <PopoverTrigger asChild>
                  <Button size={rail ? "icon" : "sm"} variant={rail ? "ghost" : "outline"} aria-label="Bubble up" className={cn(t.bubble_up_at && "bg-muted")}><BrandIcon name="bubble-up" />{!rail && <span className="hidden sm:inline">Bubble up</span>}</Button>
                </PopoverTrigger>
              </Bar>
              <PopoverContent side={rail ? "right" : "top"} align={rail ? "start" : "center"} className="w-auto p-1">
                <div className="px-2 h-7 flex items-center text-xs font-medium text-muted-foreground">Bubble up · out of sight until then</div>
                <DateTimePicker embedded onPick={(at) => { setBubbleOpen(false); run({ action: "bubble_up", at }, `Will bubble up ${fmtRelative(at)}`); }} />
                {t.bubble_up_at && (
                  <>
                    <ButtonGroupSeparator orientation="horizontal" className="my-1" />
                    <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => { setBubbleOpen(false); run({ action: "bubble_up", at: null }, "Bubble up cancelled"); }}>
                      <X /> Cancel bubble up
                    </Button>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </Grp>
          {rail && <div className="my-0.5 h-px w-5 bg-border" />}
          <Bar label="Ask the assistant about this thread" kbd="⌘J" side={rail ? "right" : undefined}>
            <Button size={rail ? "icon" : "sm"} variant="ghost" aria-label="Ask AI" className="text-muted-foreground" onClick={() => assistant.open()}>
              <BrandIcon name="assistant" />{!rail && <span className="hidden sm:inline">Ask AI</span>}
            </Button>
          </Bar>
          {rail ? (
            <Bar label="More" side="right">
              <Button size="icon" variant="ghost" aria-label="More" aria-expanded={railOpen} className="text-muted-foreground" onClick={() => setRailOpen(true)}><MoreHorizontal /></Button>
            </Bar>
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="More" className="text-muted-foreground"><MoreHorizontal /><span className="hidden sm:inline">More</span><ChevronDown className="size-3!" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="max-h-[min(72vh,36rem)] w-60 overflow-y-auto">
              <DropdownMenuLabel className={MENU_GROUP}>Move to</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={t.bucket} onValueChange={(b) => b !== t.bucket && run({ action: "move", bucket: b as "imbox" | "feed" | "paper_trail" }, `Moved to ${bucketName(b)}`)}>
                {(["imbox", "feed", "paper_trail"] as const).map((b) => (
                  <DropdownMenuRadioItem key={b} value={b}>
                    {bucketIcon[b]} {bucketName(b)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className={MENU_GROUP}>Organise</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><BrandIcon name="labels" /> Labels</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <LabelMenuItems current={new Set(t.labels.map((l) => l.id))} onToggle={(lid, on) => run({ action: "labels", ...(on ? { add: [lid] } : { remove: [lid] }) })} onManage={() => nav("/labels")} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><BrandIcon name="collection" /> Collections</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <CollectionMenuItems current={new Set(t.collections.map((c) => c.id))} onToggle={(cid, on) => run({ action: "collections", ...(on ? { add: [cid] } : { remove: [cid] }) })} onManage={() => nav("/collections")} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => setNoteOpen(true)}><StickyNote /> {t.note ? "Edit note" : "Stick a note on it"} <DropdownMenuShortcut>n</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setSubjectDraft(t.subject); setRenaming(true); }}><Pencil /> Rename subject</DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className={MENU_GROUP}>Do more</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => summ.run()} disabled={summ.pending}><BrandIcon name="assistant" /> {summ.pending ? "Summarising…" : "Summarise with AI"}</DropdownMenuItem>
              <DropdownMenuItem
                disabled={toEvent.isPending}
                onSelect={async () => {
                  try {
                    const prefill = await toEvent.mutateAsync(t.id);
                    nav("/calendar", { state: { newEvent: prefill } });
                  } catch {
                    /* the calendar page will still open empty if this fails */
                  }
                }}
              >
                <CalendarPlus /> Create event
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setChecksOpen(true)}><ScanSearch /> Check with Jev</DropdownMenuItem>
              <DropdownMenuItem disabled={workflow.pending} onSelect={() => workflow.run()}><BrandIcon name="workflows" /> Create a workflow…</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => printMessages(t.subject, t.messages)}><Printer /> Print thread</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => nav(`/logs?thread=${t.id}`)}><ScrollText /> What happened to this</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMergeOpen(true)}><GitMerge /> Merge with…</DropdownMenuItem>
              {(t.bucket === "imbox" || t.bucket === "paper_trail") && (
                <DropdownMenuItem onSelect={() => run({ action: "bundle", on: !t.sender_bundled }, t.sender_bundled ? "Unbundled sender" : "Bundled up sender")}>
                  <Layers /> {t.sender_bundled ? "Unbundle this sender" : "Bundle up this sender"}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => run({ action: "mark_unread" }, "Marked unread")}><Mail /> Mark unread <DropdownMenuShortcut>u</DropdownMenuShortcut></DropdownMenuItem>

              <DropdownMenuSeparator />
              {t.bucket !== "trash" && (
                <DropdownMenuItem variant="destructive" onSelect={() => { run({ action: "move", bucket: "trash" }, "Moved to trash"); nav(-1); }}><BrandIcon name="trash" /> Move to trash <DropdownMenuShortcut>#</DropdownMenuShortcut></DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><X /> Delete forever…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
          </>
          )}
        </div>
      </div>
      <JevChecksDialog threadId={t.id} open={checksOpen} onOpenChange={setChecksOpen} />
    </>
  );
}
