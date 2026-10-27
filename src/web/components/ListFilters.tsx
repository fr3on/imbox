import { BrandIcon } from "./BrandIcons";
import { useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLabels, type ThreadFilters } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ListFilterState {
  q: string;
  label: string;
  filters: ThreadFilters;
}

const ANY = "any";
const WHERE: { value: string; label: string }[] = [
  { value: ANY, label: "Everywhere" },
  { value: "imbox", label: "Imbox" },
  { value: "feed", label: "Feed" },
  { value: "screener", label: "Screener" },
];
const PERIOD: { value: string; label: string }[] = [
  { value: ANY, label: "Any time" },
  { value: "1", label: "Last day" },
  { value: "7", label: "Last week" },
  { value: "30", label: "Last month" },
  { value: "365", label: "Last year" },
];

export function useListFilters() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  const [filters, setFilters] = useState<ThreadFilters>({});
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const active = !!q || !!label || !!filters.in || !!filters.unread || !!filters.attach || !!filters.days;
  const clear = () => {
    setText("");
    setQ("");
    setLabel("");
    setFilters({});
  };
  return { text, setText, state: { q, label, filters } as ListFilterState, label, setLabel, filters, setFilters, active, clear };
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors [&>svg]:size-3.5",
        on ? "bg-foreground text-background" : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

const trigger = "h-7 w-auto gap-1.5 border-transparent bg-muted/60 px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted";

/** Search box and filters for a thread list: what it says, where it lives, whether it is unread, has files, is labelled, is recent. */
export function ListFilters({ f, showWhere }: { f: ReturnType<typeof useListFilters>; showWhere?: boolean }) {
  const labels = useLabels();
  const set = (patch: Partial<ThreadFilters>) => f.setFilters((cur) => ({ ...cur, ...patch }));
  return (
    <div className="mb-3 flex flex-col gap-2 px-2">
      <div className="relative max-w-md">
        <BrandIcon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={f.text} onChange={(e) => f.setText(e.target.value)} placeholder="Search subjects, people and what they said" aria-label="Search this list" className="pl-8" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip on={!!f.filters.unread} onClick={() => set({ unread: !f.filters.unread })}>Unread</Chip>
        <Chip on={!!f.filters.attach} onClick={() => set({ attach: !f.filters.attach })}>
          <Paperclip /> Attachments
        </Chip>
        {showWhere && (
          <Select value={f.filters.in ?? ANY} onValueChange={(v) => set({ in: v === ANY ? undefined : v })}>
            <SelectTrigger size="sm" className={trigger} aria-label="Where it lives">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHERE.map((w) => (
                <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={f.filters.days ? String(f.filters.days) : ANY} onValueChange={(v) => set({ days: v === ANY ? undefined : Number(v) })}>
          <SelectTrigger size="sm" className={trigger} aria-label="How recent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(labels.data?.length ?? 0) > 0 && (
          <Select value={f.label || ANY} onValueChange={(v) => f.setLabel(v === ANY ? "" : v)}>
            <SelectTrigger size="sm" className={trigger} aria-label="Label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any label</SelectItem>
              {labels.data?.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {f.active && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={f.clear}>
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
