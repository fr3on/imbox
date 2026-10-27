import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Mail, } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, useCounts, useMeMutations, useNewMailNotifier } from "../api";
import { ALL, useAccount } from "../context/AccountContext";
import { useCompose } from "../context/ComposeContext";
import { assistant, useAssistant } from "../lib/assistantStore";
import { startGoogleConnect, startMicrosoftConnect } from "../lib/connect";
import { useKeys } from "../lib/keys";
import { PRESETS, setMenuPreset, useMenuPreset } from "../lib/menuPresets";
import { installExternalLinkHandler, isDesktop, isMac, isNative, native, onMenu } from "../lib/native";
import { clearPersistedCache } from "../lib/persistedCache";
import { AboutDialog } from "./AboutDialog";
import { AssistantPanel } from "./AssistantPanel";
import { Avatar } from "./Avatar";
import { CommandPalette } from "./CommandPalette";
import { DraftsChip } from "./DraftsChip";
import { Mark, Wordmark } from "./Logo";
import { OutboxBanner } from "./OutboxBanner";
import { ScopeMenuContent } from "./ScopeMenu";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { SyncBadge } from "./SyncPill";
import { TopTabs } from "./TopTabs";
import { UpdateDialog } from "./UpdateDialog";
import { BrandIcon } from "./BrandIcons";
import { PRESET_ICON } from "./presetIcons";


import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  SidebarInset, SidebarProvider
} from "@/components/ui/sidebar";
import { useUpdateCheck } from "../lib/update";
import { NotificationsMenu } from "./NotificationsMenu";

export type SidebarLayout = "expanded" | "collapsed" | "top";

/** Small monochrome wordmark mark. */
export function Shell() {
  const { user, loading, error } = useAccount();
  const loc = useLocation();
  const layout: SidebarLayout = "top";
  const fullHeight = loc.pathname.startsWith("/calendar");
  const aState = useAssistant();
  const docked = aState.open && aState.mode === "dock";

  // Watch for new notifications, desktop popups, audio chimes, and sync dock badges
  useNewMailNotifier(!!user);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-muted-foreground text-sm">
        <Mark size={40} />
        <div className="flex items-center gap-2">
          <span className="inline-block size-3.5 rounded-full border-2 border-muted-foreground/40 border-t-foreground animate-spin" />
          {new URLSearchParams(loc.search).has("connected") ? "Connecting your Gmail…" : "Loading…"}
        </div>
      </div>
    );
  }
  if (error || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return (
    <SidebarProvider open={false}>
        <SidebarInset className={cn("min-w-0 transition-[padding] duration-150", fullHeight && "h-svh overflow-hidden")} style={{ paddingRight: docked ? aState.width : undefined }}>
          <HorizontalTopHeader layout={layout} />
          {/* The calendar is a full-height app view that scrolls inside itself, so it gets the
              viewport exactly and no tall bottom padding — otherwise the page scrolls too and the
              toolbar drifts away under you. Every other page wants the room to grow. */}
          <main className={cn("w-full px-4 sm:px-6 pt-4", fullHeight ? "min-h-0 flex-1 overflow-hidden pb-3" : "flex-1 pb-24")}>
            <Outlet />
          </main>
        </SidebarInset>
        <Overlays />
        <AssistantPanel />
      </SidebarProvider>
  );
}

/* ---------------- overlays (palette, shortcuts) share state via a tiny store ---------------- */
type OverlayState = { palette: boolean; help: boolean; update: boolean; about: boolean };
let overlayState: OverlayState = { palette: false, help: false, update: false, about: false };
const listeners = new Set<() => void>();
function setOverlay(patch: Partial<OverlayState>) {
  overlayState = { ...overlayState, ...patch };
  listeners.forEach((l) => l());
}

function useOverlay() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return overlayState;
}

function useTheme() {
  const { user } = useAccount();
  const { update } = useMeMutations();
  const theme = user?.settings?.theme ?? "system";
  const resolvedDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const setTheme = useCallback((t: "light" | "dark" | "system") => update.mutate({ settings: { ...(user?.settings ?? {}), theme: t } }), [update, user?.settings]);
  const toggleTheme = useCallback(() => setTheme(resolvedDark ? "light" : "dark"), [resolvedDark, setTheme]);
  return { theme, setTheme, toggleTheme };
}

