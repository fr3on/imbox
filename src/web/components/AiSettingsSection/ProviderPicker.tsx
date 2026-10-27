import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Laptop, Plug } from "lucide-react";
import type { AiPreset } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const GROUPS: { id: AiPreset["group"]; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "hosted", label: "Open and fast models, hosted" },
  { id: "cloud", label: "Cloud platforms" },
  { id: "local", label: "On your own machine" },
  { id: "custom", label: "Anything else" },
];

/** A small tile for a provider: its initials, or an icon for the ones that run on your own machine or at an address you give. */
function Tile({ p }: { p: AiPreset }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/60 text-[11px] font-semibold text-foreground/80 [&>svg]:size-3.5">
      {p.group === "local" ? <Laptop /> : p.id === "custom" ? <Plug /> : p.label.replace(/[^A-Za-z]/g, "").slice(0, 2)}
    </span>
  );
}

/** The provider field: a search box over every provider, grouped, each with a line on what it is. */
export function ProviderPicker({ presets, value, onChange, className }: { presets: AiPreset[]; value: AiPreset["id"]; onChange: (id: AiPreset["id"]) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const current = presets.find((x) => x.id === value);
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, items: presets.filter((x) => (x.group ?? "custom") === g.id) })).filter((g) => g.items.length), [presets]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} aria-label="Provider" className={cn("justify-between gap-2 font-normal", className)}>
          <span className="flex min-w-0 items-center gap-2">
            {current && <Tile p={current} />}
            <span className="truncate">{current?.label ?? "Choose a provider"}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] p-0">
        <Command loop>
          <CommandInput placeholder="Search providers…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No provider by that name. Use Custom for any OpenAI-compatible server.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.id} heading={g.label}>
                {g.items.map((x) => (
                  <CommandItem
                    key={x.id}
                    value={`${x.label} ${x.blurb}`}
                    onSelect={() => {
                      onChange(x.id);
                      setOpen(false);
                    }}
                    className="items-start gap-2.5 py-2"
                  >
                    <Tile p={x} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{x.label}</span>
                      <span className="block text-xs leading-4 text-muted-foreground">{x.blurb}</span>
                    </span>
                    <Check className={cn("mt-1 size-4 shrink-0", value === x.id ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
