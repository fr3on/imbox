import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Account, User } from "@shared/types";
import { getAccountId, serverKeepsMailFresh, storeAccountId, syncAccounts, useMailChanges, useMe, whenLiveKnown } from "../api";
import { setConnectRefresh } from "../lib/connect";
import { DEFAULT_BRAND, sanitizeBrand } from "@shared/brand";
import { readBrand, writeBrand } from "../lib/brand";

export const ALL = "all" as const;
export type Scope = typeof ALL | string;

/** Monochrome marks used to tell accounts apart in the unified inbox. */
/** One colour per connected mailbox, in the order they were added. Mid tones that read on both the light and the dark page. */
export const ACCOUNT_COLORS = [250, 55, 150, 310, 20, 200, 100, 340].map((h) => `oklch(0.64 0.13 ${h})`);

export const GLYPHS = ["●", "■", "▲", "◆", "✦", "◐", "▼", "○"] as const;

interface Ctx {
  user: User | null;
  accounts: Account[];
  /** Selected scope: "all" (unified, default) or an account id. */
  scope: Scope;
  /** The scoped account, or null in unified scope. */
  account: Account | null;
  /** True when more than one account is connected (show glyphs). */
  multi: boolean;
  setupRequired: boolean;
  /** False when no OAuth client is configured, so the UI can offer setup instead of a failing connect. */
  googleConfigured: boolean;
  microsoftConfigured: boolean;
  /** What this deployment calls itself (APP_NAME): "Imbox" by default. */
  appName: string;
  /** False until the name is known (from the server, or remembered from the last visit), so it never flashes the default. */
  brandReady: boolean;
  loading: boolean;
  error: Error | null;
  setScope: (scope: Scope) => void;
  /** @deprecated use setScope */
  setAccountId: (id: string) => void;
  glyphFor: (accountId: string | undefined | null) => string;
  /** The colour that marks this mailbox in lists, or "" when it is not one of the connected ones. */
  colorFor: (accountId: string | undefined | null) => string;
  accountFor: (accountId: string | undefined | null) => Account | undefined;
  /** Default account for creating things (compose From, new labels…). */
  defaultAccount: Account | null;
  refetch: () => void;
}

const AccountCtx = createContext<Ctx>({
  user: null,
  accounts: [],
  scope: ALL,
  account: null,
  multi: false,
  setupRequired: false,
  googleConfigured: false,
  microsoftConfigured: false,
  appName: DEFAULT_BRAND,
  brandReady: false,
  loading: true,
  error: null,
  setScope: () => {},
  setAccountId: () => {},
  glyphFor: () => "",
  colorFor: () => "",
  accountFor: () => undefined,
  defaultAccount: null,
  refetch: () => {},
});

export function applyTheme(theme: "light" | "dark" | "system") {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.setAttribute("data-theme", theme);
  // The page's first paint (public/theme-init.js) and the docs site read this key, so they open in the same theme.
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // storage can be blocked
  }
}


