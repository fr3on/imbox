
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { aiChatStream, useAiConversation, useAiSettings, type AiSseEvent } from "@/api";
import type { ContextChip } from "@/lib/assistantStore";
import { applyEvent, turnsFromStored, type Turn } from "../assistant/turns";
import { DockComposer } from "../assistant/DockComposer";
import { Chips, Hello, PanelEmpty } from "../assistant/EmptyState";
import { PanelComposer } from "../assistant/PanelComposer";
import { suggestionsFor } from "../assistant/suggestions";
import { Transcript } from "../assistant/Transcript";


/** Past this the box stops growing and scrolls instead, so the conversation never leaves the screen. */
const INPUT_MAX_PX = 160;

export function AssistantChat({
  conversationId,
  onConversationId,
  compact,
  context = [],
  onRemoveContext,
  onAddContext,
  autoFocus, onClose, variant, expanded, onExpand, onNewChat, onOpenHistory }: {
  conversationId?: string;
  onConversationId: (id: string) => void;
  compact?: boolean;
  /** Threads attached as context for the next message (panel mode). */
  context?: ContextChip[];
  onRemoveContext?: (id: string) => void;
  /** Opens the thread picker ("+" button and typing "@"). */
  onAddContext?: () => void;
  autoFocus?: boolean; onClose?: () => void;
  /** "dock": the desktop assistant. The composer stays at the bottom of whatever page you are on and the conversation opens above it. */
  variant?: "dock";
  expanded?: boolean;
  onNewChat?: () => void;
  /** Opens the list of past chats (the + menu). */
  onOpenHistory?: () => void;
  onExpand?: () => void }) {
  const page = variant === "dock";
  const collapsed = page && !expanded;
  const settings = useAiSettings();
  const conv = useAiConversation(conversationId);
  const qc = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLiveState] = useState<Turn | null>(null);
  const liveRef = useRef<Turn | null>(null);
  /** Keep the streaming turn in a ref too, so events (which arrive outside React's batching) never race a stale closure. */
  const setLive = (next: Turn | null | ((l: Turn | null) => Turn | null)) => {
    liveRef.current = typeof next === "function" ? next(liveRef.current) : next;
    setLiveState(liveRef.current);
  };
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Grow the box to fit what is in it.
   *
   * Counting newlines — which is what this did — only sees the lines someone typed deliberately.
   * A long sentence with no break in it wraps onto four visual lines while still being one string,
   * so the field stayed a single row and the message scrolled out of sight as it was written.
   * Only the browser knows how the text actually wrapped, and `scrollHeight` is where it says so:
   * collapse the height first, or a box that has grown can never measure itself smaller again.
   */
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_PX)}px`;
  }, [input]);
  /** Conversation whose turns are held locally (streamed here); server data must not overwrite them mid-flight or drop transient errors. */
  const streamedConv = useRef<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (busyRef.current) return;
    if (conv.data) {
      if (conv.data.conversation.id === streamedConv.current) return;
      setTurns(turnsFromStored(conv.data.messages as any));
    } else if (!conversationId) {
      streamedConv.current = null;
      setTurns([]);
    }
  }, [conv.data, conversationId]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, live?.text, live?.tools.length]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    onExpand?.();
    setBusy(true);
    busyRef.current = true;
    if (conversationId) streamedConv.current = conversationId;
    const ctx = context.slice(0, 3);
    const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", text: msg, context: ctx, tools: [], drafts: [], eventProposals: [], bulkActionProposals: [], sent: {} };
    const assistant: Turn = { id: `a-${Date.now()}`, role: "assistant", text: "", tools: [], drafts: [], eventProposals: [], bulkActionProposals: [], sent: {} };
    setTurns((t) => [...t, userTurn]);
    setLive(assistant);
    const ac = new AbortController();
    abortRef.current = ac;
    let convId = conversationId;
    try {
      await aiChatStream(
        { conversation_id: conversationId, message: msg, context_thread_ids: ctx.length ? ctx.map((c) => c.id) : undefined },
        (e: AiSseEvent) => {
          if (e.type === "start") {
            convId = e.conversation_id;
            streamedConv.current = e.conversation_id;
            if (!conversationId) onConversationId(e.conversation_id);
          } else setLive((l) => applyEvent(l, e));
        },
        ac.signal
      );
    } catch (e) {
      if (!ac.signal.aborted) setLive((l) => (l ? { ...l, error: (e as Error).message } : { ...assistant, error: (e as Error).message }));
    }
    const finished = liveRef.current;
    if (finished) setTurns((t) => [...t, finished]);
    setLive(null);
    busyRef.current = false;
    setBusy(false);
    abortRef.current = null;
    if (onRemoveContext) for (const c of ctx) onRemoveContext(c.id);
    qc.invalidateQueries({ queryKey: ["ai", "conversations"] });
    // A new chat is named a moment after its reply, so look again once that has had time.
    if (!conversationId) window.setTimeout(() => qc.invalidateQueries({ queryKey: ["ai", "conversations"] }), 3500);
    if (convId) qc.invalidateQueries({ queryKey: ["ai", "conversation", convId] });
    qc.invalidateQueries({ predicate: (q) => ["imbox", "threads", "counts", "screener", "thread", "feed"].includes(String(q.queryKey[0])) });
  };

  const stop = () => abortRef.current?.abort();
  const notConfigured = settings.data && !settings.data.configured;
  const all = live ? [...turns, live] : turns;

  const onInputChange = (v: string) => {
    const startsWord = v.length === 1 || /\s$/.test(v.slice(0, -1));
    if (onAddContext && v.endsWith("@") && !input.endsWith("@") && startsWord) {
      setInput(v);
      onAddContext();
      return;
    }
    setInput(v);
  };

  const composerProps = { input, setInput, onInputChange, send, stop, busy, notConfigured, all, conversationId, context, onRemoveContext, onAddContext, onOpenHistory, onNewChat, onExpand, inputRef, autoFocus, page, collapsed };
  const composer = page ? <DockComposer {...composerProps} /> : <PanelComposer {...composerProps} />;

  const loc = useLocation();
  const path = loc.pathname;
  const hasContext = context.length > 0;
  const { suggestions, emptyCards } = useMemo(() => suggestionsFor(path, hasContext), [path, hasContext]);

  return (
    <div className={cn("flex flex-col min-h-0", !collapsed && "h-full")}>
      {!collapsed && (
      <div className={cn("flex-1 min-h-0 overflow-y-auto", compact || page ? "px-4" : "px-2")}>
        {page && all.length === 0 && (
          <div className="py-8">
            <Hello notConfigured={notConfigured} />
            <Chips notConfigured={notConfigured} suggestions={suggestions} send={send} setInput={setInput} inputRef={inputRef} />
          </div>
        )}
        {all.length === 0 && !page && (
          <PanelEmpty notConfigured={notConfigured} emptyCards={emptyCards} setInput={setInput} inputRef={inputRef} />
        )}
       <Transcript all={all} live={live} page={page} bottomRef={bottomRef} />
      </div>
      )}
      <div className={cn(page && "shrink-0 w-full")}>{composer}</div>
    </div>
  );
}
