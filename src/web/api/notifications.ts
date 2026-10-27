import { pickToAnnounce } from "@/lib/notifyPick";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useLivePoll } from "./live";

export interface NotificationItem {
  id: string;
  kind: "mail" | "sender" | "sync" | "invite" | "agent";
  title: string;
  body: string;
  link: string;
  at: number;
  mailbox: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  seen_at: number;
  unread: number;
}

/**
 * The notification center's list. Polled every 30 seconds even when the tab is in the background, which is the whole point: a
 * pop-up for new mail can only appear if something is still looking while you are somewhere else.
 */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationsResponse>("/api/notifications"),
    enabled,
    refetchInterval: useLivePoll(30_000),
    refetchIntervalInBackground: true,
    staleTime: 10_000,
  });
}

/** Opening the list counts as having looked: everything up to now stops being new. */
export function useMarkNotificationsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; seen_at: number }>("/api/notifications/seen"),
    onSuccess: (r) => qc.setQueryData<NotificationsResponse>(["notifications"], (old) => (old ? { ...old, seen_at: r.seen_at, unread: 0 } : old)),
  });
}

/**
 * Pop-up notifications (when the browser has been allowed to show them). They come from the notification list, so they cover new
 * mail, a new sender at the Screener, a mailbox that has stopped syncing and a meeting invitation, not only the Imbox.
 * Nothing is announced for what was already there when the app started watching, or every visit would replay the inbox.
 */
export function useNewMailNotifier(enabled: boolean) {
  const feed = useNotifications(enabled);
  const nav = useNavigate();
  const startedAt = useRef<number>(Date.now());
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      announced.current = new Set();
      startedAt.current = Date.now();
      void import("@/lib/notifications").then(({ syncAppBadge }) => syncAppBadge(0));
    }
  }, [enabled]);

  // Once notifications are allowed, this browser also gets set up to be told with the app closed.
  useEffect(() => {
    if (enabled) void import("@/lib/push").then(({ ensurePush }) => ensurePush());
  }, [enabled]);

  useEffect(() => {
    const unread = feed.data?.unread;
    if (!enabled || unread === undefined) return;
    void import("@/lib/notifications").then(({ syncAppBadge }) => syncAppBadge(unread));
  }, [enabled, feed.data?.unread]);

  useEffect(() => {
    if (!enabled || !feed.data) return;
    const fresh = pickToAnnounce(feed.data.items, announced.current, startedAt.current);
    for (const n of fresh) {
      announced.current.add(n.id);
      void import("@/lib/notifications").then(({ notifyNewItem }) =>
        notifyNewItem(n.kind, n.title, n.body, () => nav(n.link), n.id, n.link)
      );
    }
  }, [feed.data, enabled, nav]);
}
