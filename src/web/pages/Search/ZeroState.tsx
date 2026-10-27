import { X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { BrandIcon } from "../../components/BrandIcons";
import type { SavedSearch } from "../../api";

/** Requests to try, shown before anything is typed. Each one is read the way a typed request is. */
export const EXAMPLES = [
  "invoices from last month",
  "unread mail with attachments",
  "receipts since March",
  "what did we agree about the budget?",
];

export function ZeroState({
  savedSearches,
  recent,
  onSubmitExample,
  onGo,
  onRemoveSaved,
}: {
  savedSearches?: SavedSearch[];
  recent: string[];
  onSubmitExample: (query: string) => void;
  onGo: (query: string) => void;
  onRemoveSaved: (id: string) => void;
}) {
  return (
    <div className="text-center py-12 px-4 rounded-2xl border border-border/60 bg-card/40 mt-4">
      <div className="size-12 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3 text-muted-foreground">
        <BrandIcon name="search" size={22} />
      </div>
      <h2 className="text-base font-semibold text-foreground">Search everything in inbox</h2>
      <p className="text-xs sm:text-[13px] text-muted-foreground mt-1 max-w-md mx-auto">
        Find emails, message content, senders, contacts, downloaded attachments, and calendar meetings in one place.
      </p>
      <div className="mx-auto mt-5 max-w-lg text-left">
        <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Try asking</div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => void onSubmitExample(e)}
              className="max-w-full truncate rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      {(savedSearches?.length ?? 0) > 0 && (
        <div className="mx-auto mt-6 max-w-lg text-left">
          <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Saved searches</div>
          <div className="flex flex-wrap gap-1.5">
            {savedSearches?.map((x) => (
              <span key={x.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2.5 pr-1 text-xs">
                <button type="button" className="min-w-0 truncate hover:underline" onClick={() => onGo(x.query)}>
                  {x.name}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${x.name}`}
                  className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onRemoveSaved(x.id)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div className="mx-auto mt-6 max-w-lg text-left">
          <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Recent searches</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onGo(r)}
                className="max-w-full truncate rounded-full border border-border/60 bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11.5px] text-muted-foreground/70 mt-6 flex items-center justify-center gap-1.5">
        Tip: Press <Kbd className="font-mono text-[10px]">⌘K</Kbd> from anywhere to trigger quick search.
      </p>
    </div>
  );
}
