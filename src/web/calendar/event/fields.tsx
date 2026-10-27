import { BrandIcon } from "@/components/BrandIcons";
import { useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarGrid } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dateKey, fmtTime, keyToDate, longDayLabel, msAt } from "@/lib/caldate";
import { SLOTS } from "./time";

const EMOJI = ["📅", "🎉", "🎂", "✈️", "🍽️", "☕️", "🏃", "💼", "📞", "🎬", "🩺", "🏖️", "💪", "📚", "🎓", "🎵", "🛠️", "❤️", "⭐️", "🔥", "🧘", "🚗", "🏡", "💡"];

export function EmojiButton({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label="Emoji" className="shrink-0 text-muted-foreground">
          {value ? <span className="text-[15px] leading-none">{value}</span> : <Smile />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI.map((e) => (
            <button key={e} type="button" className="size-7 rounded-md text-[15px] hover:bg-muted" onClick={() => { onChange(e); setOpen(false); }}>
              {e}
            </button>
          ))}
        </div>
        {value && (
          <Button variant="ghost" size="xs" className="mt-1 w-full text-muted-foreground" onClick={() => { onChange(""); setOpen(false); }}>
            Remove
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The date half of a start/end row — the same calendar the rest of the app picks dates with. */
export function DateField({ value, onChange, disabled }: { value: string; onChange: (key: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const short = keyToDate(value).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} title={longDayLabel(value)} className="justify-start font-normal tnum">
          <BrandIcon name="calendar" className="text-muted-foreground" />
          {short}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-1">
        <CalendarGrid
          mode="single"
          selected={keyToDate(value)}
          defaultMonth={keyToDate(value)}
          onSelect={(d) => {
            if (!d) return;
            onChange(dateKey(d.getTime()));
            setOpen(false);
          }}
          className="p-1"
        />
      </PopoverContent>
    </Popover>
  );
}

/** Plain 15-minute select. An off-grid time (a synced 09:07 meeting) keeps its own slot. */
export function TimeField({ day, minutes, onChange, format, disabled }: { day: string; minutes: number; onChange: (m: number) => void; format: "12" | "24"; disabled?: boolean }) {
  const options = useMemo(() => {
    const list = SLOTS.includes(minutes) ? SLOTS : [...SLOTS, minutes].sort((a, b) => a - b);
    return list.map((m) => ({ value: String(m), label: fmtTime(msAt(day, m), format) }));
  }, [day, minutes, format]);
  return (
    <Select value={String(minutes)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger size="sm" className="w-28 tnum">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="tnum">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Row({ label, icon, children, className }: { label: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-3 border-b border-border py-2", className)}>
      <span className="flex w-24 shrink-0 items-center gap-1.5 pt-1.5 text-[13px] text-muted-foreground select-none [&>svg]:size-3.5 [&>svg]:text-tertiary">
        {icon}
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const RSVP_LABEL: Record<string, string> = { accepted: "Yes", declined: "No", tentative: "Maybe", needsAction: "No reply" };
