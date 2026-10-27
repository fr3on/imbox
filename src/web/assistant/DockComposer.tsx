import { BrandIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowUp, History, Paperclip, Plus, Square, X } from "lucide-react";
import type { ComposerProps } from "./composer";

  /**
   * The docked assistant: one rounded card, the way Claude's own input looks. Attached threads sit inside it above the text, a round + at
   * the bottom left holds the extras, and a round button sends. Enter sends, Shift+Enter starts a new line.
   */
export function DockComposer({ input, onInputChange, send, stop, busy, notConfigured, all, conversationId, context, onRemoveContext, onAddContext, onOpenHistory, onNewChat, onExpand, inputRef }: ComposerProps) {
  return (
    <form className="w-full px-3 pb-3 pt-1" onSubmit={(e) => { e.preventDefault(); send(input); }}>
      <div className="rounded-[20px] border border-border bg-background px-3.5 pb-2.5 pt-3 shadow-sm transition-colors focus-within:border-foreground/30">
        {context.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {context.map((c) => (
              <span key={c.id} className="inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-lg bg-muted/70 pl-2 pr-1 text-[12.5px]">
                <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{c.subject || "(no subject)"}</span>
                {onRemoveContext && (
                  <button type="button" aria-label="Remove context" onClick={() => onRemoveContext(c.id)} className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          data-assistant-input
          onFocus={() => onExpand?.()}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder={notConfigured ? "Add an API key in Settings → AI first" : all.length ? "Reply to the assistant" : "Ask about your mail, @ for context"}
          disabled={!!notConfigured}
          className="block w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon-sm" className="size-8 rounded-full text-muted-foreground" aria-label="More: past chats, new chat, attach a thread" disabled={!!notConfigured}>
                <Plus size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-60 rounded-xl p-1.5">
              {onOpenHistory && (
                <DropdownMenuItem onSelect={onOpenHistory}>
                  <History /> Past chats
                </DropdownMenuItem>
              )}
              {onNewChat && (
                <DropdownMenuItem onSelect={onNewChat} disabled={!conversationId && all.length === 0}>
                  <BrandIcon name="write" /> New chat <DropdownMenuShortcut>⌘⇧O</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              {onAddContext && (
                <DropdownMenuItem onSelect={onAddContext}>
                  <Paperclip /> Attach a thread <DropdownMenuShortcut>@</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-[11.5px] leading-snug text-muted-foreground">Drafts are never sent without your confirmation.</p>
            </DropdownMenuContent>
          </DropdownMenu>
          {busy ? (
            <Button type="button" variant="outline" size="icon-sm" onClick={stop} aria-label="Stop" className="size-8 rounded-full"><Square className="size-3.5 fill-current" /></Button>
          ) : (
            <Button type="submit" size="icon-sm" disabled={!input.trim() || !!notConfigured} aria-label="Send" className="size-8 rounded-full bg-foreground text-background hover:bg-foreground/90"><ArrowUp size={16} /></Button>
          )}
        </div>
      </div>
    </form>
  );
}
