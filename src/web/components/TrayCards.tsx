import { useEffect } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useCounts, useThreads } from "../api";
import { useAccount } from "../context/AccountContext";
import { fmtRelative } from "../lib/format";
import { BrandIcon, type BrandIconName } from "./BrandIcons";
import { PageHeader } from "./EmptyState";

export type TrayId = "reply-later" | "set-aside" | "bubble-up";

const TRAYS: { id: TrayId; to: string; icon: BrandIconName; label: string; meaning: string }[] = [
  { id: "reply-later", to: "/reply-later", icon: "reply-later", label: "Reply later", meaning: "You owe an answer" },
  { id: "set-aside", to: "/set-aside", icon: "set-aside", label: "Set aside", meaning: "Kept close at hand" },
  { id: "bubble-up", to: "/bubble-up", icon: "bubble-up", label: "Bubble up", meaning: "Out of sight until a time you pick" },
];

const KEY = "inbox.tray";

/** The tray the Trays tab opens: the one you were last in. */
export function trayHome(): string {
  try {
    const last = localStorage.getItem(KEY);
    return TRAYS.find((t) => t.id === last)?.to ?? TRAYS[0]!.to;
  } catch {
    return TRAYS[0]!.to;
  }
}

/** The head of each tray page: the three trays as cards with what is in them, and the one you are in marked. */
export function TrayCards({ active, subtitle }: { active: TrayId; subtitle?: string }) {
  const { accounts } = useAccount();
  const enabled = accounts.length > 0;
  const counts = useCounts(enabled).data;
  const bubbling = (useThreads("bubble_up", { enabled }).data?.pages.flatMap((p) => p.threads) ?? []).filter((t) => t.bubble_up_at);
  const next = bubbling.length ? Math.min(...bubbling.map((t) => t.bubble_up_at as number)) : 0;
  useEffect(() => {
    try {
      localStorage.setItem(KEY, active);
    } catch {
      /* the tab then opens the first tray */
    }
  }, [active]);
  const count: Record<TrayId, number> = { "reply-later": counts?.reply_later ?? 0, "set-aside": counts?.set_aside ?? 0, "bubble-up": bubbling.length };
  return (
    <>
      <PageHeader className="px-2" title="Trays" subtitle={subtitle} />
      <nav aria-label="Trays" className="mb-6 grid grid-cols-3 gap-2.5 px-2">
        {TRAYS.map((t) => {
          const on = t.id === active;
          const meaning = t.id === "bubble-up" && next ? `Next back ${fmtRelative(next)}` : t.meaning;
          return (
            <Link
              key={t.id}
              to={t.to}
              aria-current={on ? "page" : undefined}
              className={cn("grid gap-0.5 rounded-xl border p-3.5 transition-colors", on ? "border-2 border-foreground p-[13px]" : "border-border hover:bg-accent")}
            >
              <BrandIcon name={t.icon} size={20} className="text-muted-foreground" />
              <span className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] tnum">{count[t.id]}</span>
              <span className="mt-1 text-sm font-medium">{t.label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{meaning}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
