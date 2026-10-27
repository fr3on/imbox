import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { Counts } from "@shared/types";
import { cn } from "@/lib/utils";
import { destination, moreGroups, onDestination, useMenuPreset, type TabId } from "../lib/menuPresets";
import { updatesNew } from "../lib/updatesCount";
import { BrandIcon } from "./BrandIcons";
import { DESTINATION_ICON } from "./destinationIcons";
import { trayHome } from "./TrayCards";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// The tabs sit in one rounded dock (see Shell); the current one is a raised chip. Shell finds it by data-current to keep it in view.
const tabCls = (on: boolean) =>
  cn(
    "h-8 px-3 inline-flex items-center gap-1.5 rounded-[10px] text-sm font-medium transition-colors shrink-0 outline-none",
    on ? "bg-background text-foreground shadow-[0_0_0_0.5px_var(--border),0_1px_3px_rgba(0,0,0,0.08)]" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
  );

function Count({ n, on }: { n?: number; on: boolean }) {
  if (!n || n <= 0) return null;
  return (
    <span className={cn("ml-1.5 inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.2 text-[11px] tnum transition-colors", on ? "bg-muted font-semibold text-foreground" : "bg-background/70 font-medium text-muted-foreground")}>
      {n}
    </span>
  );
}

/** The numbers shown on a tab, where it has any. */
function countFor(id: TabId, c: Counts | undefined): number | undefined {
  switch (id) {
    case "imbox": return c?.imbox_new;
    case "screener": return c?.screener;
    case "updates": return updatesNew(c);
    case "trays": return (c?.reply_later ?? 0) + (c?.set_aside ?? 0);
    default: return undefined;
  }
}

/**
 * The tabs across the top, as the chosen preset lays them out. Whatever is not a tab is under More, grouped, so nothing goes out of reach;
 * More lights up when the page you are on lives inside it.
 */
export function TopTabs({ counts }: { counts: Counts | undefined }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const preset = useMenuPreset();
  const groups = moreGroups(preset.tabs);
  const inMore = groups.some((g) => g.items.some((d) => onDestination(d, pathname)));

  return (
    <>
      {preset.tabs.map((id) => {
        const d = destination(id);
        const on = onDestination(d, pathname);
        return (
          <Link key={id} to={id === "trays" ? trayHome() : d.to} className={tabCls(on)} data-current={on || undefined}>
            <span className="shrink-0 [&>svg]:size-4">{DESTINATION_ICON[id]}</span>
            <span>{d.label}</span>
            <Count n={countFor(id, counts)} on={on} />
          </Link>
        );
      })}

      {groups.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={tabCls(inMore)} data-current={inMore || undefined}>
              <span className="shrink-0 [&>svg]:size-4"><BrandIcon name="more" /></span>
              <span>More</span>
              <ChevronDown size={12} className="ml-0.5 shrink-0 text-muted-foreground/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[22rem] p-2">
            {groups.map((g, i) => (
              <div key={g.label} role="presentation" className={i > 0 ? "mt-1" : undefined}>
                <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">{g.label}</DropdownMenuLabel>
                <div role="presentation" className="grid grid-cols-4 gap-1">
                  {g.items.map((d) => {
                    const n = countFor(d.id, counts);
                    return (
                      <DropdownMenuItem key={d.id} onClick={() => nav(d.to)} className="relative h-auto flex-col gap-1.5 px-1 py-2 text-center text-xs">
                        <span className="flex size-9 items-center justify-center rounded-[11px] bg-muted text-foreground [&>svg]:size-[18px]">{DESTINATION_ICON[d.id]}</span>
                        <span className="leading-tight">{d.label}</span>
                        {n ? <span className="absolute right-1.5 top-1 rounded-full bg-foreground px-1.5 text-[10px] leading-4 text-background tnum">{n}</span> : null}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

