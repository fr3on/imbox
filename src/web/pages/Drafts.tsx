import { BrandIcon } from "../components/BrandIcons";
import { useMemo, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { Draft } from "@shared/types";
import { useDraftMutations, useDrafts } from "../api";
import { useAccount } from "../context/AccountContext";
import { useCompose } from "../context/ComposeContext";
import { fmtFull, fmtTime } from "../lib/format";
import { Avatar, AccountGlyph } from "../components/Avatar";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useItemCursor } from "../lib/cardKeys";
import { draftPreview as preview, groupDraftsByPerson, type DraftPerson } from "../lib/draftPeople";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/** The hover actions for one draft: cancel a scheduled send, or delete a draft. */
function DraftActions({ d, onCancel, onDelete }: { d: Draft; onCancel: () => void; onDelete: () => void }) {
  return d.status === "scheduled" ? (
    <Button variant="outline" size="xs" onClick={onCancel}>
      <X /> Cancel
    </Button>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Delete draft" onClick={onDelete}>
          <BrandIcon name="trash" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Delete draft</TooltipContent>
    </Tooltip>
  );
}

function StatusBadge({ d }: { d: Draft }) {
  if (d.status === "failed") return <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">Failed</Badge>;
  if (d.status === "sending") return <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">Sending</Badge>;
  return null;
}

/** When a draft was last touched, or when a scheduled one goes out. */
function When({ d, mode }: { d: Draft; mode: "draft" | "scheduled" }) {
  return mode === "scheduled" && d.send_at ? (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      <BrandIcon name="scheduled" /> {fmtFull(d.send_at)}
    </Badge>
  ) : (
    <span className="text-xs tnum">{fmtTime(d.updated_at)}</span>
  );
}

