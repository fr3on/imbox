import { Button } from "@/components/ui/button";
import type { AiBulkActionProposal } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Layers, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, invalidateMail } from "@/api";

export function BulkActionCard({ p }: { p: AiBulkActionProposal }) {
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "applied" | "undone" | "dismissed">(p.applied ? "applied" : "idle");
  const [busy, setBusy] = useState<"applying" | "undoing" | null>(null);

  const apply = async () => {
    setBusy("applying");
    try {
      let body: any;
      if (p.action === "move") body = { action: "move", bucket: p.bucket, thread_ids: p.thread_ids };
      else if (p.action === "trash") body = { action: "move", bucket: "trash", thread_ids: p.thread_ids };
      else if (p.action === "mark_read") body = { action: "mark_read", thread_ids: p.thread_ids };
      else if (p.action === "mark_unread") body = { action: "mark_unread", thread_ids: p.thread_ids };
      else if (p.action === "reply_later") body = { action: "reply_later", on: true, thread_ids: p.thread_ids };
      else if (p.action === "set_aside") body = { action: "set_aside", on: true, thread_ids: p.thread_ids };
      else body = { action: p.action, bucket: p.bucket, thread_ids: p.thread_ids };

      await api.post("/api/threads/bulk", body);
      setState("applied");
      invalidateMail(qc);
      toast.success(p.description);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy("undoing");
    try {
      if (p.action === "move" || p.action === "trash") {
        const byBucket = new Map<string, string[]>();
        for (const t of p.threads) {
          const b = t.previous_bucket || "imbox";
          const arr = byBucket.get(b) ?? [];
          arr.push(t.id);
          byBucket.set(b, arr);
        }
        for (const [b, ids] of byBucket.entries()) {
          await api.post("/api/threads/bulk", { action: "move", bucket: b, thread_ids: ids });
        }
      } else if (p.action === "mark_read") {
        await api.post("/api/threads/bulk", { action: "mark_unread", thread_ids: p.thread_ids });
      } else if (p.action === "mark_unread") {
        await api.post("/api/threads/bulk", { action: "mark_read", thread_ids: p.thread_ids });
      } else if (p.action === "reply_later") {
        await api.post("/api/threads/bulk", { action: "reply_later", on: false, thread_ids: p.thread_ids });
      } else if (p.action === "set_aside") {
        await api.post("/api/threads/bulk", { action: "set_aside", on: false, thread_ids: p.thread_ids });
      }
      setState("undone");
      invalidateMail(qc);
      toast.success(`Undone: ${p.description}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (state === "dismissed") return null;

  if (state === "undone") {
    return (
      <div className="my-2 rounded-lg bg-muted/40 p-2.5 text-[13px] border border-border/40 flex items-center justify-between text-muted-foreground">
        <div className="flex items-center gap-2">
          <RotateCcw className="size-3.5 text-muted-foreground" />
          <span>Undone · Restored {p.thread_ids.length} thread{p.thread_ids.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    );
  }

  if (state === "applied") {
    return (
      <div className="my-2 rounded-lg bg-muted/40 p-3 text-[13px] border border-border/40">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-foreground font-medium">
            <Check className="size-3.5 text-emerald-500" />
            <span>{p.description}</span>
            <span className="text-xs text-muted-foreground font-normal">({p.thread_ids.length})</span>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={undo} disabled={busy === "undoing"}>
            {busy === "undoing" ? <Loader2 className="animate-spin size-3" /> : <RotateCcw className="size-3" />}
            Undo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg bg-muted/50 p-3 text-[13px] border border-border/40">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Layers className="size-3.5 text-primary" />
        <span className="truncate font-medium text-foreground/80">Bulk Action</span>
        <span className="text-xs text-muted-foreground ml-auto bg-muted px-2 py-0.5 rounded-full font-medium tnum">
          {p.thread_ids.length} thread{p.thread_ids.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="font-semibold text-foreground text-[14px] mb-2">{p.description}?</div>

      {p.threads.length > 0 && (
        <div className="space-y-1 mb-3 text-[12px] bg-background/60 rounded-md p-2 border border-border/30">
          {p.threads.slice(0, 3).map((t) => (
            <div key={t.id} className="truncate text-muted-foreground">
              <span className="font-medium text-foreground">{t.from.split("<")[0].trim()}</span>: {t.subject}
            </div>
          ))}
          {p.threads.length > 3 && (
            <div className="text-[11px] text-muted-foreground/80 italic pt-0.5">
              + {p.threads.length - 3} more thread{p.threads.length - 3 === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={apply} disabled={busy === "applying"}>
          {busy === "applying" && <Loader2 className="animate-spin size-3.5 mr-1.5" />}
          Apply
        </Button>
        <Button size="sm" variant="outline" onClick={() => setState("dismissed")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
