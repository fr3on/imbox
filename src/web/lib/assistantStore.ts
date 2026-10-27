import { useEffect, useState } from "react";

export interface ContextChip {
  id: string;
  subject: string;
  from: string;
}

export type AssistantMode = "float" | "dock";

interface AssistantState {
  open: boolean;
  /** float = compact window bottom-right; dock = full-height side panel that pushes the app content left. */
  mode: AssistantMode;
  width: number;
  conversationId: string | null;
  context: ContextChip[];
}

const KEY = "hey.assistant";
function load(): AssistantState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<AssistantState>;
      return { open: false, mode: "float", width: clampWidth(j.width), conversationId: j.conversationId ?? null, context: [] };
    }
  } catch {}
  return { open: false, mode: "float", width: 420, conversationId: null, context: [] };
}

let state: AssistantState = load();
const listeners = new Set<() => void>();
function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open: state.open, mode: state.mode, width: state.width, conversationId: state.conversationId }));
  } catch {}
  listeners.forEach((l) => l());
}
export const MIN_W = 320;
export const MAX_W = 720;
export function clampWidth(w: unknown): number {
  const n = typeof w === "number" && Number.isFinite(w) ? w : 420;
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)));
}

function set(patch: Partial<AssistantState>) {
  state = { ...state, ...patch };
  emit();
}

export const assistant = {
  get: () => state,
  /** Expands the assistant over the current page: no navigation, the page underneath stays as it was. */
  open(conversationId?: string | null, context?: ContextChip[]) {
    set({ open: true, conversationId: conversationId === undefined ? state.conversationId : conversationId, context: context ?? state.context });
    assistant.focusInput();
  },
  close() {
    set({ open: false });
  },
  toggle() {
    if (state.open) assistant.close();
    else assistant.open();
  },
  /**
   * Start a new chat with the question filled in, focused and ready to send. Where the assistant is a page of its own (a phone), the caller goes
   * there first and passes `panel: false`; the box is waited for either way, since a page takes a moment to arrive.
   */
  ask(text: string, o: { panel?: boolean } = {}) {
    assistant.newChat();
    if (o.panel !== false) set({ open: true });
    let tries = 0;
    const fill = () => {
      const el = document.querySelector<HTMLTextAreaElement>("[data-assistant-input]");
      if (el && !el.disabled) {
        // A controlled input only learns of a change that arrives as an input event.
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.focus();
        el.setSelectionRange(text.length, text.length);
        return;
      }
      if (tries++ < 50) window.setTimeout(fill, 40);
    };
    fill();
  },
  focusInput() {
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLTextAreaElement>("[data-assistant-input]");
      if (el && !el.disabled) {
        el.focus();
        return;
      }
      if (tries++ < 8) window.setTimeout(focus, 40);
    };
    focus();
  },
  setMode: (mode: AssistantMode) => set({ mode }),
  toggleMode: () => set({ mode: state.mode === "dock" ? "float" : "dock" }),
  setWidth: (w: number) => set({ width: clampWidth(w) }),
  setConversation: (id: string | null) => set({ conversationId: id, context: id === state.conversationId ? state.context : [] }),
  newChat: () => set({ conversationId: null, context: [] }),
  addContext(chip: ContextChip) {
    if (state.context.some((c) => c.id === chip.id)) return;
    set({ context: [...state.context, chip].slice(-3) });
  },
  removeContext: (id: string) => set({ context: state.context.filter((c) => c.id !== id) }),
  clearContext: () => set({ context: [] }),
};

export function useAssistant(): AssistantState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state;
}
