import { BrandIcon } from "../components/BrandIcons";
import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLabels, type ThreadFilters } from "../api";
import type { useListFilters } from "../components/ListFilters";

const WHERE = [
  ["any", "Everywhere"],
  ["imbox", "Imbox"],
  ["feed", "Feed"],
  ["screener", "Screener"],
] as const;
const PERIOD = [
  ["any", "Any time"],
  ["1", "Last day"],
  ["7", "Last week"],
  ["30", "Last month"],
  ["365", "Last year"],
] as const;

const chip = "h-8 shrink-0 rounded-full px-3 text-[13px] transition-colors";

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn(chip, "inline-flex items-center gap-1.5 active:opacity-70 [&>svg]:size-3.5", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
      {children}
    </button>
  );
}

/** A native picker dressed as a chip, so phones get their own selection sheet. */
export function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  const active = value !== "any";
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(chip, "appearance-none border-0 outline-none", active ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

/** Search field and a swipeable row of filters at the top of a thread list. */
export function MobileListFilters({ f, showWhere }: { f: ReturnType<typeof useListFilters>; showWhere?: boolean }) {
  const labels = useLabels();
  const set = (patch: Partial<ThreadFilters>) => f.setFilters((cur) => ({ ...cur, ...patch }));
  return (
    <div className="pb-1">
      <div className="px-3 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-lg bg-muted px-3">
          <BrandIcon name="search" size={16} className="shrink-0 text-muted-foreground" />
          <input
            value={f.text}
            onChange={(e) => f.setText(e.target.value)}
            placeholder="Search this list"
            enterKeyHint="search"
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-tertiary"
          />
          {f.text && (
            <button type="button" onClick={() => f.setText("")} aria-label="Clear search" className="text-muted-foreground">
              <X size={16} />
            </button>
          )}
        </label>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Toggle on={!!f.filters.unread} onClick={() => set({ unread: !f.filters.unread })}>Unread</Toggle>
        <Toggle on={!!f.filters.attach} onClick={() => set({ attach: !f.filters.attach })}>
          <Paperclip /> Files
        </Toggle>
        {showWhere && <Pick label="Where it lives" value={f.filters.in ?? "any"} onChange={(v) => set({ in: v === "any" ? undefined : v })} options={WHERE} />}
        <Pick label="How recent" value={f.filters.days ? String(f.filters.days) : "any"} onChange={(v) => set({ days: v === "any" ? undefined : Number(v) })} options={PERIOD} />
        {(labels.data?.length ?? 0) > 0 && (
          <Pick label="Label" value={f.label || "any"} onChange={(v) => f.setLabel(v === "any" ? "" : v)} options={[["any", "Any label"], ...(labels.data ?? []).map((l) => [l.id, l.name] as const)]} />
        )}
        {f.active && (
          <button type="button" onClick={f.clear} className={cn(chip, "inline-flex items-center gap-1 text-muted-foreground active:opacity-70")}>
            <X size={14} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
