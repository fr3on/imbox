import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { invalidateMail, keys } from "./keys";

// Whether the server is telling us about changes (the event stream is open and the server is listening). While it is, polling for them is pointless, so
// the lists check far less often: they stay on a slow timer only as a safety net.
let live = false;

/** The server also said that it syncs the mailboxes by itself every minute. */
let serverSyncs = false;

const liveListeners = new Set<() => void>();

// Set once the event stream has said what the server does (or has failed to), so a decision that depends on it need not guess.
let liveKnown = false;
const knownWaiters = new Set<() => void>();

function markKnown() {
  liveKnown = true;
  for (const fn of knownWaiters) fn();
  knownWaiters.clear();
}

/** How long a stream may say nothing at all (the server pings every 25 seconds) before the window stops trusting it. */
export const STREAM_SILENCE_MS = 75_000;

/** Whether a stream that has been pinging has gone quiet for longer than it should. */
export function streamSilent(now: number, heard: number, limit = STREAM_SILENCE_MS): boolean {
  return now - heard > limit;
}

/** Resolves once the event stream has reported (or failed), or after `ms` if it never does. */
export function whenLiveKnown(ms = 2000): Promise<void> {
  if (liveKnown) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      knownWaiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    knownWaiters.add(done);
  });
}

function setLive(value: boolean) {
  if (live === value) return;
  live = value;
  for (const fn of liveListeners) fn();
}

const subscribeLive = (fn: () => void) => {
  liveListeners.add(fn);
  return () => void liveListeners.delete(fn);
};

/** True while the server is telling us what changes and syncing the mailboxes itself: asking it to sync as the window opens would only repeat what it does. */
export const serverKeepsMailFresh = () => live && serverSyncs;

/** How often a mail list should poll: as asked, or every five minutes while the server tells us what changes. */
export function useLivePoll(ms: number): number {
  return useSyncExternalStore(subscribeLive, () => live) ? Math.max(ms, 300_000) : ms;
}

/**
 * Keeps the mail on screen current: something done in the Mac app, on the phone or in another tab shows up here within a second or two.
 *
 * The server holds a stream open (`/api/events`, Server-Sent Events) and says `changed` when this person's mail does; that drops the mail caches. If the stream
 * cannot be had (an older server, a proxy that blocks it, the connection lost), it falls back to what it did before: asking `/api/changes`, one number that
 * moves whenever any of the mail does, every ten seconds, and again whenever the window is focused.
 */
export function useMailChanges(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let last: number | null = null;
    let stopped = false;
    const refetch = () => {
      invalidateMail(qc);
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    };
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await api.get<{ revision: number }>("/api/changes");
        if (stopped) return;
        if (last !== null && r.revision !== last) refetch();
        last = r.revision;
      } catch {
        /* offline or signed out: the next tick tries again */
      }
    };

    let source: EventSource | null = null;
    let reopen: number | undefined;
    let meTimer: number | undefined;
    let gap = false;
    // Anything the stream says shows it is alive. Once it has pinged, a long silence means it died without telling us (the laptop slept, a router dropped it).
    let heard = Date.now();
    let pinging = false;
    const open = () => {
      if (stopped || typeof EventSource === "undefined") return;
      const es = new EventSource("/api/events");
      source = es;
      heard = Date.now();
      pinging = false;
      for (const name of ["ready", "up", "down", "changed", "accounts"]) es.addEventListener(name, () => (heard = Date.now()));
      es.addEventListener("ping", () => {
        pinging = true;
        heard = Date.now();
      });
      es.addEventListener("ready", (e) => {
        const info = JSON.parse((e as MessageEvent).data || "{}");
        serverSyncs = info.syncs === true;
        setLive(info.live === true);
        markKnown();
        // Reconnected after being cut off: whatever changed in between was not heard.
        if (gap) {
          refetch();
          void qc.invalidateQueries({ queryKey: keys.me });
        }
        gap = false;
      });
      es.addEventListener("up", () => setLive(true));
      es.addEventListener("down", () => setLive(false));
      es.addEventListener("changed", refetch);
      // A mailbox was added, removed, or its sync state or settings changed (on another device, or by the server's own sync): refresh the account list. Bursts are one refetch.
      es.addEventListener("accounts", () => {
        meTimer ??= window.setTimeout(() => {
          meTimer = undefined;
          void qc.invalidateQueries({ queryKey: keys.me });
        }, 1000);
      });
      es.onerror = () => {
        setLive(false);
        markKnown();
        gap = true;
        // The browser reconnects by itself after a dropped connection. A refusal (not available here, too many windows, signed out) closes it for good: try again later.
        if (es.readyState === EventSource.CLOSED) {
          source = null;
          reopen = window.setTimeout(open, 60_000);
        }
      };
    };
    open();
    const watchdog = window.setInterval(() => {
      if (!source || !pinging || !streamSilent(Date.now(), heard)) return;
      // Whatever changed while it was silent was not heard: start again and ask for everything.
      source.close();
      source = null;
      setLive(false);
      gap = true;
      open();
    }, 20_000);

    void check();
    const id = window.setInterval(() => {
      if (!live) void check();
    }, 10_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.clearInterval(watchdog);
      window.clearTimeout(reopen);
      window.clearTimeout(meTimer);
      source?.close();
      setLive(false);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, qc]);
}
