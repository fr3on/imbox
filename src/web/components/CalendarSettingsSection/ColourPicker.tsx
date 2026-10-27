import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The server accepts any six-digit hex; the ramp is what the app offers on its own. */
export const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * A calendar's colour is the one place colour enters this UI, and it is the thing that makes a busy
 * week readable, so the palette is real rather than a grey ramp. The hues are the muted-saturated
 * kind that carries white text at full contrast without shouting. The greys stay on the
 * first row, so anyone who wants the calendar to stay monochrome still can.
 */
export const RAMP = [
  "#111111", "#3d3d3d", "#5c5c5c", "#8a8a8a",
  "#3d6c56", "#3d5a6c", "#3d3e6c", "#613d6c",
  "#6c3d47", "#6c4b3d", "#6c633d", "#3d686c",
];

export function ColourPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const valid = HEX.test(hex);
  const apply = () => { if (valid) onChange(hex.toLowerCase()); };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Colour" title="Colour" className="size-4 shrink-0 rounded-full border border-border ring-offset-1 transition-shadow hover:ring-2 hover:ring-ring" style={{ background: value }} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2.5">
        <div className="grid grid-cols-4 gap-2">
          {RAMP.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              title={c}
              onClick={() => onChange(c)}
              className={cn("size-6 rounded-full border border-border transition-transform hover:scale-110", value.toLowerCase() === c && "ring-2 ring-ring ring-offset-1")}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Input
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
            placeholder="#767676"
            aria-label="Hex colour"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="h-7 font-mono text-xs"
          />
          <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" disabled={!valid} onClick={apply}>Use</Button>
        </div>
        {!valid && <p className="mt-1.5 text-[11px] text-muted-foreground">Six hex digits, like #767676.</p>}
      </PopoverContent>
    </Popover>
  );
}
