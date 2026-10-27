import { BrandIcon } from "@/components/BrandIcons";

export type Tab = "profile" | "preferences" | "writing" | "accounts" | "domains" | "calendar" | "ai" | "agents" | "integrations" | "security" | "server";

export interface TabGroup {
  name: string;
  tabs: { key: Tab; label: string; icon: React.ReactNode }[];
}

export const TAB_GROUPS: TabGroup[] = [
  {
    name: "Account & Security",
    tabs: [
      { key: "profile", label: "Profile", icon: <BrandIcon name="sender" /> },
      { key: "security", label: "Security", icon: <BrandIcon name="security" /> },
      { key: "preferences", label: "Preferences", icon: <BrandIcon name="settings" /> },
    ],
  },
  {
    name: "Mail & Domains",
    tabs: [
      { key: "accounts", label: "Accounts", icon: <BrandIcon name="accounts" /> },
      { key: "writing", label: "Writing", icon: <BrandIcon name="write" /> },
      { key: "domains", label: "Domains", icon: <BrandIcon name="domains" /> },
    ],
  },
  {
    name: "Features & AI",
    tabs: [
      { key: "calendar", label: "Calendar", icon: <BrandIcon name="calendar" /> },
      { key: "ai", label: "AI", icon: <BrandIcon name="assistant" /> },
      { key: "agents", label: "Agents", icon: <BrandIcon name="agents" /> },
      { key: "integrations", label: "Integrations", icon: <BrandIcon name="integrations" /> },
    ],
  },
  {
    name: "System",
    tabs: [{ key: "server", label: "Server", icon: <BrandIcon name="servers" /> }],
  },
];

export const TABS = TAB_GROUPS.flatMap((g) => g.tabs);

/* ---------- small building blocks (Notion-style property rows) ---------- */
