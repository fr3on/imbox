import { BrandIcon } from "./BrandIcons";
import type { ThreadSummary } from "@shared/types";
import { cn } from "@/lib/utils";
import { useDismissImboxHint, useThreadAction } from "../api";
import { Button } from "@/components/ui/button";

/** "Move this one to the Imbox?" for a Feeds or Paper Trail thread that looks like it needs you. Only this thread moves; its sender stays put. */
export function ImboxHintBanner({ thread, className }: { thread: Pick<ThreadSummary, "id" | "bucket" | "imbox_hint">; className?: string }) {
  const act = useThreadAction(thread.id);
  const dismiss = useDismissImboxHint();
  if (!thread.imbox_hint || (thread.bucket !== "feed" && thread.bucket !== "paper_trail")) return null;
  const where = "Feed";
  return (
    <div role="region" aria-label="Move to the Imbox" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5", className)}>
      <BrandIcon name="imbox" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-medium">Move this one to the Imbox?</p>
        <p className="text-[12.5px] text-muted-foreground">{thread.imbox_hint.reason}. Other mail from this sender stays in {where}.</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ action: "move", bucket: "imbox" })}>
          Move to Imbox
        </Button>
        <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(thread.id)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