/** One of several drafts for the same person, shown once that person is open. */
function DraftLine({ d, mode, onOpen, onCancel, onDelete }: { d: Draft; mode: "draft" | "scheduled"; onOpen: () => void; onCancel: () => void; onDelete: () => void }) {
  const snippet = preview(d.body_html);
  return (
    <div className="group flex items-center gap-3 rounded-md py-1.5 pl-[52px] pr-2 hover:bg-muted">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none" onClick={onOpen}>
        <span className="shrink-0 max-w-[55%] truncate text-[13px] font-medium">{d.subject || "(no subject)"}</span>
        {snippet && <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">— {snippet}</span>}
        <StatusBadge d={d} />
        {d.status === "failed" && d.error && <span className="truncate text-xs text-muted-foreground">· {d.error}</span>}
      </button>
      <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <span className="group-hover:hidden"><When d={d} mode={mode} /></span>
        <span className="hidden items-center gap-0.5 group-hover:flex"><DraftActions d={d} onCancel={onCancel} onDelete={onDelete} /></span>
      </div>
    </div>
  );
}

/**
 * A person and what you are writing to them. With one draft, a click opens it; with several, a click opens the list of them.
 */
function PersonCard({ g, mode, focused, open, onToggle, onOpenDraft, onCancel, onDelete }: { g: DraftPerson; mode: "draft" | "scheduled"; focused?: boolean; open: boolean; onToggle: () => void; onOpenDraft: (d: Draft) => void; onCancel: (d: Draft) => void; onDelete: (d: Draft) => void }) {
  const { multi, glyphFor, accountFor } = useAccount();
  const latest = g.drafts[0];
  const single = g.drafts.length === 1;
  const snippet = preview(latest.body_html);
  const failed = g.drafts.filter((d) => d.status === "failed").length;
  const name = g.person ? g.person.name || g.person.email : null;
  return (
    <div className={cn("group/card scroll-mt-20 border-b border-border/60 last:border-0", focused && "bg-muted/60")}>
      <div className={cn("relative flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted", focused && "bg-muted")}>
        {focused && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-foreground" />}
        <button type="button" aria-expanded={single ? undefined : open} className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none" onClick={() => (single ? onOpenDraft(latest) : onToggle())}>
          {g.person ? <Avatar email={g.person.email} name={g.person.name} src={g.person.avatar_url} size={36} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><BrandIcon name="write" size={15} /></span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[14px] font-semibold">{name ?? <span className="text-muted-foreground">No recipients yet</span>}</span>
              {g.others > 0 && <span className="shrink-0 text-xs text-muted-foreground">+{g.others}</span>}
              {multi && <AccountGlyph glyph={glyphFor(latest.account_id)} label={accountFor(latest.account_id)?.email} />}
              {!single && <span className="shrink-0 rounded-full border border-border px-2 text-[11px] text-foreground">{g.drafts.length} {mode === "scheduled" ? "scheduled" : "drafts"}</span>}
              {failed > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{failed} failed</span>}
              {single && <StatusBadge d={latest} />}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
              <span className="shrink-0 max-w-[55%] truncate text-foreground/80">{latest.subject || "(no subject)"}</span>
              {snippet && <span className="hidden min-w-0 truncate sm:inline">— {snippet}</span>}
              {single && latest.status === "failed" && latest.error && <span className="truncate">· {latest.error}</span>}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className={cn(single && "group-hover/card:hidden")}><When d={latest} mode={mode} /></span>
          {single && <span className="hidden items-center gap-0.5 group-hover/card:flex"><DraftActions d={latest} onCancel={() => onCancel(latest)} onDelete={() => onDelete(latest)} /></span>}
          {!single && <ChevronRight size={15} className={cn("text-tertiary transition-transform", open && "rotate-90")} />}
        </div>
      </div>
      {!single && open && (
        <div className="pb-2">
          {g.drafts.map((d) => (
            <DraftLine key={d.id} d={d} mode={mode} onOpen={() => onOpenDraft(d)} onCancel={() => onCancel(d)} onDelete={() => onDelete(d)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Drafts({ mode }: { mode: "draft" | "scheduled" }) {
  const q = useDrafts();
  const m = useDraftMutations();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { openCompose } = useCompose();
  const list = (q.data ?? []).filter((d) => (mode === "scheduled" ? d.status === "scheduled" || d.status === "sending" || d.status === "failed" : d.status === "draft"));
  const openDraft = (d: Draft) =>
    openCompose({ draft_id: d.id, account_id: d.account_id, thread_id: d.thread_id, reply_to_message_id: d.reply_to_message_id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body_html: d.body_html, title: d.status === "draft" ? "Draft" : "Scheduled message" });
  const people = useMemo(() => groupDraftsByPerson(list, mode), [list, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (g: DraftPerson) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(g.key)) n.delete(g.key);
      else n.add(g.key);
      return n;
    });
  // Keys walk the people; Enter opens a person's only draft, or folds out their list.
  const { cursor } = useItemCursor({
    count: people.length,
    onOpen: (i) => {
      const g = people[i];
      if (!g) return;
      if (g.drafts.length === 1) openDraft(g.drafts[0]);
      else toggle(g);
    },
  });
  const scheduled = mode === "scheduled";
  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader
        className="px-2"
        title={scheduled ? "Scheduled" : "Drafts"}
        subtitle={`${people.length ? `${people.length} ${people.length === 1 ? "person" : "people"}. ` : ""}${scheduled ? "Going out later, automatically." : "Half-written thoughts, waiting."}`}
        actions={!scheduled && <Button variant="ghost" size="sm" onClick={() => openCompose()}><BrandIcon name="write" /> New message</Button>}
      />
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <SkeletonRows rows={4} />}
      {!q.isLoading && list.length === 0 && !q.error && (
        <EmptyState
          icon={scheduled ? <BrandIcon name="scheduled" /> : <BrandIcon name="write" />}
          title={scheduled ? "Nothing scheduled." : "No drafts."}
          body={scheduled ? "Use the arrow next to Send to pick a time." : "Press c to start one. We'll keep it here until you send it."}
          action={!scheduled && <Button variant="ghost" size="sm" onClick={() => openCompose()}>Start writing</Button>}
        />
      )}
      {people.map((g, i) => (
        <div key={g.key || "none"} data-item-index={i} data-focused={cursor === i || undefined}>
          <PersonCard
            g={g}
            mode={mode}
            focused={cursor === i}
            open={opened.has(g.key)}
            onToggle={() => toggle(g)}
            onOpenDraft={openDraft}
            onCancel={(d) => m.cancelScheduled.mutate(d.id)}
            onDelete={(d) => setConfirmId(d.id)}
          />
        </div>
      ))}

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>It's gone for good — there's no undo for drafts.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmId) m.remove.mutate(confirmId);
                setConfirmId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
