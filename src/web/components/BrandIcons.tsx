import type { ReactNode, SVGProps } from "react";

/**
 * imbox's own interface icons, for the things lucide has no picture for: the Imbox, the Screener, a sender, a bundle.
 * Drawn on a 24 grid in the language of the logo (a disc, half solid and half outline), with the same API as a lucide icon:
 * `currentColor`, round caps and joins, 1.75 stroke. Use them beside lucide icons; they are made to sit at the same weight.
 * The /brand page shows the whole sheet from `BRAND_ICONS`.
 */

export type BrandIconName =
  | "imbox"
  | "screener"
  | "let-in"
  | "not-now"
  | "sender"
  | "feed"
  | "paper-trail"
  | "reply-later"
  | "set-aside"
  | "bubble-up"
  | "collection"
  | "assistant"
  | "write"
  | "search"
  | "calendar"
  | "sent"
  | "more"
  | "drafts"
  | "scheduled"
  | "trash"
  | "files"
  | "labels"
  | "clips"
  | "settings"
  | "shortcuts"
  | "about"
  | "appearance"
  | "logout"
  | "menu-style"
  | "security"
  | "accounts"
  | "domains"
  | "agents"
  | "workflows"
  | "integrations"
  | "servers";

type Def = { name: BrandIconName; label: string; means: string; body: ReactNode };

const SOLID = { fill: "currentColor", stroke: "none" } as const;

