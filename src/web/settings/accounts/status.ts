import type { Account } from "@shared/types";
import { fmtRelative } from "@/lib/format";

export function statusOf(a: Account): { label: string; spin?: boolean } {
  if (a.provider === "domain") return { label: "Mailbox · receives from your mail server" };
  if (a.provider === "imap" && a.sync_status === "idle" && (a.import_remaining ?? 0) > 0) {
    const total = Math.max(a.import_total ?? 0, a.import_remaining ?? 0);
    return { label: `Importing mail · ${Math.max(0, total - (a.import_remaining ?? 0)).toLocaleString()} of ${total.toLocaleString()}`, spin: true };
  }
  if (a.provider === "imap" && a.sync_status === "idle") {
    // What matters about a mailbox is whether it is keeping up, not which protocol it speaks.
    if (!a.initial_sync_done) return { label: "Connecting", spin: true };
    return { label: a.last_synced_at ? `Up to date · ${fmtRelative(a.last_synced_at)}` : "Up to date" };
  }
  if (a.sync_status === "disconnected") return { label: "Disconnected" };
  if (a.sync_status === "error") return { label: "Sync error" };
  if (!a.initial_sync_done) return { label: "Connecting", spin: true };
  if (a.sync_status === "syncing") return { label: "Syncing", spin: true };
  return { label: "Synced" };
}

/** A mailbox that has stopped syncing and needs a person: the sync failed, or its sign-in was refused. */
export const isBroken = (a: Account) => a.sync_status === "error" || a.sync_status === "disconnected";
