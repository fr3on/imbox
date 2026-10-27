import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "2 need a response": Paper Trail mail that reads like it demands something. Pressing it shows only those; pressing again shows all.
 * Nothing renders when there are none, so a quiet paper trail stays quiet.
 */
export function UrgentChip({ count, on, onToggle, large }: { count: number; on: boolean; onToggle: () => void; large?: boolean }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium transition-colors active:opacity-70 [&>svg]:size-3.5",
        large ? "h-8 px-3 text-[13px]" : "h-7 px-2.5 text-[12.5px]",
        on ? "bg-amber-500 text-amber-950" : "bg-amber-500/15 text-amber-800 hover:bg-amber-500/25 dark:text-amber-300",
      )}
    >
      <AlertTriangle />
      {count} {count === 1 ? "needs" : "need"} a response
    </button>
  );
}
