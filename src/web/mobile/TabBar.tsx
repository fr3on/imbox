import { useState } from "react";
import { useOutbox } from "../lib/outbox";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { BrandIcon, type BrandIconName } from "../components/BrandIcons";
import { useAccount } from "../context/AccountContext";
import { useCounts } from "../api";
import { useMenuPreset, type MobileTab } from "../lib/menuPresets";
import { ActionSheet } from "./ActionSheet";
import { MoreDialogs, MoreMenu, useMoreDialogs } from "./MoreMenu";
import { updatesNew } from "../lib/updatesCount";

/**
 * The bottom bar follows the menu style. Four slots and More at most: a fifth would put every label under 54px on a small phone.
 * Whatever is not a tab is one tap away under More, so no style takes anything out of reach.
 */
const CHOICES: Record<MobileTab, { to: string; label: string; icon: BrandIconName; end?: boolean }> = {
  imbox: { to: "/", label: "Imbox", icon: "imbox", end: true },
  screener: { to: "/screener", label: "Screener", icon: "screener" },
  updates: { to: "/feed", label: "Feed", icon: "feed" },
  contacts: { to: "/contacts", label: "Contacts", icon: "sender" },
  calendar: { to: "/calendar", label: "Calendar", icon: "calendar" },
  sent: { to: "/sent", label: "Sent", icon: "sent" },
  assistant: { to: "/assistant", label: "Assistant", icon: "assistant" },
};
const MORE: { to: string; label: string; icon: BrandIconName } = { to: "/more", label: "More", icon: "more" };

export const TAB_BAR_H = 56;

export function TabBar() {
  const loc = useLocation();
  const unsent = useOutbox().length;
  const { accounts } = useAccount();
  const counts = useCounts(accounts.length > 0);
  const c = counts.data;
  const preset = useMenuPreset();
  const [moreOpen, setMoreOpen] = useState(false);
  const dialogs = useMoreDialogs();
  const TABS = [...preset.mobile.map((id) => CHOICES[id]), MORE];
  const topLevel = TABS.map((t) => t.to);
  const activeTo = (() => {
    if (loc.pathname === "/") return "/";
    const hit = topLevel.find((p) => p !== "/" && loc.pathname.startsWith(p));
    return hit ?? "/more";
  })();
  // A message that has not gone is told on the Imbox tab (its chip is in that screen's title row). With no Imbox tab in the bar it lands on More.
  const unsentAt = topLevel.includes("/") ? "/" : "/more";
  const dots: Record<string, number | undefined> = { "/": c?.imbox_new, "/screener": c?.screener, "/feed": updatesNew(c), "/updates": updatesNew(c) };
  if (unsent > 0) dots[unsentAt] = (dots[unsentAt] ?? 0) + unsent;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 bg-background/95 backdrop-blur border-t border-border pb-safe" aria-label="Primary">
      <div className="grid" style={{ height: TAB_BAR_H, gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}>
        {TABS.map((t) => {
          const active = activeTo === t.to;
                    const n = dots[t.to];
          return (
            <Tab key={t.to} to={t.to} onMore={t.to === MORE.to ? () => setMoreOpen(true) : undefined} className={cn("relative flex flex-col items-center justify-center gap-1 select-none", active ? "text-foreground" : "text-muted-foreground")} aria-current={active ? "page" : undefined}>
              <span className="relative">
                <BrandIcon name={t.icon} size={22} strokeWidth={active ? 2.2 : 1.8} />
                {!!n && <span className={cn("absolute -top-0.5 -right-1 size-2 rounded-full ring-2 ring-background", t.to === "/screener" || (unsent > 0 && t.to === unsentAt) ? "bg-foreground" : "bg-foreground/70")} />}
              </span>
              <span className={cn("text-[10px] leading-none", active ? "font-semibold" : "font-medium")}>{t.label}</span>
            </Tab>
          );
        })}
      </div>
      <ActionSheet open={moreOpen} onOpenChange={setMoreOpen}>
        <div className="max-h-[78dvh] overflow-y-auto overscroll-contain pt-1">
          <MoreMenu d={dialogs} onDone={() => setMoreOpen(false)} />
        </div>
      </ActionSheet>
      {(moreOpen || dialogs.theme || dialogs.style || dialogs.about || dialogs.update) && <MoreDialogs d={dialogs} />}
    </nav>
  );
}

/** A tab. More is not a page of its own to go to: it opens the menu as a sheet over the page you are on. */
function Tab({ to, onMore, children, ...rest }: { to: string; onMore?: () => void; children: React.ReactNode } & Omit<React.ComponentProps<typeof Link>, "to">) {
  if (onMore) {
    return (
      <button type="button" onClick={onMore} className={rest.className} aria-current={rest["aria-current"]} aria-haspopup="dialog">
        {children}
      </button>
    );
  }
  return (
    <Link to={to} {...rest}>
      {children}
    </Link>
  );
}
