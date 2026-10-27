import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Calendar, GoogleCalendarAccount } from "@shared/types";
import { useCalendarSourceMutations } from "../../api";
import { BrandIcon } from "../BrandIcons";
import { Danger } from "../../settings/parts";
import { fmtRelative } from "../../lib/format";
import { isGooglePublicCalendarLink } from "../../lib/calendarLinks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ColourPicker } from "./ColourPicker";
import { AccountHeader } from "./AccountHeader";

/**
 * What can be done with one calendar, in the drawer that opens from its tile. The tick is visibility, not existence: hiding keeps the
 * calendar and its events and only takes it out of the views.
 */
export function CalendarOptions({ c, account, pending, onConnect, onClose }: { c: Calendar; account: GoogleCalendarAccount | undefined; pending: string | null; onConnect: (a: GoogleCalendarAccount) => void; onClose: () => void }) {
  const { update, remove, sync } = useCalendarSourceMutations();
  const [name, setName] = useState(c.name);
  const [del, setDel] = useState(false);
  useEffect(() => setName(c.name), [c.name]);
  const fail = (e: unknown) => toast.error((e as Error).message);

  const rename = () => {
    const v = name.trim();
    if (!v || v === c.name) { setName(c.name); return; }
    update.mutate({ id: c.id, name: v }, { onError: (e) => { setName(c.name); fail(e); } });
  };

  // A feed's address, a local calendar's size, and when a synced one last came down.
  const where =
    c.source === "ics"
      ? c.url ?? ""
      : c.source === "local" && typeof c.event_count === "number"
        ? `${c.event_count} event${c.event_count === 1 ? "" : "s"}${c.account_id ? " · not synced with a server" : ""}`
        : "";
  const synced = c.source !== "local" && c.last_synced_at ? `Synced ${fmtRelative(c.last_synced_at)}` : "";
  // Subscribed through Google's public address: it shares busy times only. Say so where it shows up, not only when it is added.
  const busyOnly = c.source === "ics" && isGooglePublicCalendarLink(c.url) ? "Busy times only. Replace it with the secret address." : "";
  const source = c.source === "ics" ? "Subscribed link" : c.source === "google" ? "Google Calendar" : c.account_id ? "Mailbox calendar" : "Kept in imbox";

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>{c.name}</SheetTitle>
        <SheetDescription>{source}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
        <div className="flex items-center gap-2 py-2">
          <ColourPicker value={c.color} onChange={(hex) => update.mutate({ id: c.id, color: hex }, { onError: fail })} />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(c.name); e.currentTarget.blur(); } }}
            aria-label={`Name of ${c.name}`}
            className="h-8"
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 py-3">
          <div className="text-sm">Show in the calendar</div>
          <Switch checked={c.visible} aria-label={`Show ${c.name} in the calendar`} onCheckedChange={(v) => update.mutate({ id: c.id, visible: v }, { onError: fail })} />
        </div>
        {c.writable && (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 py-3">
            <div>
              <div className="text-sm">New events go here</div>
              <div className="text-xs text-muted-foreground">{c.is_default ? "This is the default calendar." : "Make this the default calendar."}</div>
            </div>
            <Button size="sm" variant="outline" disabled={c.is_default} onClick={() => update.mutate({ id: c.id, is_default: true }, { onError: fail })}>
              {c.is_default ? "Default" : "Make default"}
            </Button>
          </div>
        )}
        {c.source !== "local" && (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 py-3">
            <div>
              <div className="text-sm">Sync now</div>
              {synced && <div className="text-xs text-muted-foreground">{synced}</div>}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={sync.isPending}
              onClick={() => sync.mutate(c.id, { onSuccess: (r) => (r.error ? toast.error(r.error) : toast(`${c.name} is up to date`)), onError: fail })}
            >
              <RefreshCw className={cn(sync.isPending && "animate-spin")} /> Sync
            </Button>
          </div>
        )}
        {(where || busyOnly || c.sync_error) && (
          <div className="space-y-1 border-t border-border/60 py-3 text-xs text-muted-foreground">
            {where && <div className="break-all tnum">{where}</div>}
            {busyOnly && <div>{busyOnly}</div>}
            {c.sync_error && <div className="text-foreground">Last sync failed: {c.sync_error}</div>}
          </div>
        )}
        {c.source === "google" && account && (
          <div className="border-t border-border/60 py-3">
            <AccountHeader a={account} count={1} pending={pending} onConnect={onConnect} />
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 py-3">
          <div className="text-sm">Remove this calendar</div>
          <Button size="sm" variant="outline" onClick={() => setDel(true)}>
            <BrandIcon name="trash" /> Remove
          </Button>
        </div>
      </div>
      <Danger
        open={del}
        onOpenChange={setDel}
        title={`Remove ${c.name}?`}
        body={
          c.account_id && (c.source === "local" || c.source === "caldav")
            ? "Removes this mailbox\u2019s calendar and its events from Imbox. The mailbox and its mail are untouched."
            : c.source === "google"
            ? "Removes it and its events from Imbox for good. Google Calendar is untouched; to see it here again, reconnect the account\u2019s calendar access."
            : c.source === "ics"
              ? "Stops following the link and deletes the events it brought in. The feed is untouched."
              : "Deletes the calendar and every event on it. There's no undo."
        }
        action="Remove calendar"
        onConfirm={() => remove.mutate(c.id, { onSuccess: () => { toast(`${c.name} removed`); onClose(); }, onError: (e) => toast.error((e as Error).message) })}
      />
    </>
  );
}
