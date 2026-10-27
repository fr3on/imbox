import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { ChevronDown, FolderPlus, GitMerge, Mail, MailOpen, MoveRight, Undo2, X, Loader2 } from "lucide-react";
import type { Bucket, ThreadSummary } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { api, invalidateMail, useBulkAction, type ThreadAction } from "../api";
import { useToast } from "./Toast";
import { DateTimePicker } from "./DatePicker";
import { CollectionPicker, LabelPicker } from "./Pickers";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function bucketName(b: Bucket | string): string {
  return { imbox: "Imbox", feed: "Feed", paper_trail: "Receipts", updates: "Feed", trash: "Trash", screener: "Screener", screened_out: "Screened out" }[b] ?? b;
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

/** One action: an icon with its name beside it once there is room, and its shortcut in the tooltip. */
function Act({ label, kbd, icon, onClick, disabled, danger, iconOnly }: { label: string; kbd?: string; icon: React.ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; iconOnly?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn("shrink-0 gap-1.5 text-muted-foreground hover:text-foreground", danger && "hover:bg-destructive/10 hover:text-destructive")}
        >
          {icon}
          {!iconOnly && <span className="hidden lg:inline">{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The toolbar that appears while threads are selected: what to do with them, grouped by kind, with the count and a way out. */
export function BulkBar({
  selected,
  threads,
  onClear,
  onAct,
  onSelectAll,
  inTrash,
}: {
  selected: Set<string>;
  threads: ThreadSummary[];
  onClear: () => void;
  /** Select every thread in the list; offered while only some are selected. */
  onSelectAll?: () => void;
  onAct?: (a: ThreadAction, msg?: string, removes?: boolean) => void;
  /** These threads are in the trash: the choices are to bring them back or delete them for good. */
  inTrash?: boolean;
}) {
  const ids = [...selected];
  const bulk = useBulkAction();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [bubble, setBubble] = useState(false);
  const [labels, setLabels] = useState(false);
  const [collect, setCollect] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sel = threads.filter((t) => selected.has(t.id));
  const allRead = sel.every((t) => !t.unread);
  const commonLabels = new Set(sel.length ? sel[0].labels.map((l) => l.id).filter((id) => sel.every((t) => t.labels.some((l) => l.id === id))) : []);

  const run = (a: ThreadAction, msg?: string, removes = true) => {
    if (onAct) return onAct(a, msg, removes);
    bulk.mutate({ thread_ids: ids, ...a }, {
      onSuccess: () => msg && toast(msg, { kind: "success" }),
      onError: (e) => toast((e as Error).message, { kind: "error" }),
    });
    onClear();
  };

  const merge = async () => {
    if (ids.length < 2) return;
    setBusy(true);
    try {
      const sorted = [...sel].sort((a, b) => b.last_message_at - a.last_message_at);
      const target = sorted[0];
      await api.post(`/api/threads/${target.id}/actions`, { action: "merge", thread_ids: sorted.slice(1).map((t) => t.id) });
      invalidateMail(qc);
      toast(`Merged ${ids.length} threads`, { kind: "success" });
      onClear();
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const moveMenu = (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"><MoveRight /> Move</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {([["imbox", <BrandIcon name="imbox" key="i" />], ["feed", <BrandIcon name="feed" key="f" />]] as [Bucket, React.ReactNode][]).map(([b, icon]) => (
            <DropdownMenuItem key={b} onClick={() => run({ action: "move", bucket: b }, `Moved to ${bucketName(b)}`)}>
              {icon}
              {bucketName(b)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
    </DropdownMenu>
  );
  const moreToSelect = threads.length > ids.length;
  return (
    <div
      role="toolbar"
      aria-label={`Actions for ${ids.length} selected`}
      className="sticky top-[var(--shell-header-h,7.5rem)] z-20 mb-2 flex flex-wrap items-center gap-0.5 rounded-xl border border-border/70 bg-card/95 px-2 py-1.5 backdrop-blur animate-in fade-in-0 slide-in-from-top-1 duration-150"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Clear selection <Kbd className="ml-1">esc</Kbd>
        </TooltipContent>
      </Tooltip>
      <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-foreground px-2 text-xs font-medium text-background tnum">{ids.length} selected</span>
      {onSelectAll && moreToSelect && (
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden" onClick={onSelectAll}>
          Select all {threads.length}
        </Button>
      )}
      <Divider />
      {inTrash ? (
        <>
          <Act label="Restore to the Imbox" icon={<Undo2 />} onClick={() => run({ action: "move", bucket: "imbox" }, "Restored to the Imbox")} />
          <Act label={allRead ? "Mark unread" : "Mark read"} kbd="u" icon={allRead ? <Mail /> : <MailOpen />} onClick={() => run({ action: allRead ? "mark_unread" : "mark_read" }, undefined, false)} />
          {moveMenu}
        </>
      ) : (
        <>
      <Act label="Reply later" kbd="l" icon={<BrandIcon name="reply-later" />} onClick={() => run({ action: "reply_later", on: true }, "Added to Reply Later")} />
      <Act label="Set aside" kbd="a" icon={<BrandIcon name="set-aside" />} onClick={() => run({ action: "set_aside", on: true }, "Set aside")} />
      <Popover open={bubble} onOpenChange={setBubble}>
        <PopoverTrigger asChild>
          <span className="shrink-0"><Act label="Bubble up" kbd="z" icon={<BrandIcon name="bubble-up" />} iconOnly /></span>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="center" className="w-auto p-0">
          <DateTimePicker onPick={(at) => { setBubble(false); run({ action: "bubble_up", at }, "Will bubble up later"); }} onCancel={() => setBubble(false)} />
        </PopoverContent>
      </Popover>
      <Act label={allRead ? "Mark unread" : "Mark read"} kbd="u" icon={allRead ? <Mail /> : <MailOpen />} iconOnly onClick={() => run({ action: allRead ? "mark_unread" : "mark_read" }, undefined, false)} />
      <Divider />
      {/* Move, Label, Collect and Merge share one menu, so the bar fits at any width and nothing scrolls. Label and Collect open their pickers over it. */}
      <Popover open={labels || collect} onOpenChange={(o) => { if (!o) { setLabels(false); setCollect(false); } }}>
        <PopoverAnchor asChild>
          <span className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
                  Organize <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="center" className="w-52">
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><MoveRight /> Move to</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {([["imbox", <BrandIcon name="imbox" key="i" />], ["feed", <BrandIcon name="feed" key="f" />]] as [Bucket, React.ReactNode][]).map(([bk, icon]) => (
                      <DropdownMenuItem key={bk} onClick={() => run({ action: "move", bucket: bk }, `Moved to ${bucketName(bk)}`)}>
                        {icon}
                        {bucketName(bk)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onSelect={() => setLabels(true)}><BrandIcon name="labels" /> Label…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCollect(true)}><FolderPlus /> Add to collection…</DropdownMenuItem>
                {ids.length >= 2 && (
                  <DropdownMenuItem disabled={busy} onSelect={merge}>
                    {busy ? <Loader2 className="animate-spin" /> : <GitMerge />} Merge {ids.length} threads
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </PopoverAnchor>
        <PopoverContent side="bottom" align="center" className="w-auto p-0">
          {labels && <LabelPicker current={commonLabels} onToggle={(id, on) => bulk.mutate({ thread_ids: ids, action: "labels", ...(on ? { add: [id] } : { remove: [id] }) })} onClose={() => setLabels(false)} />}
          {collect && <CollectionPicker current={new Set()} onToggle={(id, on) => bulk.mutate({ thread_ids: ids, action: "collections", ...(on ? { add: [id] } : { remove: [id] }) })} onClose={() => setCollect(false)} />}
        </PopoverContent>
      </Popover>
        </>
      )}
      <span className="min-w-2 flex-1" />
      <Divider />
      {inTrash ? (
        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
          <BrandIcon name="trash" /> Delete forever
        </Button>
      ) : (
        <Act label="Trash" kbd="#" icon={<BrandIcon name="trash" />} danger iconOnly onClick={() => run({ action: "move", bucket: "trash" }, "Moved to trash")} />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {ids.length === 1 ? "this thread" : `these ${ids.length} threads`} forever?</AlertDialogTitle>
            <AlertDialogDescription>They will be removed here and from your mailbox. There is no undo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {ids.length === 1 ? "it" : "them"}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run({ action: "delete" }, ids.length === 1 ? "Deleted" : `Deleted ${ids.length} threads`)}>Delete forever</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
