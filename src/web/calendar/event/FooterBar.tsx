import { BrandIcon } from "@/components/BrandIcons";
import { CopyPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEventMutations } from "@/api";
import type { CalEvent, } from "@shared/types";

export function FooterBar({ ev, readOnly, busy, error, setError, requestDelete, requestClose, requestSave, m, openEvent }: { ev: CalEvent | null; readOnly: boolean; busy: boolean; error: string | null; setError: (e: string | null) => void; requestDelete: () => void; requestClose: () => void; requestSave: () => void; m: ReturnType<typeof useEventMutations>; openEvent: (e: CalEvent) => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {ev && !readOnly && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Delete event" className="text-muted-foreground hover:text-destructive" onClick={requestDelete} disabled={busy}>
                <BrandIcon name="trash" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Duplicate event"
                title="Duplicate"
                className="text-muted-foreground"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  try {
                    // Open the copy straight away: you duplicate something in order to change it.
                    const copy = await m.duplicate.mutateAsync(ev.id);
                    openEvent(copy);
                  } catch (e) {
                    setError((e as Error).message || "Couldn't duplicate that.");
                  }
                }}
              >
                <CopyPlus />
              </Button>
            </>
          )}
          {error && (
            <span className="min-w-0 flex-1 truncate text-[13px] text-destructive" role="alert" title={error}>
              {error}
            </span>
          )}
          <span className={cn("flex-1", error && "hidden")} />
          <Button variant="ghost" onClick={requestClose} disabled={busy}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={requestSave} disabled={busy} title="Save (⌘↵)">
              {ev ? "Save" : "Create"}
            </Button>
          )}
        </div>
  );
}
