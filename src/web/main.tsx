import { installConnectInterceptor } from "./lib/connect";
import { installBuildWatcher } from "./lib/update";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { BUILT_AT } from "@shared/buildInfo";
import { PERSIST_KEY } from "./lib/persistedCache";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // No refetch-on-focus: `useSyncOnFocus` already syncs each account on focus and then invalidates
    // everything, so the automatic refetch only ever produced a second copy of every request.
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

/**
 * A cold load used to sit on skeletons until the Imbox, counts and screener round-tripped — even
 * though that's the same data the last visit already had. Paint from a localStorage copy instead;
 * the queries above still refetch right away (they're already older than `staleTime`), so this only
 * changes what's on screen while that happens, not what data ends up there.
 *
 * Deliberately small: only list-shaped, sidebar-shaped data, never `thread` (full HTML bodies) or
 * `search` — those stay network-only so one big thread can't blow the ~5MB localStorage quota.
 * The calendar's own keys (`calRange`, `calDay`, `calSettings`, …) all start with "cal" — see the
 * comment on `keys` in api.ts — and events are small text fields, so the whole family is cheap to
 * keep: a visited month/day paints from the last snapshot instead of a blank grid while it refetches.
 * `clearPersistedCache` (lib/persistedCache.ts) drops the same `PERSIST_KEY` on logout.
 */
const PERSISTED_QUERIES = new Set(["me", "imbox", "counts", "screener", "screened-out", "labels", "collections", "cal"]);

persistQueryClient({
  queryClient,
  persister: createSyncStoragePersister({ storage: window.localStorage, key: PERSIST_KEY }),
  maxAge: 24 * 60 * 60 * 1000,
  // Ties the cache to the exact build: a shape change in an API response can't crash a render with
  // data shaped for the version before it — the next deploy just starts from an empty cache instead.
  buster: BUILT_AT,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === "success" && PERSISTED_QUERIES.has(String(query.queryKey[0])),
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Navigations are transitions (the router does this by itself since version 7): a route whose chunk is still
          downloading keeps the current page on screen instead of dropping to a Suspense fallback. */}
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
installConnectInterceptor();
installBuildWatcher();

// The worker shows push notifications and keeps the app installable; it caches nothing (see public/sw.js).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
