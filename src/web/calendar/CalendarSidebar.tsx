import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, Settings2 } from "lucide-react";
import type { Calendar } from "@shared/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCalendar } from "./CalendarContext";
import { useCalendarSourceMutations } from "../api";
import { addMonths, isSameMonth, keyToDate, monthGrid, monthLabel, weekDays } from "../lib/caldate";
import { fmtRelative } from "../lib/format";

/** The mini month: any day is one click away, and the week on screen is tinted. */
function MiniMonth() {
  const { cursor, today, settings, reveal } = useCalendar();
  const [shown, setShown] = useState(cursor);
  // Follow the calendar when it moves to another month (Today, the arrows, a keyboard walk), but let the person page ahead on their own.
  const [lastCursor, setLastCursor] = useState(cursor);
  if (cursor !== lastCursor) {
    setLastCursor(cursor);
    setShown(cursor);
  }
  const days = monthGrid(shown, settings.week_start);
  const onScreen = new Set(weekDays(cursor, settings.week_start));
  return (
    <section aria-label="Pick a day" className="mb-4">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <h2 className="text-[13px] font-medium">{monthLabel(shown)}</h2>
        <div className="flex">
          <Button variant="ghost" size="icon-xs" aria-label="Previous month" onClick={() => setShown(addMonths(shown, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Next month" onClick={() => setShown(addMonths(shown, 1))}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] tnum">
        {days.slice(0, 7).map((d) => (
          <span key={d} className="py-0.5 text-tertiary" aria-hidden>
            {keyToDate(d).toLocaleDateString([], { weekday: "narrow" })}
          </span>
        ))}
        {days.map((d) => {
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              onClick={() => reveal(d)}
              aria-label={keyToDate(d).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "my-px rounded-md py-1 transition-colors",
                isToday ? "bg-foreground font-medium text-background" : onScreen.has(d) ? "bg-muted text-foreground" : "hover:bg-muted",
                !isToday && !isSameMonth(d, shown) && "text-tertiary",
                !isToday && isSameMonth(d, shown) && !onScreen.has(d) && "text-muted-foreground",
              )}
            >
              {keyToDate(d).getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Where a calendar comes from, as a heading. */
function groupOf(c: Calendar): string {
  if (c.source === "google") return c.account_email ? `Google · ${c.account_email}` : "Google";
  if (c.source === "ics") return "Subscribed";
  if (c.source === "caldav") return "Mailboxes";
  return "In Imbox";
}

function CalendarRow({ c }: { c: Calendar }) {
  const { update, sync } = useCalendarSourceMutations();
  const nav = useNavigate();
  const bad = c.sync_status === "error";
  const syncing = c.sync_status === "syncing" || (sync.isPending && sync.variables === c.id);
  return (
    <div>
      <button
        type="button"
        aria-pressed={c.visible}
        onClick={() => update.mutate({ id: c.id, visible: !c.visible })}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] transition-colors hover:bg-muted"
        title={c.visible ? "Hide this calendar" : "Show this calendar"}
      >
        <span className="size-2.5 shrink-0 rounded-full" style={c.visible ? { background: c.color } : { boxShadow: `inset 0 0 0 1.5px ${c.color}`, opacity: 0.55 }} />
        <span className={cn("min-w-0 flex-1 truncate", !c.visible && "text-tertiary")}>{c.name}</span>
        {bad && <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Not syncing" />}
        {syncing && <Loader2 className="size-3.5 shrink-0 animate-spin text-tertiary" aria-label="Syncing" />}
      </button>
      {bad && (
        <div className="mb-1 ml-[1.45rem] mr-1 text-[11.5px] leading-snug text-amber-800 dark:text-amber-300">
          <span>{c.sync_error || "Stopped syncing."}</span>{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => (c.source === "google" ? nav("/settings/calendar") : sync.mutate(c.id))}
          >
            {c.source === "google" ? "Reconnect in Settings" : "Try again"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The calendar page's left panel: a mini month to jump to any day, then every calendar grouped by where it comes from. A tap hides or shows one,
 * and one that has stopped syncing says why, in place, with the way to fix it.
 */
export function CalendarSidebar() {
  const { calendars } = useCalendar();
  const { syncAll } = useCalendarSourceMutations();
  const groups = new Map<string, Calendar[]>();
  for (const c of [...calendars].sort((a, b) => a.position - b.position)) {
    const g = groupOf(c);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const broken = calendars.filter((c) => c.sync_status === "error").length;
  const last = Math.max(0, ...calendars.map((c) => c.last_synced_at ?? 0));
  const refreshing = syncAll.isPending || calendars.some((c) => c.sync_status === "syncing");
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
      <MiniMonth />
      {calendars.length === 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Nothing connected yet. <Link to="/settings/calendar" className="underline underline-offset-2">Add a calendar</Link>
        </p>
      )}
      {[...groups].map(([name, list]) => (
        <section key={name} aria-label={name} className="mb-3">
          <h2 className="mb-0.5 truncate px-1.5 font-mono text-[10px] uppercase tracking-[0.07em] text-tertiary" title={name}>{name}</h2>
          {list.map((c) => (
            <CalendarRow key={c.id} c={c} />
          ))}
        </section>
      ))}
      {calendars.length > 0 && (
        <div className="mt-auto border-t border-border pt-2">
          <p className={cn("px-1.5 pb-1 text-[11.5px]", broken ? "text-amber-800 dark:text-amber-300" : "text-tertiary")}>
            {refreshing ? "Syncing…" : broken ? `${broken} ${broken === 1 ? "calendar needs" : "calendars need"} attention` : last ? `Synced ${fmtRelative(last)}` : "Not synced yet"}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 flex-1 justify-start text-xs" onClick={() => syncAll.mutate()} disabled={syncAll.isPending}>
              <RefreshCw className={cn(syncAll.isPending && "animate-spin")} />
              Refresh all
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
              <Link to="/settings/calendar">
                <Settings2 />
                Manage
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
