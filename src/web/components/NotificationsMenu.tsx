import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Bot, CalendarPlus, Check, CircleAlert, Loader2, Mail, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarkNotificationsSeen, useNotifications, type NotificationItem } from "../api";
import { useAccount } from "../context/AccountContext";
import { fmtRelative } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useOutbox } from "../lib/outbox";
import { OutboxList, OutboxNote } from "./OutboxChip";

const ICON: Record<NotificationItem["kind"], typeof Mail> = {
  mail: Mail,
  sender: ShieldQuestion,
  sync: AlertTriangle,
  invite: CalendarPlus,
  agent: Bot,
};

type FilterTab = "all" | "unread" | "mail" | "agent" | "alerts";

/** Which day a notification belongs under, the way a person would say it. */
function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/**
 * The bell: a count of what is new since you last looked, and one place to see everything worth knowing (new mail, new senders,
 * mailboxes that need attention, invitations). Opening it counts as looking; clicking an item goes to it.
 */
export function NotificationsMenu({ className, sheet }: { className?: string; sheet?: boolean }) {
  const { accounts } = useAccount();
  const unsent = useOutbox();
  const feed = useNotifications(accounts.length > 0);
  const seen = useMarkNotificationsSeen();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FilterTab>("all");
  const items = feed.data?.items ?? [];
  const unread = feed.data?.unread ?? 0;
  const seenAt = feed.data?.seen_at ?? 0;
  const multi = accounts.filter((a) => !a.is_agent).length > 1;

  const filtered = useMemo(() => {
    if (tab === "unread") return items.filter((n) => n.at > seenAt);
    if (tab === "mail") return items.filter((n) => n.kind === "mail");
    if (tab === "agent") return items.filter((n) => n.kind === "agent");
    if (tab === "alerts") return items.filter((n) => n.kind === "sync" || n.kind === "sender" || n.kind === "invite");
    return items;
  }, [items, tab, seenAt]);

  const groups: { label: string; items: NotificationItem[] }[] = [];
  for (const n of filtered) {
    const label = dayLabel(n.at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  const agentCount = useMemo(() => items.filter((i) => i.kind === "agent").length, [items]);
  const alertsCount = useMemo(() => items.filter((i) => i.kind === "sync" || i.kind === "sender" || i.kind === "invite").length, [items]);

  // What the phone's chip says: what needs you (a message that did not go), or what is new. Quiet when there is neither.
  const failed = unsent.filter((i) => i.state === "failed").length;
  const need = failed + unread;
  const label = failed && unread ? `${need} need you` : failed ? `${failed} not sent` : unsent.length ? `${unsent.length} sending` : unread ? `${unread} new` : "";

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    // The list keeps showing which items were new while it is open; they stop counting once you have looked.
    if (!o && unread > 0) seen.mutate();
  };

  const content = (
    <>
      {sheet && unsent.length > 0 && (
        <section>
          <h3 className="px-4 pb-1 pt-2 text-[12px] font-medium text-muted-foreground">Not sent</h3>
          <OutboxList big onEdit={() => onOpenChange(false)} />
          <OutboxNote big />
        </section>
      )}
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">
              {unread > 0 ? `${unread} new since you last looked` : "You're up to date"}
            </div>
          </div>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground hover:text-foreground h-7 px-2"
              onClick={() => seen.mutate()}
            >
              <Check className="size-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>

        {/* Filter Pills */}
        {items.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/60 bg-muted/20 overflow-x-auto no-scrollbar">
            {[
              { id: "all" as const, label: "All" },
              { id: "unread" as const, label: "Unread", count: unread },
              { id: "mail" as const, label: "Mail" },
              { id: "agent" as const, label: "Agents", count: agentCount },
              { id: "alerts" as const, label: "Alerts", count: alertsCount },
            ]
              .filter((f) => f.id === "all" || f.id === "unread" || (f.count ?? 1) > 0)
              .map((f) => {
                const active = tab === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setTab(f.id)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors shrink-0 flex items-center gap-1 cursor-pointer",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <span>{f.label}</span>
                    {f.count !== undefined && f.count > 0 && (
                      <span
                        className={cn(
                          "text-[9px] px-1 py-0.2 rounded-full font-mono",
                          active ? "bg-background text-foreground" : "bg-foreground/10 text-foreground"
                        )}
                      >
                        {f.count}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        )}

        <div className={sheet ? undefined : "max-h-[440px] overflow-y-auto"}>
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              Nothing yet. New mail, new senders and invitations will show up here.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              No notifications in this category.
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.label}>
                <h3 className="sticky top-0 z-10 bg-popover/95 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
                  {g.label}
                </h3>
                <ul>
                  {g.items.map((n) => {
                    const Icon = ICON[n.kind];
                    const fresh = n.at > seenAt;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            if (unread > 0) seen.mutate();
                            nav(n.link);
                          }}
                          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none cursor-pointer"
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted",
                              n.kind === "sync" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
                            )}
                          >
                            <Icon size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-[13px]",
                                  fresh ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                                )}
                              >
                                {n.title}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground tnum">
                                {fmtRelative(n.at)}
                              </span>
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                            {multi && n.mailbox && (
                              <span className="block truncate text-[11px] text-muted-foreground/75 mt-0.5">{n.mailbox}</span>
                            )}
                          </span>
                          {fresh && (
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" aria-label="New" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
    </>
  );

  // On a phone the bell and the unsent messages are one chip. It says what is waiting on you, and the sheet holds both.
  if (sheet) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${label}. Open the list`}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            failed ? "border-transparent bg-foreground text-background" : "border-border bg-muted/60 text-foreground"
          )}
        >
          {failed ? <CircleAlert className="size-3.5" /> : unsent.length > 0 ? <Loader2 className="size-3.5 animate-spin" /> : unread > 0 ? <span className="size-1.5 rounded-full bg-foreground" /> : <Bell className="size-3.5" />}
          {label && <span className="tnum">{label}</span>}
        </button>
        <Drawer open={open} onOpenChange={onOpenChange}>
          <DrawerContent className="pb-safe">
            <DrawerHeader className="sr-only">
              <DrawerTitle>{failed ? "Needs you" : "Notifications"}</DrawerTitle>
              <DrawerDescription>Messages that have not been sent and what is new</DrawerDescription>
            </DrawerHeader>
            <div className="max-h-[75vh] overflow-y-auto pt-2">{content}</div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
          title="Notifications"
          className={cn("relative text-muted-foreground hover:text-foreground", className)}
        >
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium leading-4 text-background tnum">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[390px] max-w-[calc(100vw-1rem)] p-0 shadow-lg">
        {content}
      </PopoverContent>
    </Popover>
  );
}
