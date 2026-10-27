// Every keyboard shortcut in the app. The cheat sheet (press ?) and the features page both read this list, so neither can promise a key that does not exist.

export interface ShortcutItem {
  action: string;
  keys: string;
  keywords?: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "General & Navigation",
    items: [
      { action: "Search & commands", keys: "⌘K or /", keywords: "find palette spot" },
      { action: "Focus AI Assistant", keys: "⌘J", keywords: "ai chat bot prompt" },
      { action: "Toggle sidebar", keys: "⌘B", keywords: "collapse rail" },
      { action: "Compose email", keys: "c", keywords: "write new message" },
      { action: "Mail ⇄ Calendar", keys: "0", keywords: "switch flip" },
      { action: "Back to Imbox", keys: "i", keywords: "home inbox" },
      { action: "Move down / up", keys: "j / k or ↓ / ↑", keywords: "navigate next previous" },
      { action: "Open thread or item", keys: "↵ or o", keywords: "enter select" },
      { action: "Jump to sidebar", keys: "←", keywords: "focus left" },
      { action: "Focus the Assistant", keys: "→", keywords: "right chat" },
      { action: "Back / close / clear", keys: "esc", keywords: "exit dismiss" },
      { action: "This cheat sheet", keys: "? or F1", keywords: "help shortcuts super" },
    ],
  },
  {
    title: "Lists & Triage",
    items: [
      { action: "Select thread", keys: "x", keywords: "bulk check mark" },
      { action: "Reply later", keys: "l", keywords: "queue answer" },
      { action: "Set aside", keys: "a", keywords: "pin bookmark save" },
      { action: "Bubble up (snooze)", keys: "z", keywords: "sleep remind" },
      { action: "Done (mark seen)", keys: "e", keywords: "archive read finish" },
      { action: "Mark unread", keys: "u", keywords: "new unsee" },
      { action: "Trash", keys: "#", keywords: "delete remove" },
    ],
  },
  {
    title: "Thread & Reading",
    items: [
      { action: "Move messages", keys: "j / k or ↓ / ↑", keywords: "next previous" },
      { action: "Expand / collapse", keys: "↵ or o", keywords: "toggle fold" },
      { action: "Reply", keys: "r", keywords: "respond write" },
      { action: "Forward", keys: "f", keywords: "share email" },
      { action: "Add note", keys: "n", keywords: "private memo" },
      { action: "Trash & leave", keys: "#", keywords: "delete return" },
    ],
  },
  {
    title: "Composer & Writing",
    items: [
      { action: "Send message", keys: "⌘↵ or Ctrl+↵", keywords: "submit deliver" },
      { action: "Undo send", keys: "q", keywords: "cancel stop recall" },
      { action: "Jump to body", keys: "↵", keywords: "subject editor enter" },
      { action: "Save draft & close", keys: "esc", keywords: "cancel exit" },
    ],
  },
  {
    title: "The Screener",
    items: [
      { action: "Move senders", keys: "j / k or ↓ / ↑", keywords: "navigate waiting" },
      { action: "Approve (Yes)", keys: "y", keywords: "accept allow" },
      { action: "Screen out (No)", keys: "n", keywords: "block reject" },
      { action: "Route Imbox / Feed", keys: "1 / 2", keywords: "destination" },
    ],
  },
  {
    title: "Feed",
    items: [
      { action: "Scroll cards", keys: "j / k or ↓ / ↑", keywords: "read feed news" },
      { action: "Scroll page", keys: "space or PgDn", keywords: "page fast" },
      { action: "Done with card", keys: "e", keywords: "archive read seen" },
    ],
  },
  {
    title: "Calendar",
    items: [
      { action: "Today", keys: "t", keywords: "present date now" },
      { action: "Day / week / month / year", keys: "d / w / m / y", keywords: "view agenda" },
      { action: "New event", keys: "n", keywords: "meeting schedule add" },
      { action: "Move days & weeks", keys: "← → or ↑ ↓", keywords: "navigate arrows" },
    ],
  },
];
