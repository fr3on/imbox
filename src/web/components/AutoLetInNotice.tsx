import { Check, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoLetInSeen, useAutoLetIns, useUndoAutoLetIn } from "../api";
import { Button } from "@/components/ui/button";

/**
 * People let in without asking (the "Let obvious people in" setting), listed where you would otherwise have been asked about them, each
 * with an Undo. It stays until you have looked: "Got it" clears the list, and an Undo puts that person back in the Screener for good.
 */
export function AutoLetInNotice({ className, compact }: { className?: string; compact?: boolean }) {
  const list = useAutoLetIns();
  const seen = useAutoLetInSeen();
  const undo = useUndoAutoLetIn();
  const people = list.data?.people ?? [];
  if (!people.length) return null;
  return (
    <section aria-label="Let in automatically" className={cn("rounded-lg border border-dashed border-border bg-muted/40 p-3", className)}>
      <div className="flex items-start gap-2.5">
        <UserCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{people.length === 1 ? "1 person was let in for you" : `${people.length} people were let in for you`}</p>
          <p className="text-[12.5px] text-muted-foreground">They went straight to the Imbox. Undo puts someone back here to decide.</p>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => seen.mutate()} disabled={seen.isPending}>
          <Check /> Got it
        </Button>
      </div>
      <ul className={cn("mt-2 divide-y divide-border border-t border-border", compact && "text-[13px]")}>
        {people.slice(0, 6).map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.name || p.email}</div>
              <div className="truncate text-[12.5px] text-muted-foreground">{p.reason}</div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => undo.mutate(p.id)} disabled={undo.isPending}>
              Undo
            </Button>
          </li>
        ))}
      </ul>
      {people.length > 6 && <p className="pt-2 text-[12.5px] text-muted-foreground">And {people.length - 6} more.</p>}
    </section>
  );
}
