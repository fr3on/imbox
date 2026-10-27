import { useEffect, useState } from "react";
import { CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompose } from "../context/ComposeContext";
import { outbox, statusText, useOutbox, type OutboxItem } from "../lib/outbox";
import { Button } from "@/components/ui/button";

export function OutboxBanner() {
  const items = useOutbox();
  const { retryUnsent, editUnsent } = useCompose();
  const [now, setNow] = useState(() => Date.now());
  const [sure, setSure] = useState<string | null>(null);

  useEffect(() => {
    if (!items.length) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [items.length]);

  if (!items.length) return null;

  const failedItems = items.filter((i) => i.state === "failed");
  const failedCount = failedItems.length;

  const retryAll = () => {
    failedItems.forEach((it) => retryUnsent(it.id));
  };

  return (
    <div className="border-t border-border/60 bg-muted/40 transition-all">
      <div className="w-full px-4 sm:px-6">
        <div className="max-w-5xl mx-auto w-full px-2 py-2">
          {items.length > 1 && (
            <div className="flex items-center justify-between pb-1.5 pt-0.5 border-b border-border/40">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span className="flex size-4 items-center justify-center rounded-full bg-foreground text-background text-[10px]">
                  {items.length}
                </span>
                <span>
                  {failedCount ? `${failedCount} of ${items.length} messages not sent` : `${items.length} messages sending`}
                </span>
              </div>
              {failedCount > 1 && (
                <Button size="xs" variant="outline" onClick={retryAll} className="gap-1 text-[11px] h-6">
                  <RefreshCw className="size-3" /> Retry all
                </Button>
              )}
            </div>
          )}

          <div className={cn("divide-y divide-border/40", items.length > 1 && "mt-1")}>
            {items.map((it) => (
              <OutboxBannerRow
                key={it.id}
                item={it}
                now={now}
                sure={sure === it.id}
                onSetSure={(val) => setSure(val ? it.id : null)}
                onRetry={() => retryUnsent(it.id)}
                onEdit={() => editUnsent(it.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutboxBannerRow({
  item: it,
  now,
  sure,
  onSetSure,
  onRetry,
  onEdit,
}: {
  item: OutboxItem;
  now: number;
  sure: boolean;
  onSetSure: (val: boolean) => void;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const isFailed = it.state === "failed";
  const isRetrying = it.state === "retrying";
  const isSending = it.state === "sending";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1.5">
      <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full mt-0.5 sm:mt-0",
            isFailed ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
          )}
        >
          {isFailed ? (
            <CircleAlert className="size-3" />
          ) : (
            <Loader2 className="size-3 animate-spin" />
          )}
        </span>

        <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span className="font-semibold text-foreground truncate max-w-[220px] sm:max-w-[280px]">
            {it.subject || "(no subject)"}
          </span>
          <span className="text-muted-foreground text-[11.5px] truncate max-w-[200px]">
            To {it.to}
          </span>
          <span className="text-muted-foreground/50 select-none">·</span>
          <span
            className={cn(
              "text-[11.5px]",
              isFailed ? "text-foreground/90 font-medium" : "text-muted-foreground"
            )}
          >
            {statusText(it, now)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center ml-7 sm:ml-0">
        {isSending ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground py-0.5 px-2">
            <Loader2 className="size-3 animate-spin" /> Sending…
          </span>
        ) : isRetrying ? (
          <>
            <Button size="xs" variant="default" onClick={onRetry} className="h-6 text-[11.5px]">
              Try now
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="h-6 text-[11.5px] text-muted-foreground hover:text-foreground"
              onClick={() =>
                outbox.update(it.id, {
                  state: "failed",
                  nextAt: null,
                  error: "Stopped. Not sent.",
                })
              }
            >
              Stop trying
            </Button>
          </>
        ) : (
          <>
            <Button size="xs" variant="default" onClick={onRetry} className="h-6 text-[11.5px]">
              Retry
            </Button>
            <Button size="xs" variant="outline" onClick={onEdit} className="h-6 text-[11.5px]">
              Edit
            </Button>
            {sure ? (
              <Button
                size="xs"
                variant="ghost"
                className="h-6 text-[11.5px] text-destructive hover:bg-destructive/10 font-medium"
                onClick={() => {
                  outbox.remove(it.id);
                  onSetSure(false);
                }}
              >
                Discard it?
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                className="h-6 text-[11.5px] text-muted-foreground hover:text-foreground"
                onClick={() => onSetSure(true)}
              >
                Discard
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
