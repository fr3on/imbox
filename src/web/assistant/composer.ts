import type { ContextChip } from "@/lib/assistantStore";
import type { Turn } from "./turns";

/** What both boxes you type in are given. The docked one and the panel one differ in how they look, not in what they do. */
export interface ComposerProps {
  input: string;
  setInput: (v: string) => void;
  onInputChange: (v: string) => void;
  send: (text: string) => void | Promise<void>;
  stop: () => void;
  busy: boolean;
  notConfigured: boolean | undefined;
  all: Turn[];
  conversationId?: string;
  context: ContextChip[];
  onRemoveContext?: (id: string) => void;
  onAddContext?: () => void;
  onOpenHistory?: () => void;
  onNewChat?: () => void;
  onExpand?: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  page: boolean;
  collapsed: boolean;
}
