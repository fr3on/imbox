import { Link } from "react-router-dom";
import type { Suggestions } from "./suggestions";

export function Hello({ notConfigured }: { notConfigured: boolean | undefined }) {
  return (
    <div className="text-center mb-5 px-4">
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">How can I help you today?</h1>
      <p className="text-sm text-muted-foreground mt-2">Read, search and organise your mail, screen senders, or draft a reply.</p>
      {notConfigured && (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link to="/settings/ai" className="font-medium text-foreground underline underline-offset-2">Add your AI key</Link> in Settings to get started.
        </p>
      )}
    </div>
  );
}

export function Chips({ notConfigured, suggestions, send, setInput, inputRef }: { notConfigured: boolean | undefined; suggestions: Suggestions["suggestions"]; send: (text: string) => void | Promise<void>; setInput: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  return notConfigured ? null : (
    <div className="flex flex-wrap justify-center gap-2">
      {suggestions.map((c) => (
        <button
          key={c.prompt}
          type="button"
          onClick={() => {
            if (/\s$/.test(c.prompt)) { setInput(c.prompt); inputRef.current?.focus(); } else send(c.prompt);
          }}
          className="inline-flex items-center h-9 px-3.5 rounded-full border border-border/70 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function PanelEmpty({ notConfigured, emptyCards, setInput, inputRef }: { notConfigured: boolean | undefined; emptyCards: Suggestions["emptyCards"]; setInput: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  return (
    <div className="py-10 px-4 text-center max-w-lg mx-auto">
      <h3 className="text-base font-semibold tracking-tight text-foreground">How can I help you today?</h3>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
        I can read, search and organize your mail, screen senders, and write drafts for you to send.
      </p>
      {notConfigured ? (
        <div className="mt-5 p-3 rounded-xl bg-muted/60 border border-border/60 text-xs text-muted-foreground">
          <Link to="/settings/ai" className="font-medium text-foreground underline underline-offset-2">
            Add your Anthropic API key
          </Link>{" "}
          in Settings to get started.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
          {emptyCards.map((card) => (
            <button
              key={card.prompt}
              type="button"
              onClick={() => { setInput(card.prompt); inputRef.current?.focus(); }}
              className="p-3 rounded-xl border border-border/70 bg-card/60 hover:bg-muted/80 hover:border-primary/40 hover:shadow-xs transition-all text-left group outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                  {card.title}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">
                {card.desc}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
