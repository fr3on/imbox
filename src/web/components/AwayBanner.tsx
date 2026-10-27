import { Plane } from "lucide-react";
import { toast } from "sonner";
import { useEndVacation } from "../api";
import type { ImboxResponse } from "@shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** While the person is away: says so, says what has been done for them, and ends it with one press. Nothing when they are not away. */
export function AwayBanner({ away, className }: { away: ImboxResponse["away"] | undefined; className?: string }) {
  const end = useEndVacation();
  if (!away) return null;
  const until = new Date(away.until).toLocaleDateString([], { month: "long", day: "numeric" });
  const back = () =>
    end.mutate(undefined, {
      onSuccess: () => toast.success("Welcome back", { description: away.held > 0 ? `${plural(away.held, "message that was", "messages that were")} waiting are back in your Imbox.` : undefined }),
      onError: () => toast.error("Couldn't end it", { description: "Try again in a moment." }),
    });
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-muted/50 px-3.5 py-2.5", className)} role="status">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground/80">
        <Plane size={16} />
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <div className="font-medium text-foreground">You are away until {until}.</div>
        <div className="text-muted-foreground">
          {plural(away.replied, "person has", "people have")} been told.
          {away.held > 0 ? ` ${plural(away.held, "message waits", "messages wait")} in Back to work.` : ""}
        </div>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={back} disabled={end.isPending}>
        I am back
      </Button>
    </div>
  );
}
