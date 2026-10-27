// Messages that have not gone yet. A send that fails is kept here (and in this browser's storage) instead of vanishing with an alert, and a
// failure that can pass, like a busy server, is tried again by itself a few times. The server recognises a repeat by its client id, so a retry
// can never put the same message out twice. The chip in the header shows what is in here.

import { useSyncExternalStore } from "react";

export interface OutboxPayload {
  subject?: string;
  to?: { email: string; name?: string }[];
  client_id?: string;
  [key: string]: unknown;
}

export interface OutboxItem {
  /** The send's client id: the same on every try. */
  id: string;
  payload: OutboxPayload;
  subject: string;
  /** Who it is to, for the list. */
  to: string;
  /** retrying: waiting for the next try. sending: a try is in flight. failed: needs the person. */
  state: "retrying" | "sending" | "failed";
  /** How many tries have failed so far. */
  attempt: number;
  nextAt: number | null;
  error: string;
  created: number;
}

/** After the first failure the app tries again after these waits, then gives up and asks. */
export const RETRY_AFTER_MS = [5_000, 15_000, 45_000];

/** The sentence the client shows when a platform in front of the app answered with an error page instead of the app. */
export const BUSY_MESSAGE = "The server is too busy right now. Try again in a moment.";

/** Errors that can pass by themselves: no answer, a busy or restarting server, a repeat that is still going. Not a rejected address or key. */
export function isTransient(e: { status?: number; message?: string }): boolean {
  if (e.status === undefined || e.status === 0) return true;
  if ([408, 425, 429, 503, 504].includes(e.status)) return true;
  if (e.status === 409 && /already being sent/i.test(e.message ?? "")) return true;
  return e.message === BUSY_MESSAGE || e.message === "gateway error";
}

const SAYS: Record<string, string> = {
  smtp_not_configured: "No outgoing mail server is set up for this mailbox.",
  sending_not_configured: "No outgoing mail provider is set up for this mailbox.",
  account_disconnected: "This mailbox is disconnected. Reconnect it in Settings.",
  no_recipients: "There is no recipient.",
  invalid_account: "That mailbox is not available.",
};

/** A code the server sends (smtp_not_configured) turned into a sentence; anything already written for a person is left as it is. */
export function friendlyError(message: string): string {
  const m = (message || "").trim();
  if (SAYS[m]) return SAYS[m];
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(m)) {
    const words = m.replace(/_/g, " ");
    return `${words[0].toUpperCase()}${words.slice(1)}.`;
  }
  return m;
}

/** What the list says under a message: why it failed, or when the next try is. */
export function statusText(it: Pick<OutboxItem, "state" | "nextAt" | "error">, now = Date.now()): string {
  if (it.state === "sending") return "sending now";
  if (it.state === "retrying") {
    const s = Math.max(0, Math.ceil(((it.nextAt ?? now) - now) / 1000));
    return s > 0 ? `trying again in ${s} s` : "trying again";
  }
  return it.error || "not sent";
}

/** A short line for who it is to. */
export function toText(to: OutboxPayload["to"]): string {
  const list = (to ?? []).map((a) => a.name || a.email).filter(Boolean);
  if (!list.length) return "no recipient";
  return list.length > 2 ? `${list[0]}, ${list[1]} +${list.length - 2}` : list.join(", ");
}

const KEY = "inbox.outbox.v1";
type Listener = () => void;

function load(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    // A try that was in flight when the page closed is picked up again shortly. The server's repeat check keeps that safe.
    return Array.isArray(list) ? list.map((i) => (i.state === "sending" ? { ...i, state: "retrying" as const, nextAt: Date.now() + 2000 } : i)) : [];
  } catch {
    return [];
  }
}

let items: OutboxItem[] = typeof localStorage === "undefined" ? [] : load();
const listeners = new Set<Listener>();
function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage full or blocked (a big attachment, a private window): the list still works for this session.
  }
  listeners.forEach((l) => l());
}

export const outbox = {
  get: () => items,
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  /** Put a failed send in the list. A first failure that can pass starts the retries; anything else waits for the person. */
  add(payload: OutboxPayload, id: string, error: { status?: number; message: string }) {
    const transient = isTransient(error);
    const item: OutboxItem = {
      id,
      payload,
      subject: payload.subject?.trim() || "(no subject)",
      to: toText(payload.to),
      state: transient ? "retrying" : "failed",
      attempt: 1,
      nextAt: transient ? Date.now() + RETRY_AFTER_MS[0] : null,
      error: friendlyError(error.message),
      created: Date.now(),
    };
    items = [...items.filter((i) => i.id !== id), item];
    emit();
  },
  update(id: string, patch: Partial<OutboxItem>) {
    items = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    emit();
  },
  /** A try failed. Another is scheduled while there are waits left (and it was an automatic try); otherwise the person is asked. */
  failed(id: string, error: { status?: number; message: string }, automatic: boolean) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const wait = RETRY_AFTER_MS[it.attempt];
    if (automatic && isTransient(error) && wait !== undefined) outbox.update(id, { state: "retrying", attempt: it.attempt + 1, nextAt: Date.now() + wait, error: friendlyError(error.message) });
    else outbox.update(id, { state: "failed", attempt: it.attempt + 1, nextAt: null, error: friendlyError(error.message) });
  },
  remove(id: string) {
    items = items.filter((i) => i.id !== id);
    emit();
  },
};

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(outbox.subscribe, outbox.get, outbox.get);
}
