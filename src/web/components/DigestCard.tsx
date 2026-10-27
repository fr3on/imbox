import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandIcon } from "./BrandIcons";
import { useDigest, useDigestRefresh } from "../api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const HIDE_KEY = "inbox.digest.hidden";
const hiddenDay = (): string => {
  try {
    return localStorage.getItem(HIDE_KEY) ?? "";
  } catch {
    return "";
  }
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The top of Updates: the AI reads the newsletters, receipts and notices waiting to be read and says what they hold, grouped by theme, each with
 * the mails it came from. It is written when the page is opened and again when new mail has arrived. Nothing shows with no AI set up or nothing to read.
 */
export function DigestCard({ enabled = true, compact, fold, className }: { enabled?: boolean; compact?: boolean; /** Start as one line (the themes); "Read more" opens the whole digest. */ fold?: boolean; className?: string }) {
  const q = useDigest(enabled);
  const refresh = useDigestRefresh();
  const tried = useRef("");
  const [hidden, setHidden] = useState(hiddenDay);
  const [open, setOpen] = useState(false);
  const d = q.data;
  // Write a fresh one once per set of mail: when none exists yet, or new mail has come in.
  useEffect(() => {
    if (!d?.ai_enabled || !d.count || !d.stale || refresh.isPending || tried.current === d.key) return;
    tried.current = d.key;
    refresh.mutate({});
  }, [d, refresh]);

  if (!d?.ai_enabled || !d.count) return null;
  const digest = d.digest;
  if (digest && hidden === digest.day) return null;
  const busy = refresh.isPending;

  const hide = () => {
    if (!digest) return;
    try {
      localStorage.setItem(HIDE_KEY, digest.day);
    } catch {
      /* private mode: it just comes back on reload */
    }
    setHidden(digest.day);
  };

  if (fold && !open && digest) {
    return (
      <section aria-label="Feed digest" className={cn("flex items-center gap-2.5 rounded-xl bg-muted/50 px-3.5 py-2.5 text-[13px] text-muted-foreground", className)}>
        <BrandIcon name="assistant" size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">Today:</span> {digest.sections.map((x) => x.theme).join(", ")}.
        </span>
        <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" onClick={() => setOpen(true)}>
          Read more
        </Button>
        <Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label="Hide for today" onClick={hide}>
          <X />
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Feed digest" className={cn("rounded-xl border border-border/70 bg-card", compact ? "px-4 py-3.5" : "px-5 py-4", className)}>
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <BrandIcon name="assistant" size={13} />
        <span>In your Feed today</span>
        <span className="flex-1" />
        {fold && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen(false)}>
            Show less
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Write it again" disabled={busy} onClick={() => refresh.mutate({ force: true })}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
        {digest && (
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Hide for today" onClick={hide}>
            <X />
          </Button>
        )}
      </header>

      {digest ? (
        <div className="mt-2.5 space-y-3">
          {digest.sections.map((s) => (
            <div key={s.theme}>
              <p className={cn("leading-relaxed", compact ? "text-[14px]" : "text-[14.5px]")}>
                <span className="font-semibold">{s.theme}.</span> {s.text}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.sources.map((src) => (
                  <Link
                    key={src.thread_id}
                    to={`/t/${src.thread_id}`}
                    title={src.subject}
                    className="max-w-[14rem] truncate rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {src.from}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : busy ? (
        <div className="mt-3 space-y-2" aria-busy>
          <Skeleton className="h-4 w-[88%]" />
          <Skeleton className="h-4 w-[70%]" />
          <Skeleton className="h-4 w-[80%]" />
        </div>
      ) : refresh.isError ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Couldn&rsquo;t write the digest.{" "}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => refresh.mutate({ force: true })}>
            Try again
          </button>
        </p>
      ) : null}

      {digest && (
        <p className="mt-3 text-[11.5px] text-tertiary">
          {busy ? "Updating with new mail…" : `Written from ${digest.count} ${digest.count === 1 ? "mail" : "mails"} · ${clock(digest.created_at)}`}
        </p>
      )}
    </section>
  );
}
