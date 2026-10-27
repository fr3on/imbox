import { useCallback, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Message } from "@shared/types";
import { cn } from "@/lib/utils";
import { isBounceMessage } from "./messages";

const KEY = "imbox.thread.hideBounces";

// Delivery failure notices are noise in a long thread. Whether to show them is one choice for every thread, kept on this device.
export function useHideBounces(messages: Message[]) {
  const [hide, setHide] = useState(() => {
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setHide((h) => {
      try { localStorage.setItem(KEY, h ? "0" : "1"); } catch { /* private mode: the choice just lasts for this visit */ }
      return !h;
    });
  }, []);
  const bounces = messages.filter(isBounceMessage);
  // A thread that is only failure notices has nothing else to show, so it keeps them.
  const hidden = hide && bounces.length > 0 && bounces.length < messages.length ? new Set(bounces.map((m) => m.id)) : new Set<string>();
  return { count: bounces.length, hide, hidden, toggle };
}

export function BounceToggle({ count, hide, onToggle, className }: { count: number; hide: boolean; onToggle: () => void; className?: string }) {
  if (count === 0) return null;
  return (
    <div className={cn("flex items-center gap-1.5 text-[12px] text-muted-foreground", className)}>
      <AlertCircle className="size-3.5 shrink-0" />
      <span>{count} delivery failure notice{count === 1 ? "" : "s"}{hide ? " hidden" : ""}</span>
      <button type="button" onClick={onToggle} className="font-medium text-foreground underline-offset-2 hover:underline">
        {hide ? "Show" : "Hide"}
      </button>
    </div>
  );
}
