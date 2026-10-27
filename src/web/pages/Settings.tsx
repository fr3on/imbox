import { Fragment, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAccount } from "@/context/AccountContext";
import { AiSection } from "@/components/AiSettingsSection";
import { AutoAgentsSection } from "@/components/AutoAgentsSection";
import { IntegrationsSection } from "@/components/IntegrationsSection";
import { CalendarSettingsSection } from "@/components/CalendarSettingsSection";
import { useCardScroll } from "@/lib/cardKeys";
import { AccountsSection } from "../settings/accounts/AccountsSection";
import { DomainsSection } from "../settings/domains/DomainsSection";
import { PreferencesSection } from "../settings/preferences/PreferencesSection";
import { ProfileSection } from "../settings/profile/ProfileSection";
import { WritingSection } from "../settings/writing/WritingSection";
import { ServerSection } from "../settings/server/ServerSection";
import { SecuritySection } from "../settings/security/SecuritySection";
import { TABS, TAB_GROUPS, type Tab } from "../settings/tabs";

export default function SettingsPage() {
  useCardScroll();
  const { user } = useAccount();
  const loc = useLocation();
  const nav = useNavigate();
  const [sp] = useSearchParams();

  // The tab is the path: /settings/calendar. Old links (/settings/calendar, /settings?tab=calendar) still land on the right tab and are rewritten to the path.
  const rawHash = loc.hash.replace("#", "");
  const pathTab = loc.pathname.split("/")[2] ?? "";
  const named = pathTab || rawHash || sp.get("tab") || (sp.has("agent") ? "agents" : "");
  // The Servers page was merged into Domains: an old link or bookmark to it lands on the merged page.
  const wanted = (named === "servers" ? "domains" : named) as Tab;
  const activeTab: Tab = TABS.some((t) => t.key === wanted) ? wanted : "profile";

  useEffect(() => {
    if (pathTab === activeTab || (!rawHash && !sp.has("tab") && !sp.has("agent") && !pathTab)) return;
    const next = new URLSearchParams(sp);
    next.delete("tab");
    const search = next.toString();
    nav({ pathname: `/settings/${activeTab}`, search: search ? `?${search}` : "" }, { replace: true });
  }, [pathTab, rawHash, activeTab, sp, nav]);

  const setTab = (t: string) => {
    const nextSp = new URLSearchParams(sp);
    if (t !== "agents" && sp.has("agent")) {
      nextSp.delete("agent");
      nextSp.delete("view");
    }
    nextSp.delete("add");
    nextSp.delete("tab");
    const search = nextSp.toString();
    nav({ pathname: `/settings/${t}`, search: search ? `?${search}` : "" }, { replace: true });
  };
  if (!user) return null;

  return (
    <div className="max-w-5xl mx-auto w-full px-2 sm:px-4 py-2">
      <header className="mb-8 pb-5 border-b border-border/60">
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-xs sm:text-[13px] text-muted-foreground mt-1">Manage your identity, mailboxes, security, and preferences.</p>
      </header>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 lg:gap-8 items-start">
        {/* Menu: a row of pills on a phone, a rail of icons on a tablet, icons with labels on a wide window. It never takes room from the content. */}
        <aside className="w-full min-w-0 shrink-0 md:w-auto md:sticky md:top-24 md:border-r md:border-border/60 md:pr-3 lg:pr-5">
          <nav aria-label="Settings" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:w-11 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0 lg:w-40">
            {TAB_GROUPS.map((group, gi) => (
              <Fragment key={group.name}>
                {gi > 0 && <div role="separator" className="mx-2 my-2 hidden h-px bg-border/70 md:block" />}
                {group.tabs.map((t) => {
                  const isActive = activeTab === t.key;
                  return (
                    <Tooltip key={t.key}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setTab(t.key)}
                          aria-label={t.label}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "group flex shrink-0 items-center gap-2.5 whitespace-nowrap text-[13.5px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                            "rounded-full border px-3 py-1.5 md:justify-center md:rounded-lg md:border-transparent md:px-0 md:py-2 lg:justify-start lg:px-2.5",
                            isActive
                              ? "border-foreground bg-foreground text-background md:bg-muted md:font-semibold md:text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground md:hover:bg-muted/40"
                          )}
                        >
                          <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4 max-md:hidden">{t.icon}</span>
                          <span className="truncate md:sr-only lg:not-sr-only">{t.label}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-md:hidden lg:hidden">{t.label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </Fragment>
            ))}
          </nav>
        </aside>

        {/* Content Pane */}
        <main className="flex-1 min-w-0 w-full">
          {activeTab === "profile" && <ProfileSection onGoToTab={setTab} />}
          {activeTab === "security" && <SecuritySection />}
          {activeTab === "preferences" && <PreferencesSection />}
          {activeTab === "accounts" && <AccountsSection onNewMailbox={() => setTab("domains")} />}
          {activeTab === "writing" && <WritingSection onGoToTab={setTab} />}
          {activeTab === "domains" && <DomainsSection />}
          {activeTab === "calendar" && <CalendarSettingsSection />}
          {activeTab === "ai" && <AiSection />}
          {activeTab === "agents" && <AutoAgentsSection />}
          {activeTab === "server" && <ServerSection />}
          {activeTab === "integrations" && <IntegrationsSection onGoToTab={setTab} />}
        </main>
      </div>
    </div>
  );
}
