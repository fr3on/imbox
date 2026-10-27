import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const FALLBACK_ZONES = [
  "UTC", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Madrid", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam",
  "Europe/Zurich", "Europe/Stockholm", "Europe/Warsaw", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow", "Africa/Lagos",
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Nairobi", "Asia/Jerusalem", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata",
  "Asia/Dhaka", "Asia/Bangkok", "Asia/Jakarta", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Perth", "Australia/Brisbane", "Australia/Sydney", "Pacific/Auckland", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "America/Bogota", "America/Mexico_City", "America/New_York", "America/Toronto", "America/Chicago", "America/Denver",
  "America/Phoenix", "America/Los_Angeles", "America/Vancouver", "America/Anchorage", "Pacific/Honolulu",
];

/** `Intl.supportedValuesOf` is recent; older engines fall back to a short list. */
export function zoneList(current: string): string[] {
  let all: string[] = [];
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof f === "function") all = f.call(Intl, "timeZone");
  } catch {
    all = [];
  }
  if (!all || all.length === 0) all = FALLBACK_ZONES;
  return current && !all.includes(current) ? [current, ...all] : all;
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "your device";
  } catch {
    return "your device";
  }
}

export function hourLabel(h: number, fmt: "12" | "24"): string {
  if (fmt === "24") return `${String(h).padStart(2, "0")}:00`;
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

/** The offset a zone has right now, like "GMT+3", so a zone can be found by it as well as by its name. */
export function offsetOf(zone: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** A timezone picker you can type into: "cairo", "new york" or "+3" narrows the list. An empty value means the device's own zone. */
export function TimezoneSelect({ value, zones, device, onChange }: { value: string; zones: string[]; device: string; onChange: (zone: string) => void }) {
  const [open, setOpen] = useState(false);
  const items = useMemo(() => zones.map((z) => ({ z, name: z.replace(/_/g, " "), off: offsetOf(z) })), [zones]);
  const pickZone = (z: string) => {
    onChange(z);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" role="combobox" aria-expanded={open} aria-label="Timezone" className="min-w-56 justify-between font-normal">
          <span className="truncate">{value ? value.replace(/_/g, " ") : `Same as this device (${device})`}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search timezones" />
          <CommandList>
            <CommandEmpty>No timezone matches that.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`same as this device ${device}`} onSelect={() => pickZone("")}>
                Same as this device ({device})
                {!value && <Check className="ml-auto" />}
              </CommandItem>
              {items.map((i) => (
                <CommandItem key={i.z} value={`${i.name} ${i.off}`} onSelect={() => pickZone(i.z)}>
                  <span className="truncate">{i.name}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tnum">{i.off}</span>
                  {value === i.z && <Check className="ml-1 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
