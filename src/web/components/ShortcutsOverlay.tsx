import { BrandIcon } from "./BrandIcons";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SHORTCUT_GROUPS as GROUPS } from "../lib/shortcuts";

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;

    return GROUPS.map((g) => ({
      title: g.title,
      items: g.items.filter(
        (it) =>
          it.action.toLowerCase().includes(q) ||
          it.keys.toLowerCase().includes(q) ||
          (it.keywords?.toLowerCase().includes(q))
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-6 gap-4">
        <DialogHeader className="gap-1 text-left">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold tracking-tight">
              Keyboard shortcuts
            </DialogTitle>
            <span className="text-[11px] font-mono text-muted-foreground mr-6">
              ? or F1
            </span>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            The whole app works without a mouse. Vim navigation (<Kbd className="text-[10.5px] px-1 py-0">j</Kbd> / <Kbd className="text-[10.5px] px-1 py-0">k</Kbd>) supported throughout.
          </DialogDescription>
        </DialogHeader>

        {/* Minimal Search input */}
        <div className="relative">
          <BrandIcon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter shortcuts (e.g. reply, search, calendar)..."
            className="w-full h-8 pl-8 pr-7 rounded-md border border-border/70 bg-muted/30 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-foreground/40 focus:bg-background transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {/* Content columns */}
        <div className="flex-1 overflow-y-auto pr-1">
          {filteredGroups.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No shortcuts matching "{query}"
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5 pt-1">
              {filteredGroups.map((g) => (
                <div key={g.title} className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {g.title}
                  </div>
                  <div className="space-y-1">
                    {g.items.map((it) => (
                      <div
                        key={it.action}
                        className="flex items-center justify-between gap-3 text-[12.5px] py-0.5"
                      >
                        <span className="text-foreground/90 truncate">{it.action}</span>
                        <Kbd className="font-mono text-[11px] px-1.5 py-0.5 shrink-0 bg-muted border border-border/70">
                          {it.keys}
                        </Kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
