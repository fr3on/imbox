import { BrandIcon } from "./BrandIcons";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AiConversation } from "@shared/types";
import { ArrowLeft, MessageSquare, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { useAiConversations, useAiMutations, useBundle, useThread } from "../api";
import { assistant, useAssistant, type ContextChip } from "../lib/assistantStore";
import { fmtRelative } from "../lib/format";
import { AssistantChat } from "./AssistantChat";
import { ThreadPicker } from "./Pickers";

function groupByDate(list: AiConversation[]): { label: string; items: AiConversation[] }[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(new Date());
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const groups: Record<string, AiConversation[]> = { Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  for (const c of list) {
    const t = c.updated_at ?? c.created_at;
    groups[t >= today ? "Today" : t >= yesterday ? "Yesterday" : t >= week ? "Previous 7 days" : "Older"].push(c);
  }
  return Object.entries(groups).filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
}

/** Adds the thread on the current page (`/t/:id` or `/bundle/:id`) as a context chip. Returns whether one was found. */
function useCurrentThreadChip(enabled: boolean): ContextChip | null {
  const loc = useLocation();
  const tMatch = /^\/t\/([^/]+)/.exec(loc.pathname);
  const bMatch = /^\/bundle\/([^/]+)/.exec(loc.pathname);
  const thread = useThread(enabled ? tMatch?.[1] : undefined, true);
  const bundle = useBundle(enabled ? bMatch?.[1] : undefined);
  return useMemo(() => {
    if (thread.data) return { id: thread.data.id, subject: thread.data.subject, from: thread.data.last_from.name || thread.data.last_from.email };
    const latest = bundle.data?.bundle.latest;
    if (latest) return { id: latest.id, subject: latest.subject, from: latest.last_from.name || latest.last_from.email };
    return null;
  }, [thread.data, bundle.data]);
}

/** Past chats, in place of the conversation: a search box, the chats by day, and a delete that can be taken back for a few seconds. */
function PastChats({ list, hidden, activeId, onOpen, onDelete, onNew, onBack }: { list: AiConversation[]; hidden: Set<string>; activeId: string | null; onOpen: (id: string) => void; onDelete: (c: AiConversation) => void; onNew: () => void; onBack: () => void }) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((c) => !hidden.has(c.id) && (!q || (c.title || "Untitled").toLowerCase().includes(q)));
  }, [list, hidden, search]);
  const groups = useMemo(() => groupByDate(shown), [shown]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <Button size="icon-sm" variant="ghost" className="size-8 text-muted-foreground" aria-label="Back to the chat" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
        <span className="text-sm font-medium">Past chats</span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={onNew}>
          <BrandIcon name="write" /> New chat
        </Button>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <BrandIcon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-9 w-full rounded-lg border border-border bg-muted/40 pl-8 pr-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">{search ? "No chat matches that." : "Your chats will be listed here."}</p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-1">
              <div className="px-2.5 pb-1 pt-3 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{g.label}</div>
              {g.items.map((c) => (
                <div key={c.id} className={cn("group/row flex items-center gap-1 rounded-lg pr-1 hover:bg-muted/60", c.id === activeId && "bg-muted")}>
                  <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">{c.title || "Untitled"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtRelative(c.updated_at ?? c.created_at)}</span>
                  </button>
                  <Button size="icon-xs" variant="ghost" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${c.title || "this chat"}`} onClick={() => onDelete(c)}>
                    <BrandIcon name="trash" />
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * The assistant, docked on every page. Collapsed it is one rounded input card at the bottom centre; click into it (or press ⌘J) and it grows upward
 * into a panel that holds the conversation. There is no toolbar: the chat's name sits faintly at the top, and past chats, a new chat and attaching a
 * thread are in the card's + menu. Esc folds it back down. The page behind it, a thread you are reading for instance, stays where it is.
 */
export function AssistantPanel() {
  const st = useAssistant();
  const expanded = st.open;
  const loc = useLocation();
  const convs = useAiConversations();
  const m = useAiMutations();
  const isThread = loc.pathname.startsWith("/t/") || loc.pathname.startsWith("/bundle/");
  // On a thread the action bar is the one dock at the bottom, with an "Ask AI" button at its end; the assistant only appears once opened.
  const inThreadDock = loc.pathname.startsWith("/t/");
  const current = useCurrentThreadChip(isThread);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");

  // Opening on a thread attaches it once; you can take it off.
  useEffect(() => {
    if (expanded && current) assistant.addContext(current);
  }, [expanded, current?.id]);
  useEffect(() => {
    if (!expanded) setView("chat");
  }, [expanded]);

  const newChat = useCallback(() => {
    assistant.newChat();
    setView("chat");
    assistant.focusInput();
  }, []);

  // ⌘J opens and closes it. ⌘⇧O starts a new chat while it is open.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "j" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        assistant.toggle();
      } else if (k === "o" && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && assistant.get().open) {
        e.preventDefault();
        e.stopPropagation();
        newChat();
      }
    };
    window.addEventListener("keydown", fn, true);
    return () => window.removeEventListener("keydown", fn, true);
  }, [newChat]);

  // Esc goes back from the list of chats to the chat, then folds the panel to the card, unless a menu or the thread picker wants the key first.
  useEffect(() => {
    if (!expanded) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || pickerOpen) return;
      if (document.querySelector('[role="menu"],[role="listbox"],[role="dialog"]:not([data-assistant-panel]),[data-slot="popover-content"]')) return;
      e.preventDefault();
      if (view === "history") {
        setView("chat");
        assistant.focusInput();
        return;
      }
      (document.activeElement as HTMLElement | null)?.blur();
      assistant.close();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [expanded, pickerOpen, view]);

  // Deleting a chat waits five seconds, so it can be taken back. Leaving the page flushes whatever is still waiting.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const pending = useRef(new Map<string, number>());
  const deleteNow = useCallback(
    (id: string) => {
      pending.current.delete(id);
      m.deleteConversation.mutate(id, { onSettled: () => setHidden((h) => { const n = new Set(h); n.delete(id); return n; }) });
      if (assistant.get().conversationId === id) assistant.newChat();
    },
    [m.deleteConversation]
  );
  const deleteChat = (c: AiConversation) => {
    setHidden((h) => new Set(h).add(c.id));
    const timer = window.setTimeout(() => deleteNow(c.id), 5000);
    pending.current.set(c.id, timer);
    toast("Chat deleted", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          window.clearTimeout(timer);
          pending.current.delete(c.id);
          setHidden((h) => { const n = new Set(h); n.delete(c.id); return n; });
        },
      },
    });
  };
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const [id, timer] of waiting) {
        window.clearTimeout(timer);
        deleteNow(id);
      }
    };
  }, [deleteNow]);

  const title = useMemo(() => (st.conversationId ? convs.data?.find((c) => c.id === st.conversationId)?.title || "" : ""), [convs.data, st.conversationId]);

  if (inThreadDock && !expanded) return null;

  return (
    <div
      data-assistant-panel=""
      className={cn(
        "fixed z-40 left-1/2 -translate-x-1/2 w-[min(720px,calc(100vw-32px))]",
        // Only a thread has an action bar under it; a bundle page does not, so there the box sits at the usual place.
        inThreadDock ? "bottom-18 sm:bottom-20" : expanded ? "bottom-5" : "bottom-2",
        expanded && "flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
      )}
      style={expanded ? { height: `min(600px, calc(100svh - ${inThreadDock ? 200 : 140}px))` } : undefined}
    >
      <div className={cn("relative", expanded && "min-h-0 flex-1")}>
        {expanded && view === "history" ? (
          <PastChats
            list={convs.data ?? []}
            hidden={hidden}
            activeId={st.conversationId}
            onOpen={(id) => {
              assistant.setConversation(id);
              setView("chat");
              assistant.focusInput();
            }}
            onDelete={deleteChat}
            onNew={newChat}
            onBack={() => setView("chat")}
          />
        ) : (
          <div className={cn("flex flex-col", expanded && "h-full")}>
            {expanded && (
              <div className="relative flex h-10 shrink-0 items-center justify-center px-12">
                <span className="truncate text-xs text-muted-foreground">{title}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon-sm" variant="ghost" className="absolute right-2 top-1.5 size-7 text-muted-foreground hover:text-foreground" aria-label="Close assistant" onClick={() => assistant.close()}>
                      <X size={15} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Close <Kbd className="ml-1">esc</Kbd>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            <div className={cn(expanded && "min-h-0 flex-1")}>
              <AssistantChat
                variant="dock"
                expanded={expanded}
                onNewChat={newChat}
                onOpenHistory={() => {
                  if (!assistant.get().open) assistant.open();
                  setView("history");
                }}
                onExpand={() => !assistant.get().open && assistant.open()}
                conversationId={st.conversationId ?? undefined}
                onConversationId={(id) => assistant.setConversation(id)}
                context={st.context}
                onRemoveContext={(id) => assistant.removeContext(id)}
                onAddContext={() => setPickerOpen(true)}
              />
            </div>
          </div>
        )}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <span className="absolute left-1/2 -translate-x-1/2 bottom-20 size-px" aria-hidden />
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-[360px] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
            <ThreadPicker
              placeholder="Search a thread to attach…"
              hint="Pick a thread to give the assistant as context."
              exclude={st.context.map((c) => c.id)}
              onPick={(t) => {
                assistant.addContext({ id: t.id, subject: t.subject, from: t.last_from.name || t.last_from.email });
                setPickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
