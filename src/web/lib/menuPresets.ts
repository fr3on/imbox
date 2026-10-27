import { useSyncExternalStore } from "react";

/** Every page that can be a tab in the top menu. "trays" is a group: Reply Later, Set Aside and Bubble Up. */
export type TabId =
  | "imbox" | "screener" | "updates" | "trays" | "contacts" | "calendar"
  | "drafts" | "sent" | "scheduled" | "everything" | "previously_seen" | "screened_out" | "trash"
  | "files" | "clips" | "collections" | "labels" | "workflows" | "logs";

export interface Destination {
  id: TabId;
  label: string;
  /** The page it opens (for "trays", its first page). */
  to: string;
  /** Paths that count as being on it, so the right tab lights up. */
  match: string[];
  /** Where it sits in the More menu when it is not a tab. */
  group: "Writing" | "Browse all mail" | "Library" | "Main";
  /** "/" is only itself, not every page under it. */
  exact?: boolean;
}

export const DESTINATIONS: Destination[] = [
  { id: "imbox", label: "Imbox", to: "/", match: ["/"], exact: true, group: "Main" },
  { id: "screener", label: "Screener", to: "/screener", match: ["/screener"], group: "Main" },
  // Feeds and Paper Trail share one page. The old addresses still lead there.
  { id: "updates", label: "Feed", to: "/feed", match: ["/feed", "/updates", "/paper-trail"], group: "Main" },
  { id: "trays", label: "Trays", to: "/reply-later", match: ["/reply-later", "/set-aside", "/bubble-up"], group: "Main" },
  { id: "contacts", label: "Contacts", to: "/contacts", match: ["/contacts"], group: "Library" },
  { id: "calendar", label: "Calendar", to: "/calendar", match: ["/calendar"], group: "Library" },
  { id: "drafts", label: "Drafts", to: "/drafts", match: ["/drafts"], group: "Writing" },
  { id: "sent", label: "Sent", to: "/sent", match: ["/sent"], group: "Writing" },
  { id: "scheduled", label: "Scheduled", to: "/scheduled", match: ["/scheduled"], group: "Writing" },
  { id: "everything", label: "Everything", to: "/everything", match: ["/everything"], group: "Browse all mail" },
  { id: "previously_seen", label: "Previously Seen", to: "/previously-seen", match: ["/previously-seen"], group: "Browse all mail" },
  { id: "screened_out", label: "Screened out", to: "/screened-out", match: ["/screened-out"], group: "Browse all mail" },
  { id: "trash", label: "Trash", to: "/trash", match: ["/trash"], group: "Browse all mail" },
  { id: "files", label: "Files", to: "/files", match: ["/files"], group: "Library" },
  { id: "clips", label: "Clips", to: "/clips", match: ["/clips"], group: "Library" },
  { id: "collections", label: "Collections", to: "/collections", match: ["/collections"], group: "Library" },
  { id: "labels", label: "Labels", to: "/labels", match: ["/labels"], group: "Library" },
  { id: "workflows", label: "Workflows", to: "/workflows", match: ["/workflows"], group: "Library" },
  { id: "logs", label: "Activity", to: "/logs", match: ["/logs"], group: "Library" },
];

export type PresetId = "complete" | "triage" | "support" | "scheduler" | "minimal";

/** What can sit in the phone's bottom bar. The assistant has a tab of its own there. */
export type MobileTab = "imbox" | "screener" | "updates" | "contacts" | "calendar" | "sent" | "assistant";

export interface Preset {
  id: PresetId;
  label: string;
  /** The tabs in the phone's bottom bar, before its More tab. Four at most: a fifth would squeeze every label. */
  mobile: MobileTab[];
  /** A few words on what it is for. */
  blurb: string;
  tabs: TabId[];
}

/** Ways of working, each with the tabs that suit it. Everything else is one click away under More. */
export const PRESETS: Preset[] = [
  { id: "complete", label: "Full", mobile: ["imbox", "assistant", "calendar", "screener"], blurb: "Mail, contacts, calendar", tabs: ["imbox", "screener", "updates", "trays", "contacts", "calendar"] },
  { id: "triage", label: "Sort", mobile: ["imbox", "screener", "updates", "contacts"], blurb: "Just sort what comes in", tabs: ["imbox", "screener", "updates", "trays"] },
  { id: "support", label: "Reply", mobile: ["imbox", "screener", "contacts", "sent"], blurb: "Answer people, track who", tabs: ["imbox", "trays", "sent", "drafts", "contacts", "screener"] },
  { id: "scheduler", label: "Plan", mobile: ["imbox", "calendar", "contacts", "assistant"], blurb: "Mail beside your calendar", tabs: ["imbox", "calendar", "contacts", "trays", "sent"] },
  { id: "minimal", label: "Focus", mobile: ["imbox", "calendar", "assistant"], blurb: "Only the essentials", tabs: ["imbox", "screener", "calendar"] },
];

export const DEFAULT_PRESET: PresetId = "complete";

const byId = new Map(DESTINATIONS.map((d) => [d.id, d]));
export const destination = (id: TabId): Destination => byId.get(id)!;

export const isPreset = (v: unknown): v is PresetId => typeof v === "string" && PRESETS.some((p) => p.id === v);
export const presetById = (id: PresetId): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** Whether a path is on a destination. */
export function onDestination(d: Destination, pathname: string): boolean {
  return d.exact ? pathname === d.to : d.match.some((m) => pathname.startsWith(m));
}

/** What is not a tab in this preset, grouped for the More menu, in a steady order. Imbox and the like are never in it: they are always tabs or, at worst, listed under "Main". */
export function moreGroups(tabs: TabId[]): { label: string; items: Destination[] }[] {
  const shown = new Set(tabs);
  const order: Destination["group"][] = ["Main", "Writing", "Browse all mail", "Library"];
  return order
    .map((label) => ({ label: label === "Main" ? "Mail" : label, items: DESTINATIONS.filter((d) => d.group === label && !shown.has(d.id)) }))
    .filter((g) => g.items.length > 0);
}

/* ---------- the chosen preset: remembered on this device ---------- */

const KEY = "inbox.menu_preset";
const listeners = new Set<() => void>();

function read(): PresetId {
  try {
    const v = localStorage.getItem(KEY);
    if (isPreset(v)) return v;
  } catch {
    /* private mode */
  }
  return DEFAULT_PRESET;
}

let current: PresetId = read();

export function setMenuPreset(id: PresetId): void {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* it lasts until reload */
  }
  listeners.forEach((l) => l());
}

export function useMenuPreset(): Preset {
  const id = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => DEFAULT_PRESET,
  );
  return presetById(id);
}