export const BRAND_ICONS: Def[] = [
  {
    name: "imbox",
    label: "Imbox",
    means: "Mail from people, let in",
    body: (
      <>
        <path d="M10.5 4a8 8 0 0 0 0 16z" {...SOLID} />
        <path d="M13.5 4a8 8 0 0 1 0 16z" />
      </>
    ),
  },
  {
    name: "screener",
    label: "Screener",
    means: "First-time senders, waiting",
    body: <circle cx="12" cy="12" r="8" strokeDasharray="2.2 3.1" />,
  },
  {
    name: "let-in",
    label: "Let in",
    means: "Yes, they can reach you",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.6" {...SOLID} />
      </>
    ),
  },
  {
    name: "not-now",
    label: "Not now",
    means: "No, keep them out",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12h7" />
      </>
    ),
  },
  {
    name: "sender",
    label: "Sender",
    means: "A person or a sender",
    body: (
      <>
        <circle cx="12" cy="8.2" r="3.4" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
  },
  {
    name: "feed",
    label: "The Feed",
    means: "Newsletters and writing to read later",
    body: (
      <>
        <circle cx="5.5" cy="6.5" r="1.6" {...SOLID} />
        <path d="M10 6.5h9M5 12h14M5 17.5h9" />
      </>
    ),
  },
  {
    name: "paper-trail",
    label: "Paper Trail",
    means: "Receipts that only need to exist",
    body: (
      <>
        <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
        <path d="M9.5 8.5h5M9.5 12h5" />
      </>
    ),
  },
  {
    name: "reply-later",
    label: "Reply Later",
    means: "Needs an answer, not yet",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
  },
  {
    name: "set-aside",
    label: "Set Aside",
    means: "Put on the shelf for later",
    body: (
      <>
        <circle cx="12" cy="8.5" r="3.2" />
        <path d="M5 13.5v3.5a2.5 2.5 0 0 0 2.5 2.5h9a2.5 2.5 0 0 0 2.5-2.5v-3.5" />
      </>
    ),
  },
  {
    name: "bubble-up",
    label: "Bubble Up",
    means: "Bring it back to the top",
    body: (
      <>
        <circle cx="12" cy="6" r="2.6" {...SOLID} />
        <path d="M5 13h14M5 18.5h14" />
      </>
    ),
  },
  {
    name: "collection",
    label: "Collection",
    means: "Mail kept together",
    body: (
      <>
        <circle cx="9" cy="12" r="6" />
        <circle cx="15" cy="12" r="6" />
      </>
    ),
  },
  {
    name: "assistant",
    label: "Assistant",
    means: "Helps when you ask",
    body: <path d="M12 3.5l2.2 5.9 5.9 2.2-5.9 2.2L12 19.7l-2.2-5.9-5.9-2.2 5.9-2.2z" />,
  },
  {
    name: "write",
    label: "Write",
    means: "Start a message",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8.5v7M8.5 12h7" />
      </>
    ),
  },
  {
    name: "search",
    label: "Search",
    means: "Find anything, anywhere",
    body: (
      <>
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5 5" />
      </>
    ),
  },
  {
    name: "calendar",
    label: "Calendar",
    means: "Days, with today marked",
    body: (
      <>
        <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
        <path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" />
        <circle cx="12" cy="15" r="1.6" {...SOLID} />
      </>
    ),
  },
  {
    name: "sent",
    label: "Sent",
    means: "Gone out of the door",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8 12h8M13 9l3 3-3 3" />
      </>
    ),
  },
  {
    name: "more",
    label: "More",
    means: "Everything else, one tap away",
    body: <path d="M4 8h16M4 16h16" />,
  },
  {
    name: "drafts",
    label: "Drafts",
    means: "Not finished, still waiting",
    body: (
      <>
        <rect x="5" y="4" width="14" height="16" rx="3" strokeDasharray="2.2 3.1" />
        <path d="M9 12h6" />
      </>
    ),
  },
  {
    name: "scheduled",
    label: "Scheduled",
    means: "Will go out later",
    body: (
      <>
        <circle cx="12" cy="12" r="8" strokeDasharray="2.2 3.1" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
  },
  {
    name: "trash",
    label: "Trash",
    means: "Let go",
    body: (
      <>
        <path d="M5 7h14M9.5 7V4.5h5V7" />
        <path d="M7 7l.8 12.2a1 1 0 0 0 1 .8h6.4a1 1 0 0 0 1-.8L17 7" />
      </>
    ),
  },
  {
    name: "files",
    label: "Files",
    means: "Attachments, kept together",
    body: <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2.5h5.5A2.5 2.5 0 0 1 20 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />,
  },
  {
    name: "labels",
    label: "Labels",
    means: "A name on a thread",
    body: (
      <>
        <path d="M4 5.5V11l8.7 8.7a1.5 1.5 0 0 0 2.1 0l4.9-4.9a1.5 1.5 0 0 0 0-2.1L11 4H5.5A1.5 1.5 0 0 0 4 5.5z" />
        <circle cx="8.2" cy="8.2" r="1.5" {...SOLID} />
      </>
    ),
  },
  {
    name: "clips",
    label: "Clips",
    means: "A piece cut out of the mail",
    body: (
      <>
        <circle cx="7" cy="17" r="2.5" />
        <circle cx="17" cy="17" r="2.5" />
        <path d="M8.7 15.2L17 4.5M15.3 15.2L7 4.5" />
      </>
    ),
  },
  {
    name: "settings",
    label: "Settings",
    means: "Set it the way you like",
    body: (
      <>
        <path d="M4 8h3.4M12.6 8H20M4 16h9.4M18.6 16H20" />
        <circle cx="10" cy="8" r="2.6" {...SOLID} />
        <circle cx="16" cy="16" r="2.6" />
      </>
    ),
  },
  {
    name: "shortcuts",
    label: "Shortcuts",
    means: "Keys that do things",
    body: (
      <>
        <rect x="3.5" y="6.5" width="17" height="11" rx="3" />
        <path d="M7.5 10.5h.01M12 10.5h.01M16.5 10.5h.01M8.5 14h7" />
      </>
    ),
  },
  {
    name: "about",
    label: "About",
    means: "What this is, and which version",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
  },
  {
    name: "appearance",
    label: "Appearance",
    means: "Light, dark or the system's",
    body: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  },
  {
    name: "logout",
    label: "Log out",
    means: "Leave, and close the door",
    body: (
      <>
        <path d="M10 4.5H7.5A2.5 2.5 0 0 0 5 7v10a2.5 2.5 0 0 0 2.5 2.5H10" />
        <path d="M14 8l4 4-4 4M18 12H9.5" />
      </>
    ),
  },
  {
    name: "menu-style",
    label: "Menu style",
    means: "How the menu is laid out",
    body: (
      <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="2" {...SOLID} />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
      </>
    ),
  },
  {
    name: "security",
    label: "Security",
    means: "Keys and who gets in",
    body: (
      <>
        <circle cx="8" cy="12" r="3.6" {...SOLID} />
        <path d="M11.6 12H20M17 12v3M14.5 12v2" />
      </>
    ),
  },
  {
    name: "accounts",
    label: "Accounts",
    means: "A mailbox you have connected",
    body: (
      <>
        <rect x="3.5" y="6" width="17" height="12" rx="3" />
        <path d="M4.5 8.5l7.5 5 7.5-5" />
      </>
    ),
  },
  {
    name: "domains",
    label: "Domains",
    means: "Addresses that are yours",
    body: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16M12 4c2.4 2.2 3.4 4.9 3.4 8s-1 5.8-3.4 8c-2.4-2.2-3.4-4.9-3.4-8s1-5.8 3.4-8" />
      </>
    ),
  },
  {
    name: "agents",
    label: "Agents",
    means: "Helpers with their own mailbox",
    body: (
      <>
        <rect x="5" y="9" width="14" height="10" rx="3" />
        <path d="M12 9V5.5M9.5 14h.01M14.5 14h.01" />
        <circle cx="12" cy="4.5" r="1.4" {...SOLID} />
      </>
    ),
  },
  {
    name: "workflows",
    label: "Workflows",
    means: "Steps that run on their own",
    body: (
      <>
        <circle cx="6.2" cy="7" r="2.2" {...SOLID} />
        <path d="M8.4 7H13a3 3 0 0 1 3 3v4.4" />
        <circle cx="16" cy="17" r="2.6" />
      </>
    ),
  },
  {
    name: "integrations",
    label: "Integrations",
    means: "Other tools plugged in",
    body: (
      <>
        <path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0z" />
        <path d="M12 16v4" />
      </>
    ),
  },
  {
    name: "servers",
    label: "Servers",
    means: "Where the mail lives",
    body: (
      <>
        <rect x="4" y="4.5" width="16" height="6.5" rx="2.5" />
        <rect x="4" y="13" width="16" height="6.5" rx="2.5" />
        <path d="M8 7.75h.01M8 16.25h.01" />
      </>
    ),
  },
];

export function BrandIcon({
  name,
  size = 20,
  strokeWidth = 1.75,
  ...rest
}: { name: BrandIconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const def = BRAND_ICONS.find((d) => d.name === name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {def?.body}
    </svg>
  );
}

/** The logo mark on its own, in currentColor: a disc half solid (let in) and half outline (waiting). Heavier outline at small sizes. */
export function ThresholdMark({ size = 32, className }: { size?: number; className?: string }) {
  const stroke = size <= 16 ? 6.5 : size <= 32 ? 5.5 : 4.5;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <g transform="translate(-1)">
        <path d="M30 14A18 18 0 0 0 30 50Z" fill="currentColor" />
        <path d="M36 14A18 18 0 0 1 36 50Z" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />
      </g>
    </svg>
  );
}
