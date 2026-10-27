import { type QueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { keys } from "./keys";
import type { ThreadAction } from "./mail";

/**
 * The list caches come in two shapes: infinite queries (`pages[].threads`) and flat ones such as a
 * label's threads (`{ threads }`). Anything that rewrites "the lists" has to cope with both — the
 * `["threads"]` prefix matches both kinds.
 */
type ThreadLists = { pages: { threads: T.ThreadSummary[]; next_page: number | null }[]; pageParams: unknown[] } | { threads: T.ThreadSummary[] };

function mapLists(qc: QueryClient, fn: (arr: T.ThreadSummary[]) => T.ThreadSummary[]) {
  for (const key of [["threads"], ["feed"], ["search"]]) {
    qc.setQueriesData<ThreadLists>({ queryKey: key }, (old) => {
      if (!old) return old;
      if ("pages" in old) return { ...old, pages: old.pages.map((p) => ({ ...p, threads: fn(p.threads) })) };
      if ("threads" in old) return { ...old, threads: fn(old.threads) };
      return old;
    });
  }
}

/** Optimistically drop threads from list caches (imbox + paged lists). */
export function removeThreadsFromLists(qc: QueryClient, ids: string[]) {
  const set = new Set(ids);
  const f = (arr: T.ThreadSummary[]) => arr.filter((t) => !set.has(t.id));
  qc.setQueriesData<T.ImboxResponse>({ queryKey: keys.imbox }, (old) =>
    old ? { ...old, new_threads: f(old.new_threads), seen_threads: f(old.seen_threads), reply_later: f(old.reply_later), set_aside: f(old.set_aside) } : old,
  );
  mapLists(qc, f);
}

/**
 * Mark threads read or unread everywhere they are cached, now, before the server has answered.
 *
 * A read/unread flip used to reach the screen only after the round trip *and* the full refetch of
 * every list — the better part of a second in which the dot stayed put and the row sat in the wrong
 * section. Every cache gets a fresh object for the thread (the rows are memoised on identity), the
 * Imbox moves it between "New for you" and "Previously seen", the open thread's own messages follow,
 * and the sidebar counts shift by exactly the threads whose state actually changed.
 */
export function markThreadsSeen(qc: QueryClient, ids: string[], seen: boolean) {
  const set = new Set(ids);
  const flipped = new Map<string, T.Bucket>();
  const patch = (t: T.ThreadSummary): T.ThreadSummary => {
    if (!set.has(t.id)) return t;
    if (t.seen !== seen && !t.reply_later && !t.set_aside) flipped.set(t.id, t.bucket);
    return t.seen === seen && t.unread === !seen ? t : { ...t, seen, unread: !seen };
  };
  const byRecency = (a: T.ThreadSummary, b: T.ThreadSummary) => b.last_message_at - a.last_message_at;

  qc.setQueriesData<T.ImboxResponse>({ queryKey: keys.imbox }, (old) => {
    if (!old) return old;
    const pool = [...old.new_threads, ...old.seen_threads].map(patch);
    return {
      ...old,
      new_threads: pool.filter((t) => !t.seen).sort(byRecency),
      seen_threads: pool.filter((t) => t.seen).sort(byRecency),
      reply_later: old.reply_later.map(patch),
      set_aside: old.set_aside.map(patch),
    };
  });
  mapLists(qc, (arr) => arr.map(patch));

  // The Feed's and Paper Trail's "New" tabs are filtered server-side (t.seen = 0), unlike the Imbox's
  // client-side split above — without this, a thread marked seen sat in "New" until the next round trip.
  if (seen) {
    qc.setQueriesData<{ pages: { threads: T.ThreadSummary[]; next_page: number | null }[]; pageParams: unknown[] }>(
      { queryKey: ["feed"], predicate: (q) => q.queryKey[q.queryKey.length - 1] === "new" },
      (old) => (old ? { ...old, pages: old.pages.map((p) => ({ ...p, threads: p.threads.filter((t) => !set.has(t.id)) })) } : old),
    );
  }

  for (const id of ids) {
    for (const key of [keys.thread(id), keys.thread(id, true)]) {
      qc.setQueryData<T.ThreadDetail>(key, (old) =>
        old ? { ...old, seen, unread: !seen, messages: seen ? old.messages.map((m) => (m.unread ? { ...m, unread: false } : m)) : old.messages } : old,
      );
    }
  }

  if (flipped.size) {
    const delta = seen ? -1 : 1;
    qc.setQueryData<T.Counts>(keys.counts, (old) => {
      if (!old) return old;
      const next = { ...old };
      for (const bucket of flipped.values()) {
        if (bucket === "imbox") next.imbox_new = Math.max(0, next.imbox_new + delta);
        else if (bucket === "feed") next.feed_new = Math.max(0, next.feed_new + delta);
        else if (bucket === "paper_trail") next.paper_trail_new = Math.max(0, next.paper_trail_new + delta);
      }
      return next;
    });
  }
}

/** The optimistic half of a read/unread action, if the action is one. */
export function seenFromAction(a: ThreadAction): boolean | null {
  return a.action === "mark_unread" ? false : a.action === "mark_read" || a.action === "seen" ? true : null;
}
