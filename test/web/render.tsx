import type { ReactElement } from "react";
process.env.TZ = "UTC";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountProvider } from "@/context/AccountContext";
import type { Account, Domain, User } from "@shared/types";

// Renders a part of the web app to HTML on the server, with the same providers the app has and the data already in the query cache. No browser is
// involved, so what comes out is the first paint: effects and clicks do not run. It is for pinning what a screen shows while code moves around.

// The few browser globals a screen reads while it draws. Nothing here is a real browser.
const store = new Map<string, string>();
Object.assign(globalThis, {
  location: new URL("https://inbox.example.test/settings"),
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
});
Object.assign(globalThis, {
  getComputedStyle: () => new Proxy({ getPropertyValue: () => "" }, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : "") }),
});
// Some libraries look for a document when they are first loaded and, finding one, start touching it. So this one exists only while a screen is drawn.
const documentStub = {
  documentElement: { classList: { contains: () => false }, getAttribute: () => null, style: {} },
  querySelector: () => null,
  getElementById: () => null,
  addEventListener() {},
  removeEventListener() {},
};
Object.assign(globalThis, {
  window: Object.assign(Object.create(null), {
    location: globalThis.location,
    localStorage: (globalThis as unknown as { localStorage: unknown }).localStorage,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout,
    clearTimeout,
    innerWidth: 1280,
  }),
});

export const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

const account = (o: Partial<Account> & Pick<Account, "id" | "email" | "provider">): Account => ({
  display_name: "Maya Chen",
  domain_id: null,
  initial_sync_done: true,
  initial_sync_count: 1200,
  sync_status: "idle",
  sync_error: null,
  last_synced_at: NOW - 90_000,
  signature: "",
  cover_art: "",
  avatar_url: "",
  photos_synced_at: null,
  created_at: NOW - 40 * 86_400_000,
  ...o,
});

export const ACCOUNTS: Account[] = [
  account({ id: "a-gmail", email: "maya@gmail.test", provider: "gmail", signature: "Maya" }),
  account({ id: "a-imap", email: "maya@chen.studio", provider: "imap", sync_status: "error", sync_error: "Login failed: wrong password" }),
  account({ id: "a-out", email: "maya@outlook.test", provider: "outlook", sync_status: "syncing", initial_sync_done: false, import_remaining: 300, import_total: 1000 }),
  account({ id: "a-dom", email: "hello@chen.studio", provider: "domain", domain_id: "d-1" }),
];

export const DOMAIN: Domain = {
  id: "d-1",
  name: "chen.studio",
  status: "active",
  sending: "resend",
  catch_all_account_id: "a-dom",
  error: null,
  inbound: { enabled: true, url: "https://mail.example.test/inbound/chen", last_received_at: NOW - 3_600_000 },
  instructions: ["Add the MX record", "Add the SPF record"],
  mailboxes: [ACCOUNTS[3]],
  created_at: NOW - 30 * 86_400_000,
};

export const USER: User = {
  id: "u-1",
  email: "maya@chen.studio",
  name: "Maya Chen",
  disabled: false,
  created_at: NOW - 60 * 86_400_000,
  two_factor_enabled: true,
  settings: { theme: "light", job_title: "Founder", company: "Chen Studio", undoSendSeconds: 10, imboxLayout: "list" },
};

/** What the server would have answered, keyed the way the app keys its queries. */
export function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["me"], { user: USER, accounts: ACCOUNTS, setup_required: false, google_configured: true, microsoft_configured: false, app_name: "Imbox" });
  qc.setQueryData(["domains"], [DOMAIN]);
  qc.setQueryData(["2fa"], { enabled: true, recovery_left: 8 });
  qc.setQueryData(["passkeys"], { passkeys: [{ id: "pk-1", name: "MacBook", created_at: NOW - 86_400_000, last_used_at: NOW - 3_600_000, transports: ["internal"] }] });
  qc.setQueryData(["extension-tokens"], [{ id: "t-1", name: "Chrome on laptop", created_at: NOW - 5 * 86_400_000, last_used_at: NOW - 600_000 }]);
  qc.setQueryData(["oauth"], [
    { provider: "google", configured: true, source: "env", env_available: true, overriding: false, client_id: "1234-abc.apps.example", secret_hint: "••••wxyz" },
    { provider: "microsoft", configured: false, source: "none", env_available: false, overriding: false, client_id: "", secret_hint: "" },
  ]);
  qc.setQueryData(["stalwart", "servers"], []);
  return qc;
}

export function html(ui: ReactElement, url = "/settings", more?: (qc: QueryClient) => void): string {
  const qc = seeded();
  more?.(qc);
  (globalThis as { document?: unknown }).document = documentStub;
  try {
    return steadyIds(renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <TooltipProvider>
            <AccountProvider>{ui}</AccountProvider>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
}

/** React numbers the ids it makes by where a component sits in the tree, so moving a part into its own component renumbers them. Number them by first appearance instead. */
function steadyIds(markup: string): string {
  const seen = new Map<string, string>();
  return markup.replace(/_R_[0-9a-z]+_/g, (id) => {
    if (!seen.has(id)) seen.set(id, `_R_${seen.size + 1}_`);
    return seen.get(id) as string;
  });
}