/** Kick a sync when the app is opened or regains focus (throttled), so mail feels live without any push setup. */
function useSyncOnFocus(accounts: Account[], qc: ReturnType<typeof useQueryClient>) {
  const last = useRef(0);
  useEffect(() => {
    // Every polled provider, i.e. everything except a domain mailbox, which is pushed to instantly.
    const gmail = accounts.filter((a) => a.provider !== "domain" && a.sync_status !== "disconnected");
    if (gmail.length === 0) return;
    let stopped = false;
    const run = async (opening = false) => {
      if (document.visibilityState !== "visible") return;
      // As the window opens the event stream has not said yet whether the server keeps mail fresh; wait for it rather than sync for nothing.
      if (opening) await whenLiveKnown();
      if (stopped) return;
      // The server syncs every mailbox each minute and tells this window when something arrives, so there is nothing to ask for.
      if (serverKeepsMailFresh()) return;
      const t = Date.now();
      if (t - last.current < 45_000) return;
      last.current = t;
      const r = await syncAccounts(gmail.map((a) => a.id)).catch(() => null);
      // Nothing new came in: what is on screen is already right, so there is nothing to load again.
      if (r && r.added > 0) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    };
    void run(true);
    const onWake = () => void run();
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      stopped = true;
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [accounts.map((a) => a.id + a.sync_status).join(","), qc]);
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const [scope, setScopeState] = useState<Scope>(() => getAccountId() ?? ALL);
  // The name from the last visit paints instantly; the server's answer replaces it and is remembered.
  const [remembered] = useState<string | null>(() => readBrand());
  const serverBrand = me.data?.app_name ? sanitizeBrand(me.data.app_name) : null;
  const appName = serverBrand ?? remembered ?? DEFAULT_BRAND;
  const brandReady = !!(serverBrand ?? remembered);
  useEffect(() => {
    if (!serverBrand) return;
    writeBrand(serverBrand);
    // The static page says "Imbox"; pages that set their own title do so after this and win.
    if (document.title === DEFAULT_BRAND || document.title === remembered) document.title = serverBrand;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", serverBrand);
  }, [serverBrand, remembered]);

  const accounts = useMemo(() => me.data?.accounts ?? [], [me.data?.accounts]);
  useSyncOnFocus(accounts, qc);
  // Something done on the phone or in another tab shows up here within seconds.
  useMailChanges(accounts.length > 0);
  // The Google connect flow (which runs in the system browser on the Mac app) refreshes through this
  // rather than reloading the whole page.
  useEffect(() => {
    setConnectRefresh(() => {
      void me.refetch();
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    });
  }, [me, qc]);
  const account = useMemo(() => (scope === ALL ? null : accounts.find((a) => a.id === scope) ?? null), [accounts, scope]);

  // A stored account id that no longer exists → fall back to unified.
  useEffect(() => {
    if (scope !== ALL && me.data && !accounts.some((a) => a.id === scope)) {
      setScopeState(ALL);
      storeAccountId(null);
    }
  }, [scope, accounts, me.data]);

  // Theme → .dark class (system follows the OS and reacts to changes).
  const theme = me.data?.user?.settings?.theme ?? "system";
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => applyTheme("system");
    mql.addEventListener("change", fn);
    return () => mql.removeEventListener("change", fn);
  }, [theme]);

  const setScope = useCallback(
    (s: Scope) => {
      storeAccountId(s === ALL ? null : s);
      setScopeState(s);
      // scope-dependent data must be reloaded
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
    [qc],
  );

  const glyphFor = useCallback(
    (id: string | undefined | null) => {
      if (!id) return "";
      const i = accounts.findIndex((a) => a.id === id);
      return i < 0 ? "" : GLYPHS[i % GLYPHS.length];
    },
    [accounts],
  );
  const colorFor = useCallback(
    (id: string | undefined | null) => {
      if (!id) return "";
      const i = accounts.findIndex((a) => a.id === id);
      return i < 0 ? "" : ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
    },
    [accounts],
  );
  const accountFor = useCallback((id: string | undefined | null) => (id ? accounts.find((a) => a.id === id) : undefined), [accounts]);

  const value: Ctx = {
    user: me.data?.user ?? null,
    accounts,
    scope,
    account,
    multi: accounts.length > 1,
    setupRequired: me.data?.setup_required ?? false,
    googleConfigured: me.data?.google_configured ?? false,
    microsoftConfigured: me.data?.microsoft_configured ?? false,
    appName,
    brandReady,
    loading: me.isLoading,
    error: (me.error as Error) ?? null,
    setScope,
    setAccountId: setScope,
    glyphFor,
    colorFor,
    accountFor,
    defaultAccount:
      account ??
      (me.data?.user?.settings?.defaultAccountId
        ? accounts.find((a) => a.id === me.data?.user?.settings?.defaultAccountId)
        : null) ??
      accounts[0] ??
      null,
    refetch: () => me.refetch(),
  };
  return <AccountCtx.Provider value={value}>{children}</AccountCtx.Provider>;
}

export function useAccount() {
  return useContext(AccountCtx);
}
