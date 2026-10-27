import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUp, Paperclip, Plus, Square, X } from "lucide-react";
import { focus } from "@/lib/focusStore";
import type { ComposerProps } from "./composer";

export function PanelComposer({ input, setInput, send, stop, busy, notConfigured, context, onRemoveContext, onAddContext, onExpand, inputRef, autoFocus, page, collapsed }: ComposerProps) {
  return (
    <form
      className={page ? "w-full" : "shrink-0 p-3 sm:p-4 pt-2 border-t border-border/50 bg-background/50"}
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
    >
      <div className={cn("border border-border/70 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all", page ? cn("rounded-2xl bg-background p-3", collapsed ? "shadow-lg" : "shadow-none") : "rounded-xl bg-muted/30 focus-within:bg-background shadow-xs p-2.5")}>
        {context.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {context.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-md bg-background border border-border pl-2 pr-1 h-6 text-[12px] max-w-[240px]">
                <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.subject || "(no subject)"}</span>
                <span className="truncate text-muted-foreground hidden sm:inline">· {c.from}</span>
                {onRemoveContext && (
                  <button type="button" aria-label="Remove context" onClick={() => onRemoveContext(c.id)} className="size-4 rounded-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted">
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      <div className="flex items-end gap-2">
        {onAddContext && (
          <Button type="button" size="icon-xs" variant="ghost" className="text-muted-foreground hover:text-foreground shrink-0 mb-0.5" onClick={onAddContext} aria-label="Add a thread as context" disabled={!!notConfigured}>
            <Plus size={16} />
          </Button>
        )}
        <textarea
          ref={inputRef}
          data-assistant-input
          onFocus={() => page && onExpand?.()}
          autoFocus={autoFocus}
          value={input}
          onChange={(e) => {
            const v = e.target.value;
            const startsWord = v.length === 1 || /\s$/.test(v.slice(0, -1));
            if (onAddContext && v.endsWith("@") && !input.endsWith("@") && startsWord) {
              setInput(v);
              onAddContext();
              return;
            }
            setInput(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
              return;
            }
            if (e.key === "ArrowLeft" && !input) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
              focus.toContent();
            }
          }}
          rows={1}
          placeholder={notConfigured ? "Add an API key in Settings → AI first" : onAddContext ? "Ask about your mail, @ for context" : "Ask about your mail, or tell me what to write…"}
          disabled={!!notConfigured}
          className={cn("flex-1 resize-none overflow-y-auto bg-transparent outline-none leading-relaxed placeholder:text-muted-foreground/60 py-1", page ? "text-[15px]" : "text-[13.5px]")}
        />
        {busy ? (
          <Button type="button" size="icon-sm" variant="outline" onClick={stop} aria-label="Stop" className="size-8 rounded-lg shrink-0 mb-0.5"><Square className="size-3.5 fill-current" /></Button>
        ) : (
          <Button type="submit" size="icon-sm" disabled={!input.trim() || !!notConfigured} aria-label="Send" className="size-8 rounded-lg bg-foreground text-background hover:bg-foreground/90 disabled:pointer-events-none transition-all shadow-xs shrink-0 mb-0.5"><ArrowUp size={15} /></Button>
        )}
      </div>
      </div>
      {!collapsed && <div className="flex items-center justify-between text-[11px] text-muted-foreground/70 mt-1.5 px-1">
        <span>Drafts are never sent without your confirmation</span>
        <span className="hidden sm:inline">↵ send · Shift+↵ new line</span>
      </div>}
    </form>
  );
}
