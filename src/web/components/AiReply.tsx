import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, useAiMutations, useAiSettings } from "../api";
import { fmtRelative } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type AiTone = "match" | "formal" | "friendly" | "brief";
const TONES: { value: AiTone; label: string }[] = [
  { value: "match", label: "My tone" },
  { value: "formal", label: "Formal" },
  { value: "friendly", label: "Friendly" },
  { value: "brief", label: "Brief" },
];

export interface AiReplyResult {
  body_html: string;
  body_text: string;
  subject: string | null;
  reply_to_message_id: string | null;
}

function AiReplyForm({ threadId, onResult, onClose, compact }: { threadId: string; onResult: (r: AiReplyResult) => void; onClose: () => void; compact?: boolean }) {
  const settings = useAiSettings();
  const { reply } = useAiMutations();
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<AiTone>("match");
  const notConfigured = settings.data && !settings.data.configured;
  const go = () => {
    if (!brief.trim()) return;
    reply.mutate(
      { thread_id: threadId, brief: brief.trim(), tone },
      {
        onSuccess: (r) => { onResult(r); onClose(); },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  };
  return (
    <div className={cn("space-y-3", compact ? "px-4 pb-4" : "")}>
      {notConfigured ? (
        <div className="text-[13px] text-muted-foreground">
          <Link to="/settings/ai" className="underline underline-offset-2">Add your Anthropic API key</Link> in Settings → AI to write replies with AI.
        </div>
      ) : (
        <>
          <textarea
            autoFocus
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
            rows={compact ? 4 : 3}
            placeholder="What do you want to say? e.g. “Yes, Tuesday at 3 works — ask them to send the agenda.”"
            className="w-full resize-none rounded-md bg-muted/60 focus:bg-muted px-3 py-2 text-[14px] leading-6 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleGroup type="single" size="sm" value={tone} onValueChange={(v) => v && setTone(v as AiTone)} variant="outline">
              {TONES.map((t) => <ToggleGroupItem key={t.value} value={t.value} className="text-[12px]">{t.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <span className="flex-1" />
            <Button size={compact ? "lg" : "sm"} className={cn(compact && "w-full")} onClick={go} disabled={!brief.trim() || reply.isPending}>
              {reply.isPending ? <Loader2 className="animate-spin" /> : <BrandIcon name="assistant" />} Write reply
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">Reads the whole thread and what I know about how you write. You review before sending.</div>
        </>
      )}
    </div>
  );
}

/** Mobile: bottom drawer controlled by the caller. */
export function AiReplyDrawer({ threadId, open, onOpenChange, onResult }: { threadId: string; open: boolean; onOpenChange: (o: boolean) => void; onResult: (r: AiReplyResult) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="pb-safe">
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2"><BrandIcon name="assistant" className="size-4" /> Reply with AI</DrawerTitle>
        </DrawerHeader>
        <AiReplyForm threadId={threadId} onResult={onResult} onClose={() => onOpenChange(false)} compact />
      </DrawerContent>
    </Drawer>
  );
}

/* ---------- summary ---------- */

interface SavedSummary {
  summary: string | null;
  stale?: boolean;
  saved_at?: number;
}

/**
 * A thread's summary. It is saved on the server when it is written, so it is here the next time the thread is opened; new
 * messages since then mark it stale and offer a refresh instead of quietly spending another model call.
 */
export function useThreadSummary(threadId: string) {
  const qc = useQueryClient();
  const { summarize } = useAiMutations();
  const key = ["ai", "summary", threadId];
  const saved = useQuery({ queryKey: key, queryFn: () => api.get<SavedSummary>(`/api/ai/summary/${threadId}`), enabled: !!threadId, staleTime: 60_000, retry: false });
  const [hidden, setHidden] = useState(false);
  /** Show the saved summary, or write one if there is none. `force` writes a fresh one over it. */
  const run = (force?: boolean) => {
    if (!force && saved.data?.summary) {
      setHidden(false);
      return;
    }
    summarize.mutate(threadId, {
      onSuccess: (r) => { qc.setQueryData<SavedSummary>(key, { summary: r.summary, stale: false, saved_at: Date.now() }); setHidden(false); },
      onError: (e) => toast.error((e as Error).message),
    });
  };
  const remove = () => {
    qc.setQueryData<SavedSummary>(key, { summary: null });
    void api.del(`/api/ai/summary/${threadId}`).catch(() => {});
  };
  return {
    summary: hidden ? null : (saved.data?.summary ?? null),
    stale: !!saved.data?.stale,
    savedAt: saved.data?.saved_at,
    run,
    pending: summarize.isPending,
    /** Fold it away for now; it stays saved. */
    clear: () => setHidden(true),
    /** Forget the saved one. */
    remove,
  };
}

export function AiSummaryPanel({ summary, onClose, onRefresh, onRemove, stale, pending, savedAt, className }: { summary: string; onClose: () => void; onRefresh?: () => void; onRemove?: () => void; stale?: boolean; pending?: boolean; savedAt?: number; className?: string }) {
  const [open, setOpen] = useState(true);
  const lines = summary.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className={cn("rounded-lg bg-muted/50 px-3 py-2 mb-4", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-[13px] font-medium h-7">
        <BrandIcon name="assistant" className="size-3.5 text-muted-foreground" /> Summary
        {savedAt ? <span className="text-[11px] font-normal text-muted-foreground">saved {fmtRelative(savedAt)}</span> : null}
        <span className="flex-1" />
        {open ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="pb-1">
          {stale && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-background/70 px-2 py-1.5 text-xs text-muted-foreground">
              <span className="flex-1">New messages have arrived since this was written.</span>
              {onRefresh && (
                <Button type="button" size="xs" variant="outline" onClick={onRefresh} disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update
                </Button>
              )}
            </div>
          )}
          <ul className="space-y-1 pl-4 list-disc marker:text-muted-foreground text-[13px] leading-5">
            {lines.map((l, i) => <li key={i}>{l.replace(/^[-*•]\s*/, "")}</li>)}
          </ul>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <button type="button" onClick={onClose} className="hover:text-foreground">Hide</button>
            {onRefresh && !stale && (
              <button type="button" onClick={onRefresh} disabled={pending} className="hover:text-foreground disabled:opacity-50">{pending ? "Updating…" : "Update"}</button>
            )}
            {onRemove && <button type="button" onClick={onRemove} className="hover:text-foreground">Delete</button>}
          </div>
        </div>
      )}
    </div>
  );
}