function Overlays() {
  const { palette, help, update, about } = useOverlay();
  const { openCompose } = useCompose();
  const { account, accounts, appName } = useAccount();
  const { theme, toggleTheme } = useTheme();
  const updateInfo = useUpdateCheck();
  const nav = useNavigate();

  useKeys({
    c: () => openCompose(),
    "/": () => setOverlay({ palette: true }),
    s: () => setOverlay({ palette: true }),
    "?": () => setOverlay({ help: true }),
    F1: () => setOverlay({ help: true }),
    i: () => nav("/"),
    "0": () => nav(location.pathname.startsWith("/calendar") ? "/" : "/calendar"),
  });
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay({ palette: !overlayState.palette });
      }
      if (e.key === "F1") {
        e.preventDefault();
        setOverlay({ help: !overlayState.help });
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // Native shell: menu-bar actions (desktop apps), external links, notification deep links.
  useEffect(() => {
    if (!isNative) return;
    const offMenu = !isDesktop ? () => {} : onMenu((id) => {
      if (id.startsWith("nav:")) return nav(id.slice(4));
      switch (id) {
        case "compose": return openCompose();
        case "palette": return setOverlay({ palette: true });
        case "assistant": return assistant.focusInput();
        case "check-updates": return setOverlay({ update: true });
        case "toggle-sidebar": return window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
        case "back": return history.back();
        case "forward": return history.forward();
      }
    });
    const offLinks = installExternalLinkHandler();
    const onFocus = () => { native.takePendingUrl().then((u) => { if (u) nav(u); }); };
    window.addEventListener("focus", onFocus);
    return () => { offMenu(); offLinks(); window.removeEventListener("focus", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <CommandPalette open={palette} onClose={() => setOverlay({ palette: false })} onCompose={() => openCompose()} onToggleTheme={toggleTheme} onShortcuts={() => setOverlay({ help: true })} onAssistant={() => assistant.focusInput()} theme={theme} hasAccount={!!account || accounts.length > 0} />
      <ShortcutsOverlay open={help} onClose={() => setOverlay({ help: false })} />
      <UpdateDialog open={update} onClose={() => setOverlay({ update: false })} info={updateInfo} />
      <AboutDialog open={about} onClose={() => setOverlay({ about: false })} appName={appName} onShortcuts={() => setOverlay({ help: true })} />
    </>
  );
}


/* ---------------- horizontal top header ---------------- */
function HorizontalTopHeader({ layout }: { layout: SidebarLayout }) {
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, accounts, account, scope, setScope, glyphFor, googleConfigured, microsoftConfigured, appName } = useAccount();
  const counts = useCounts(accounts.length > 0);
  const { openCompose } = useCompose();
  const { theme, setTheme } = useTheme();
  const c = counts.data;

  const logout = async () => {
    await api.post("/auth/logout");
    qc.clear();
    clearPersistedCache();
    nav("/login");
  };


  // The tab strip scrolls sideways only when the window is too narrow for it. A stray swipe can leave it half scrolled ("Imbox" reads
  // "box"), so the current tab is brought back into view whenever the page changes, and the strip returns to the start when none is current.
  const tabsRef = useRef<HTMLDivElement>(null);
  // The header's height, for whatever sticks just under it (the bulk actions bar), since it grows with a banner or a wrapped row.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--shell-header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--shell-header-h");
    };
  }, []);
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const current = strip.querySelector<HTMLElement>("[data-current]");
    if (current) current.scrollIntoView({ inline: "nearest", block: "nearest" });
    else strip.scrollLeft = 0;
  }, [loc.pathname]);

  const menuPreset = useMenuPreset();
  const assistantOpen = useAssistant().open;

  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  return (
    <header ref={headerRef} data-tauri-drag-region={isMac || undefined} className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-border/60">
      {/* Tier 1: Brand, Scope breadcrumb, Actions, User */}
      {/* The same nesting as <main> and a page: an outer gutter, then the page container, then the page's own small inset. The header then starts exactly where the page does. */}
      <div className="w-full px-4 sm:px-6">
      <div className="max-w-5xl mx-auto w-full h-[68px] sm:h-[72px] flex items-center justify-between gap-4 px-2">
        {/* Left: the logo, then the account selector */}
        <div className="flex items-center min-w-0 gap-1.5">
          <Link to="/" aria-label={appName} className="flex shrink-0 items-center rounded-lg px-1.5 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-ring">
            <Mark size={28} className="sm:hidden" />
            <Wordmark size={22} className="hidden sm:inline-flex" />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 py-1.5 px-2.5 -ml-2 rounded-lg text-[15px] sm:text-base font-semibold text-foreground hover:bg-muted/60 outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors truncate max-w-[260px] sm:max-w-[380px]"
              >
                {/* Who you are looking at: their picture, their name, and their address underneath. For everything at once, your own picture and how many mailboxes that is. */}
                {(() => {
                  const one = scope === ALL ? (accounts.length === 1 ? accounts[0] : undefined) : account;
                  const shown = one ?? null;
                  const name = shown ? shown.display_name?.trim() || user?.name?.trim() || shown.email.split("@")[0] : "All accounts";
                  const sub = shown ? shown.email : accounts.length > 1 ? `${accounts.filter((a) => !a.is_agent).length} mailboxes` : "";
                  return (
                    <>
                      <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70">
                        <span aria-hidden>{shown ? <Mail size={16} /> : <BrandIcon name="imbox" size={16} />}</span>
                        <SyncBadge />
                      </span>
                      <span className="flex min-w-0 flex-col items-start text-left leading-tight">
                        <span className="max-w-[240px] truncate text-[15px] font-semibold">{name}</span>
                        {sub && <span className="max-w-[240px] truncate text-xs font-normal text-muted-foreground">{sub}</span>}
                      </span>
                    </>
                  );
                })()}
                <ChevronDown size={14} className="text-muted-foreground/70 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <ScopeMenuContent
              accounts={accounts}
              scope={scope}
              glyphFor={glyphFor}
              onScope={(v) => { setScope(v); nav("/"); }}
              side="bottom"
              googleConfigured={googleConfigured}
              microsoftConfigured={microsoftConfigured}
              onConnectGoogle={() => startGoogleConnect()}
              onConnectMicrosoft={() => startMicrosoftConnect()}
              onAddMailbox={() => nav("/settings/accounts?add=imap")}
              onServers={() => nav("/settings/servers")}
              onManage={() => nav("/settings/accounts")}
            />
          </DropdownMenu>
        </div>

        {/* Right: Actions & Profile */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openCompose()}
            className="h-8 px-2.5 rounded-md text-xs sm:text-[13px] font-medium gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
            title="Write (c)"
          >
            <BrandIcon name="write" size={14} />
            <span className="hidden sm:inline">Write</span>
            <Kbd className="hidden text-[10px] py-0 px-1 xl:inline-flex">c</Kbd>
          </Button>
          <DraftsChip />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOverlay({ palette: true })}
            className="h-8 px-2.5 rounded-md text-xs sm:text-[13px] font-medium gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
            title="Search (⌘K)"
          >
            <BrandIcon name="search" size={14} />
            <span className="hidden sm:inline">Search</span>
            <Kbd className="hidden text-[10px] py-0 px-1 xl:inline-flex">⌘K</Kbd>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => assistant.toggle()}
            className={cn("h-8 shrink-0 gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-muted/60 hover:text-foreground sm:text-[13px]", assistantOpen ? "bg-muted text-foreground" : "text-muted-foreground")}
            title="Ask the assistant (⌘J)"
            aria-pressed={assistantOpen}
          >
            <BrandIcon name="assistant" size={14} />
            <span className="hidden sm:inline">Ask</span>
            <Kbd className="hidden text-[10px] py-0 px-1 xl:inline-flex">⌘J</Kbd>
          </Button>

          <NotificationsMenu className="h-8 w-8 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" />

          {/* User Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="size-9 rounded-full ring-2 ring-border/80 hover:ring-foreground/50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0 ml-0.5 shadow-2xs overflow-hidden flex items-center justify-center cursor-pointer"
                title={user?.name || user?.email}
              >
                <Avatar round email={user!.email} name={user!.name} src={user?.settings?.avatar_url || accounts.find((a) => a.avatar_url)?.avatar_url} size={36} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-2 rounded-xl shadow-lg border border-border/80">
              {/* Profile Card Header */}
              <div className="flex items-center gap-3 p-2.5 bg-muted/40 rounded-lg mb-1.5 border border-border/40">
                <Avatar round email={user!.email} name={user!.name} src={user?.settings?.avatar_url || accounts.find((a) => a.avatar_url)?.avatar_url} size={38} className="ring-1 ring-border/80 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-foreground truncate">{user!.name || user!.email.split("@")[0]}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate block mt-0.5">{user!.email}</span>
                </div>
              </div>

              <DropdownMenuItem onClick={() => nav("/settings/accounts")} className="gap-2.5 text-xs py-2 cursor-pointer">
                <BrandIcon name="sender" size={14} className="text-muted-foreground" />
                <span className="flex-1">My Account</span>
                <ChevronRight size={13} className="text-muted-foreground/50" />
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => nav("/settings")} className="gap-2.5 text-xs py-2 cursor-pointer">
                <BrandIcon name="settings" size={14} className="text-muted-foreground" />
                <span className="flex-1">Settings</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setOverlay({ help: true })} className="gap-2.5 text-xs py-2 cursor-pointer">
                <BrandIcon name="shortcuts" size={14} className="text-muted-foreground" />
                <span className="flex-1">Shortcuts</span>
                <DropdownMenuShortcut>?</DropdownMenuShortcut>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => setOverlay({ about: true })} className="gap-2.5 text-xs py-2 cursor-pointer">
                <BrandIcon name="about" size={14} className="text-muted-foreground" />
                <span className="flex-1">About {appName || "Imbox"}</span>
                <span className="text-[11px] text-muted-foreground font-mono">v0.1.0</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="my-1.5" />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2.5 text-xs py-2 cursor-pointer">
                  <span className="text-muted-foreground [&>svg]:size-[14px]">{PRESET_ICON[menuPreset.id]}</span>
                  <span className="flex-1">Menu style</span>
                  <span className="mr-1 text-[11px] text-muted-foreground">{menuPreset.label}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-64 p-1.5">
                  <DropdownMenuRadioGroup value={menuPreset.id} onValueChange={(v) => setMenuPreset(v as (typeof PRESETS)[number]["id"])}>
                    {PRESETS.map((p) => (
                      <DropdownMenuRadioItem key={p.id} value={p.id} className="gap-2.5 py-1.5 text-xs">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80 [&>svg]:size-4">{PRESET_ICON[p.id]}</span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-[13px] font-medium leading-4">{p.label}</span>
                          <span className="text-[11.5px] leading-4 text-muted-foreground">{p.blurb}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* Dark mode switch row */}
              <div className="flex items-center justify-between px-2 py-1.5 text-xs text-foreground rounded-md hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <BrandIcon name="appearance" size={14} className="text-muted-foreground" />
                  <span>Dark Mode</span>
                </div>
                <Switch
                  checked={isDark}
                  onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                  size="sm"
                />
              </div>

              <DropdownMenuSeparator className="my-1.5" />

              <DropdownMenuItem onClick={logout} className="gap-2.5 text-xs py-2 text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
                <BrandIcon name="logout" size={14} />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </div>

      {/* Tier 2: Horizontal Navigation Tabs Bar */}
      <div className="border-t border-border/50">
        <div className="w-full px-4 sm:px-6">
        <div className="max-w-5xl mx-auto w-full h-14 flex items-center justify-center px-2">
          <div ref={tabsRef} className="flex min-w-0 max-w-full items-center gap-0.5 rounded-[14px] bg-muted/70 p-1 overflow-x-auto overflow-y-hidden overscroll-x-contain no-scrollbar select-none">
            <TopTabs counts={c} />
          </div>
        </div>
        </div>
      </div>

      {/* Tier 3: Outbox Banner */}
      <OutboxBanner />
    </header>
  );
}

