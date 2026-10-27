import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Calendar, GoogleCalendarAccount } from "@shared/types";
import { useCalendarConnectLink, useCalendarSourceMutations } from "../../api";
import { Section } from "../../settings/parts";
import { isNative, openExternalUrl } from "../../lib/native";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { NEW_ACCOUNT, AccountHeader } from "./AccountHeader";
import { CalendarOptions } from "./CalendarOptions";
import { SubscribeDialog } from "./SubscribeDialog";
import { ImportDialog } from "./ImportDialog";

export function Calendars({ calendars, accounts, loading, error }: { calendars: Calendar[]; accounts: GoogleCalendarAccount[]; loading: boolean; error: string | null }) {
  const { create } = useCalendarSourceMutations();
  const link = useCalendarConnectLink();
  const [pending, setPending] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"subscribe" | "import" | null>(null);

  const open = (key: string, body: { account_id?: string; calendar_only?: boolean }) => {
    setPending(key);
    link.mutate(body, {
      onSuccess: ({ url }) => {
        // The consent screen has to run where the user's Google session lives: the real browser in
        // the Mac and iOS shells, this tab everywhere else.
        if (isNative) {
          openExternalUrl(url);
          toast("Finish in your browser, then come back.");
          setPending(null);
        } else {
          location.assign(url);
        }
      },
      onError: (e) => { setPending(null); toast.error((e as Error).message); },
    });
  };
  // An account we hold no mail scope for stays that way: reconnecting it must not quietly ask for mail the owner never granted.
  const connect = (acc: GoogleCalendarAccount) => open(acc.id, { account_id: acc.id, calendar_only: !acc.mail });

  // A mailbox's own calendar is a local one tied to an account. Tiles run mailboxes, Google, then what lives in imbox, then links.
  const isMailboxCal = (c: { source: string; account_id: string | null }) => !!c.account_id && (c.source === "local" || c.source === "caldav");
  const tiles = [
    ...calendars.filter(isMailboxCal),
    ...calendars.filter((c) => c.source === "google"),
    ...calendars.filter((c) => c.source === "local" && !isMailboxCal(c)),
    ...calendars.filter((c) => c.source === "ics"),
  ];
  const selected = tiles.find((c) => c.id === openId) ?? null;
  // Accounts that need a look: not connected for calendar, or with something wrong. A healthy one is reached from its calendars.
  const needAttention = accounts.filter((a) => !a.calendar || a.sync_error || a.calendar_error);
  const hidden = tiles.filter((c) => !c.visible).length;

  return (
    <Section
      title="Calendars"
      collapsible
      defaultOpen
      summary={tiles.length === 0 ? "None yet" : `${tiles.length} calendar${tiles.length === 1 ? "" : "s"}${hidden ? `, ${hidden} hidden` : ""}`}
      description={`Click a calendar to change it.${hidden ? ` ${hidden} hidden.` : ""} Dimmed ones are hidden, not deleted.`}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={pending === NEW_ACCOUNT}>
              <Plus /> Add calendar <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuItem
              disabled={create.isPending}
              onSelect={() =>
                create.mutate(
                  { name: "New calendar", color: "#111111" },
                  { onSuccess: (c) => { toast("Calendar added"); setOpenId(c.id); }, onError: (e) => toast.error((e as Error).message) },
                )
              }
            >
              New calendar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("subscribe")}>Subscribe to a link…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("import")}>Import an .ics file…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => open(NEW_ACCOUNT, { calendar_only: true })} title="Asks Google for calendar access only, never mail">
              Connect a calendar-only account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {loading && (
        <div className="space-y-2 px-4 py-3 sm:px-5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      )}
      {error && <div className="px-4 py-3 text-[13px] text-muted-foreground sm:px-5">{error}</div>}

      {!loading && !error && (
        <>
          {accounts.length === 0 && (
            <div className="px-4 pt-3 text-xs text-muted-foreground sm:px-5">
              No Google account yet — connect one for mail under{" "}
              <Link to="/settings/accounts" className="underline underline-offset-2 hover:text-foreground">Accounts</Link>, or add a calendar-only account from the menu.
            </div>
          )}
          {tiles.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground sm:px-5">No calendars yet.</div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 px-4 py-3 sm:grid-cols-3 sm:px-5">
              {tiles.map((c) => (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    title={c.name}
                    className={cn("flex w-full min-w-0 items-center gap-2 rounded-xl border border-border/80 bg-card px-3 py-2.5 text-left text-[13px] outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring", !c.visible && "opacity-55")}
                  >
                    <span className="size-2.5 shrink-0 rounded-full border border-border" style={{ background: c.color }} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.is_default && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] leading-4 text-muted-foreground">Default</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {needAttention.length > 0 && (
            <div className="px-4 pb-4 sm:px-5">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Google accounts</div>
              <div className="divide-y divide-border rounded-xl border border-border/80">
                {needAttention.map((a) => (
                  <AccountHeader key={a.id} a={a} count={calendars.filter((c) => c.account_id === a.id).length} pending={pending} onConnect={connect} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right">
          {selected && (
            <CalendarOptions
              c={selected}
              account={accounts.find((a) => a.id === selected.account_id)}
              pending={pending}
              onConnect={connect}
              onClose={() => setOpenId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
      <SubscribeDialog open={dialog === "subscribe"} onClose={() => setDialog(null)} />
      <ImportDialog open={dialog === "import"} calendars={calendars} onClose={() => setDialog(null)} />
    </Section>
  );
}
