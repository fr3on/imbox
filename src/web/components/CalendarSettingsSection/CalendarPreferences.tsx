import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CalendarSettings, CalendarView } from "@shared/types";
import { useCalendarSettings, useCalendarSettingsMutation } from "../../api";
import { Row, Section, Toggle } from "../../settings/parts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { TimezoneSelect, deviceZone, hourLabel, zoneList } from "./timezone";

export const VIEW_LABEL: Record<CalendarView, string> = { days: "Day", week: "Week", month: "Month", year: "Year" };
export const VIEWS: CalendarView[] = ["days", "week", "month", "year"];
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function CalendarPreferences({ compact }: { compact?: boolean }) {
  const q = useCalendarSettings();
  const m = useCalendarSettingsMutation();
  const [s, setS] = useState<CalendarSettings | null>(() => q.data ?? null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const zones = useMemo(() => zoneList(s?.timezone ?? ""), [s?.timezone]);
  const device = useMemo(deviceZone, []);

  if (!s) {
    return (
      <Section title="Calendar preferences" collapsible defaultOpen summary="…">
        <div className="space-y-2 px-4 py-3 sm:px-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </Section>
    );
  }

  const save = (patch: Partial<CalendarSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    m.mutate(patch, { onError: (e) => { setS(s); toast.error((e as Error).message); } });
  };
  const toggleCls = compact ? "w-full grid grid-cols-2" : undefined;
  const itemCls = compact ? "h-10 text-[14px] justify-center" : undefined;

  return (
    <Section title="Calendar preferences" collapsible defaultOpen summary={`Week starts ${s.week_start === 0 ? "Sunday" : "Monday"}, ${s.time_format}-hour`} description="How the calendar looks and keeps time.">
      <Row label="Week starts on">
        <Toggle
          className={toggleCls}
          itemClassName={itemCls}
          value={String(s.week_start)}
          options={[{ value: "0", label: "Sunday" }, { value: "1", label: "Monday" }]}
          onChange={(v) => save({ week_start: Number(v) })}
        />
      </Row>
      <Row label="Time format">
        <Toggle
          className={toggleCls}
          itemClassName={itemCls}
          value={s.time_format}
          options={[{ value: "12", label: "12-hour" }, { value: "24", label: "24-hour" }]}
          onChange={(v) => save({ time_format: v as CalendarSettings["time_format"] })}
        />
      </Row>
      <Row label="Default view">
        <Select value={s.default_view} onValueChange={(v) => save({ default_view: v as CalendarView })}>
          <SelectTrigger size="sm" className="min-w-36"><SelectValue /></SelectTrigger>
          <SelectContent align="end">
            {VIEWS.map((v) => <SelectItem key={v} value={v}>{VIEW_LABEL[v]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Collapse the night" hint="Folds the sleeping hours into one band you can click open.">
        <Switch checked={s.collapse_night} onCheckedChange={(v) => save({ collapse_night: v })} />
      </Row>
      <Row label="Night runs from">
        <div className="flex items-center gap-2">
          <Select value={String(s.night_start)} disabled={!s.collapse_night} onValueChange={(v) => save({ night_start: Number(v) })}>
            <SelectTrigger size="sm" className="w-24" aria-label="Night starts"><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h, s.time_format)}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[13px] text-muted-foreground">to</span>
          <Select value={String(s.night_end)} disabled={!s.collapse_night} onValueChange={(v) => save({ night_end: Number(v) })}>
            <SelectTrigger size="sm" className="w-24" aria-label="Night ends"><SelectValue /></SelectTrigger>
            <SelectContent align="end">
              {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h, s.time_format)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Row>
      <Row label="Show events you've declined">
        <Switch checked={s.show_declined} onCheckedChange={(v) => save({ show_declined: v })} />
      </Row>
      <Row label="Timezone">
        <TimezoneSelect value={s.timezone} zones={zones} device={device} onChange={(v) => save({ timezone: v })} />
      </Row>
    </Section>
  );
}
