import { Navigate } from "react-router-dom";
import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL, useAccount } from "../context/AccountContext";
import { useAccountMutations } from "../api";
import { fmtRelative } from "../lib/format";
import { AccountGlyph } from "./Avatar";
import { Button } from "@/components/ui/button";
import type { Account } from "@shared/types";

/**
 * What every page shows before a mailbox is connected. It used to be a one-button dead end; it now
 * sends the visitor into the guided setup, which is a page of its own so it survives the account
 * list changing while they work through it.
 */
export function ConnectGmailCard() {
  return <Navigate to="/welcome" replace />;
}

export function SyncPill({ className }: { className?: string }) {
  const { account, accounts, scope, glyphFor } = useAccount();
  const { sync } = useAccountMutations();
  const targets = scope === ALL ? accounts : account ? [account] : [];
  const busy = targets.filter((a) => !a.initial_sync_done || a.sync_status === "syncing" || (a.import_remaining ?? 0) > 0);
  const broken = targets.filter((a) => a.sync_status === "error" || a.sync_status === "disconnected");
  if (busy.length === 0 && broken.length === 0) return null;
  const a = broken[0] ?? busy[0];
  const error = broken.length > 0;
  // Which account, on hover and not spelled out inline: inline, it reads as the account switcher
  // telling you your own email address whenever more than one account is syncing.
  const which = targets.length > 1 ? <AccountGlyph glyph={glyphFor(a.id)} label={a.email} className="mx-0.5" /> : null;
  return (
    <div className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {error ? <RefreshCw size={13} /> : <Loader2 size={13} className="animate-spin" />}
      {error ? (
        <span>
          Sync problem{which}: {a.sync_error || "unknown"}.{" "}
          {a.sync_status === "disconnected" && (
            a.provider === "imap"
              ? <a href="/settings/accounts" className="underline underline-offset-2 hover:text-foreground">Open settings</a>
              : <a href="/auth/google/start" className="underline underline-offset-2 hover:text-foreground">Reconnect</a>
          )}
        </span>
      ) : (
        <span>
          {(a.import_remaining ?? 0) > 0 ? "Importing" : "Syncing"}{which}
          {(a.import_remaining ?? 0) > 0 ? (
            <span className="tnum"> · {Math.max(0, (a.import_total ?? 0) - (a.import_remaining ?? 0)).toLocaleString()} of {(a.import_total ?? 0).toLocaleString()} messages</span>
          ) : (
            a.initial_sync_count > 0 && <span className="tnum"> · {a.initial_sync_count} messages</span>
          )}
          {a.last_synced_at ? <span> · {fmtRelative(a.last_synced_at)}</span> : null}
        </span>
      )}
      <Button size="xs" variant="ghost" onClick={() => sync.mutate(a.id)} disabled={sync.isPending} className="text-muted-foreground">
        Sync now
      </Button>
    </div>
  );
}

export type Health = "syncing" | "problem" | "ok";
export const healthOf = (a: Account): Health =>
  a.sync_status === "error" || a.sync_status === "disconnected" ? "problem" : !a.initial_sync_done || a.sync_status === "syncing" || (a.import_remaining ?? 0) > 0 ? "syncing" : "ok";

/** One mailbox's state in a few words: when it last synced, that it is busy, or what went wrong. */
export function syncText(a: Account): string {
  const h = healthOf(a);
  if (h === "problem") return a.sync_error || (a.sync_status === "disconnected" ? "Stopped syncing" : "Sync problem");
  if ((a.import_remaining ?? 0) > 0) return `Importing mail: ${Math.max(0, (a.import_total ?? 0) - (a.import_remaining ?? 0)).toLocaleString()} of ${(a.import_total ?? 0).toLocaleString()}`;
  if (h === "syncing") return a.initial_sync_done ? "Syncing now" : "First sync in progress";
  return a.last_synced_at ? `Synced ${fmtRelative(a.last_synced_at)}` : "Not synced yet";
}

