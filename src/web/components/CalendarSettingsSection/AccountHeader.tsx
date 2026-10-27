import { useState } from "react";
import { CalendarPlus, CalendarX2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { GoogleCalendarAccount } from "@shared/types";
import { useCalendarDisconnect } from "../../api";
import { Danger } from "../../settings/parts";
import { Button } from "@/components/ui/button";

/**
 * Why an account has the calendar scope but no calendars. Google's most common answer by far is
 * that the Calendar API is switched off in the Cloud project, and it puts the exact enable link in
 * the message — so pull that out and make it a link rather than leaving a wall of JSON.
 */
export function CalendarErrorNote({ message }: { message: string }) {
  const disabled = /has not been used in project|is disabled/i.test(message);
  const link = message.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/[^\s"\\)]+/)?.[0];
  return (
    <div className="mt-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
      {disabled ? (
        <>
          <div>The Calendar API is off for this Google Cloud project. Turn it on and the calendars appear on the next pass.</div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline underline-offset-2">
              Enable the Google Calendar API
            </a>
          )}
        </>
      ) : (
        <>
          <div>Couldn't read this account's calendars.</div>
          <div className="mt-0.5 break-words text-muted-foreground">{message.slice(0, 300)}</div>
        </>
      )}
    </div>
  );
}

export function calendarCount(n: number): string {
  return n === 1 ? "1 calendar" : `${n} calendars`;
}

/** The key `pending` holds while the calendar-only flow is opening; no account owns it. */
export const NEW_ACCOUNT = "__new__";

/** One Google account: the address, what it's connected for, and its actions. */
export function AccountHeader({ a, count, pending, onConnect }: { a: GoogleCalendarAccount; count: number; pending: string | null; onConnect: (a: GoogleCalendarAccount) => void }) {
  const disconnect = useCalendarDisconnect();
  const [confirm, setConfirm] = useState(false);
  const busy = pending === a.id;

  return (
    <div className="px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate text-[13px] font-medium">{a.email}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {a.calendar ? calendarCount(count) : a.mail ? "mail only" : "not connected"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={a.calendar ? "Runs Google's consent screen again — fixes an expired or revoked grant" : undefined}
            onClick={() => onConnect(a)}
          >
            {a.calendar ? <RefreshCw /> : <CalendarPlus />}
            {busy ? "Opening…" : a.calendar ? "Reconnect" : "Connect calendar"}
          </Button>
          {a.calendar && (
            <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => setConfirm(true)}>
              <CalendarX2 /> Disconnect
            </Button>
          )}
        </div>
      </div>
      {a.sync_error && <div className="mt-1 text-xs">Last sync failed: {a.sync_error}</div>}
      {a.calendar_error && <CalendarErrorNote message={a.calendar_error} />}
      <Danger
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${a.email}'s calendar?`}
        body={`Removes ${count ? calendarCount(count) : "this account's calendars"} and every event on them from Imbox. Nothing changes in Google, its mail stays connected, and you can connect the calendar again later.`}
        action="Disconnect calendar"
        onConfirm={() =>
          disconnect.mutate(a.id, {
            onSuccess: () => toast(`${a.email}'s calendar disconnected`),
            onError: (e) => toast.error((e as Error).message),
          })
        }
      />
    </div>
  );
}
