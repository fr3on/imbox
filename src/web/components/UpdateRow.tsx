import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { amountOf } from "@shared/amount";
import { readableExcerpt } from "@shared/readable";
import { cleanSnippet } from "../lib/snippet";
import { fmtTime } from "../lib/format";
import { labelOf, type Label } from "../lib/updates";
import { useGistLine, type FeedThread } from "../api";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/button";

const LABEL_CLASS: Record<Label, string> = {
  Newsletter: "bg-muted text-muted-foreground",
  Receipt: "bg-muted text-muted-foreground",
  Notice: "bg-muted text-muted-foreground",
  Alert: "bg-destructive/10 text-destructive",
};

/** The line under a title: the AI's one line when there is one, else the start of the message, cleaned. */
function useSummary(t: FeedThread): string {
  const gist = useGistLine(t.id, t.gist);
  return useMemo(() => gist || readableExcerpt(t.latest_message?.text_body || "", 140) || cleanSnippet(t.snippet), [gist, t.latest_message?.id, t.snippet]);
}

/**
 * One line of the Updates list, the same for a newsletter, a receipt, a notice and an alert: a dot while it is unread, who it is from, the title with one
 * line under it, what kind it is, and when. Hover (or focus) shows what can be done to it. Aligned columns, so a long list reads as a table.
 */
export function UpdateRow({
  t,
  to,
  onOpen,
  onDone,
  doneLabel = "Done",
  active,
  mobile,
  className,
}: {
  t: FeedThread;
  /** Where the row goes when it is a link (a receipt opens its thread). */
  to?: string;
  /** What a click does when the row opens something here (a newsletter opens in the reader above). */
  onOpen?: () => void;
  onDone?: () => void;
  doneLabel?: string;
  /** The row the keyboard is on. */
  active?: boolean;
  /** On a phone: bigger to touch, the kind and the time stacked at the end, and no hover actions. */
  mobile?: boolean;
  className?: string;
}) {
  const label = labelOf(t);
  const summary = useSummary(t);
  const m = t.latest_message;
  const amount = useMemo(() => (t.bucket === "paper_trail" && m ? amountOf(t.subject, m.text_body ?? "") : null), [t.bucket, t.subject, m?.id]);
  const files = t.files?.length ?? 0;
  const sender = t.last_from.name || t.last_from.email;
  const read = t.seen;

  const body: ReactNode = (
    <>
      <span className="flex w-1.5 shrink-0 justify-center">{t.unread && <span className="size-1.5 rounded-full bg-foreground" aria-label="New" />}</span>
      <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={28} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13.5px] leading-5", read ? "text-muted-foreground" : "font-medium text-foreground")}>{t.subject || "(no subject)"}</span>
        <span className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
          <span className="shrink-0 max-w-[10rem] truncate">{sender}</span>
          {amount && <span className="shrink-0 font-mono tnum text-foreground">{amount.text}</span>}
          {files > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <Paperclip className="size-3" /> {files}
            </span>
          )}
          {summary && <span className="min-w-0 truncate">· {summary}</span>}
        </span>
      </span>
    </>
  );
  const cell = "flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-md";

  return (
    <div data-update-row={t.id} className={cn("group/row relative flex items-center gap-3 rounded-lg px-2 hover:bg-muted/40", mobile ? "py-2.5 active:bg-muted/50" : "py-2", active && "bg-muted/60 ring-1 ring-border", className)}>
      {to ? (
        <Link to={to} className={cell}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={cell}>
          {body}
        </button>
      )}
      {mobile ? (
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className={cn("text-[11.5px]", label === "Alert" ? "text-destructive" : "text-muted-foreground")}>{label}</span>
          <time className="whitespace-nowrap text-[12px] text-muted-foreground tnum">{fmtTime(t.last_message_at)}</time>
        </span>
      ) : (
        <>
          <span className={cn("hidden w-[4.75rem] shrink-0 justify-center rounded-md px-1.5 py-px text-[11.5px] sm:inline-flex", LABEL_CLASS[label])}>{label}</span>
          <time className="w-14 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground tnum">{fmtTime(t.last_message_at)}</time>
        </>
      )}
      {!mobile && (onOpen || onDone) && (
        <span
          className={cn(
            "absolute inset-y-0 right-2 hidden items-center gap-1 rounded-md bg-background pl-2 shadow-[-12px_0_8px_-4px_var(--background)] group-hover/row:flex group-focus-within/row:flex",
            active && "flex",
          )}
        >
          {onOpen && (
            <Button size="xs" onClick={onOpen}>
              Read
            </Button>
          )}
          {onDone && !read && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={onDone}>
              <Check /> {doneLabel}
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