/**
 * Where mail stands across the mailboxes in view: which are fine, which are busy, which need attention, when it last synced, and a way
 * to sync them all now. It backs the status row in the account switcher and the dot on the switcher itself.
 */
export function useSyncHealth() {
  const { accounts, account, scope } = useAccount();
  const { syncMany } = useAccountMutations();
  const [running, setRunning] = useState(false);
  const targets = (scope === ALL ? accounts.filter((a) => !a.is_agent) : account ? [account] : []).slice();
  const rank: Record<Health, number> = { problem: 0, syncing: 1, ok: 2 };
  targets.sort((a, b) => rank[healthOf(a)] - rank[healthOf(b)] || a.email.localeCompare(b.email));
  const problems = targets.filter((a) => healthOf(a) === "problem");
  const syncing = targets.filter((a) => healthOf(a) === "syncing");
  const last = Math.max(0, ...targets.map((a) => a.last_synced_at ?? 0));
  const state: Health = problems.length ? "problem" : syncing.length || running ? "syncing" : "ok";
  const label =
    state === "problem" ? `${problems.length} ${problems.length === 1 ? "mailbox needs" : "mailboxes need"} attention`
    : state === "syncing" ? "Syncing…"
    : last ? `Synced ${fmtRelative(last)}` : "Up to date";

  const syncAll = async () => {
    setRunning(true);
    await syncMany.mutateAsync(targets.filter((a) => healthOf(a) !== "problem" || a.sync_status === "error").map((a) => a.id)).catch(() => {});
    setRunning(false);
  };
  return { targets, problems, syncing, state, label, running, syncAll };
}

/** A small badge for the corner of the account switcher: nothing when all is well, a spinner while syncing, an amber dot when a mailbox needs attention. */
export function SyncBadge({ className }: { className?: string }) {
  const { state } = useSyncHealth();
  if (state === "ok") return null;
  return (
    <span
      className={cn("absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-background", className)}
      aria-label={state === "problem" ? "A mailbox needs attention" : "Syncing"}
    >
      {state === "syncing" ? <Loader2 size={11} className="animate-spin text-muted-foreground" /> : <span className="size-2 rounded-full bg-amber-500" />}
    </span>
  );
}

/** A small chip for a page subtitle: only there while something is syncing or needs attention, and tapping it opens the details. */
export function SyncChip({ onClick, className }: { onClick?: () => void; className?: string }) {
  const { state, problems } = useSyncHealth();
  if (state === "ok") return null;
  const problem = state === "problem";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium active:opacity-70",
        problem ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {problem ? <AlertTriangle size={12} /> : <Loader2 size={12} className="animate-spin" />}
      {problem ? `${problems.length} ${problems.length === 1 ? "needs" : "need"} attention` : "Syncing…"}
    </button>
  );
}

/** The status line at the top of the account switcher: how mail stands, and Sync now. Stays open when pressed, so the change can be watched. */
export function SyncSummary({ className, large }: { className?: string; large?: boolean }) {
  const { targets, state, label, running, syncAll } = useSyncHealth();
  if (targets.length === 0) return null;
  return (
    <div className={cn("mx-1 mb-1.5 flex items-center gap-2 rounded-md bg-muted/50 px-2.5", large ? "py-2" : "py-1.5", className)}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {state === "syncing" ? <Loader2 size={13} className="animate-spin text-muted-foreground" /> : state === "problem" ? <AlertTriangle size={13} className="text-amber-600 dark:text-amber-500" /> : <span className="size-1.5 rounded-full bg-emerald-500" />}
      </span>
      <span className={cn("min-w-0 flex-1 truncate tnum", large ? "text-[14px]" : "text-[13px]", state === "problem" ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      <Button
        type="button"
        size={large ? "sm" : "xs"}
        variant="outline"
        className={cn("shrink-0", large && "h-9")}
        disabled={running}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void syncAll();
        }}
      >
        {running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
      </Button>
    </div>
  );
}
