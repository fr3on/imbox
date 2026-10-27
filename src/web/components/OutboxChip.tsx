import { useEffect, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompose } from "../context/ComposeContext";
import { outbox, statusText, useOutbox } from "../lib/outbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";


/** The unsent messages with what can be done to each. Used by the chip's popover and sheet, and by the phone's combined sheet. */
export function OutboxList({ big, onEdit }: { big?: boolean; onEdit?: () => void }) {
  const items = useOutbox();
  const { retryUnsent, editUnsent } = useCompose();
  const [now, setNow] = useState(() => Date.now());
  const [sure, setSure] = useState<string | null>(null);
  useEffect(() => {
    if (!items.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [items.length]);
  const phone = !!big;
  const btn = phone ? "default" : "xs";
  return (
    <ul className="divide-y divide-border/60">
      {items.map((it) => (
        <li key={it.id} className={phone ? "px-4 py-3" : "px-2.5 py-2.5"}>
          <div className={cn("truncate font-medium", phone ? "text-[15px]" : "text-sm")}>{it.subject}</div>
          <div className={cn("mt-0.5", phone ? "text-[13px]" : "text-xs", it.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
            To {it.to} · {statusText(it, now)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {it.state === "sending" ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Sending
              </span>
            ) : (
              <>
                <Button size={btn} className={phone ? "flex-1" : undefined} onClick={() => retryUnsent(it.id)}>
                  {it.state === "retrying" ? "Try now" : "Retry"}
                </Button>
                {it.state === "retrying" ? (
                  <Button size={btn} variant="ghost" className="text-muted-foreground" onClick={() => outbox.update(it.id, { state: "failed", nextAt: null, error: "Stopped. Not sent." })}>
                    Stop trying
                  </Button>
                ) : (
                  <>
                    <Button size={btn} variant="outline" onClick={() => { onEdit?.(); editUnsent(it.id); }}>
                      Edit
                    </Button>
                    {sure === it.id ? (
                      <Button size={btn} variant="ghost" className="text-destructive" onClick={() => { outbox.remove(it.id); setSure(null); }}>
                        Discard it?
                      </Button>
                    ) : (
                      <Button size={btn} variant="ghost" className="text-muted-foreground" onClick={() => setSure(it.id)}>
                        Discard
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OutboxNote({ big }: { big?: boolean }) {
  return <p className={cn("text-muted-foreground", big ? "px-4 pb-2 pt-1 text-[12.5px]" : "px-2.5 pb-1.5 pt-1 text-[11.5px]")}>Edit a message to change it before sending again.</p>;
}
/**
 * Messages that have not gone: a chip in the header ("1 not sent") that stays until each is sent or discarded. Click it for the list, with the reason,
 * a Retry and a way to open the message to change it. One still being retried by itself shows when the next try is, and can be tried now or stopped.
 *
 * On a phone (`sheet`) the same list opens as a bottom sheet with full-width buttons, and the chip sits in the title row next to the bell. `floating`
 * is for phone screens that have no title row to put it in: the chip is pinned to the top right and opens the same sheet.
 */
export function OutboxChip({ floating, sheet }: { floating?: boolean; sheet?: boolean }) {
  const items = useOutbox();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!items.length) setOpen(false);
  }, [items.length]);
  if (!items.length) return null;

  const phone = !!sheet || !!floating;
  const failed = items.filter((i) => i.state === "failed").length;
  const label = failed ? `${failed} not sent` : `${items.length} sending`;
  const onOpenChange = (o: boolean) => {
    setOpen(o);
  };

  const trigger = (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        // The app is black and white, so a failure is the one solid chip in the header, where it cannot be missed.
        failed ? "border-transparent bg-foreground text-background hover:bg-foreground/90" : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
      )}
      aria-label={`${label}. Open the list`}
      onClick={phone ? () => setOpen(true) : undefined}
    >
      {failed ? <CircleAlert className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
      {label}
    </button>
  );

  const list = <OutboxList big={phone} onEdit={() => setOpen(false)} />;
  const note = <OutboxNote big={phone} />;

  const chip = phone ? (
    <>
      {trigger}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="pb-safe">
          <DrawerHeader className="pb-1 text-left">
            <DrawerTitle className="text-[15px]">{failed ? "Not sent" : "Sending"}</DrawerTitle>
            <DrawerDescription className="sr-only">Messages that have not gone out yet</DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto">{list}</div>
          {note}
        </DrawerContent>
      </Drawer>
    </>
  ) : (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] rounded-xl p-1.5">
        {list}
        {note}
      </PopoverContent>
    </Popover>
  );
  if (!floating) return chip;
  return <div className="fixed right-3 z-50" style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}>{chip}</div>;
}
