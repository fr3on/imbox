import { Link, useNavigate } from "react-router-dom";
import { Clock, Ellipsis, Eye, EyeOff, Bookmark, Tag, Trash2 } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { useBulkAction, type ThreadAction } from "../api";
import { fmtDate, fmtRelative } from "../lib/format";
import { useToast } from "./Toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// One person's conversations. What is waiting on you comes first in a tinted block, the rest follows by month.

// Some stored snippets are raw markup, often cut off mid-tag. Show only the words, and not the subject said again.
const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&zwnj;": "", "&zwj;": "" };
export function plain(raw: string, subject = ""): string {
  let s = raw
    .replace(/<(style|script|head|title)[\s\S]*?(<\/\1>|$)/gi, " ")
    .replace(/<[^>]*(>|$)/g, " ")
    .replace(/&(?:[a-z]+|#\d+);/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u200b-\u200f\u2060\ufeff]|\u034f/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const subj = subject.trim().toLowerCase();
  if (subj && s.toLowerCase().startsWith(subj)) s = s.slice(subj.length).replace(/^[\s:\-\u2013\u2014]+/, "");
  return s;
}

const monthOf = (t: number) => {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: "long" } : { month: "long", year: "numeric" });
};

function Row({ t, waiting }: { t: ThreadSummary; waiting: boolean }) {
  const nav = useNavigate();
  const bulk = useBulkAction();
  const { toast } = useToast();
  const from = t.last_from.name || t.last_from.email;
  const snippet = plain(t.snippet, t.subject);
  const run = (a: ThreadAction, msg: string) =>
    bulk.mutate({ thread_ids: [t.id], ...a }, { onSuccess: () => toast(msg, { kind: "success" }), onError: (e) => toast((e as Error).message, { kind: "error" }) });
  const unread = t.unread || !t.seen;
  return (
    <li className="flex items-center gap-1 border-t border-border/60 first:border-t-0">
      <Link to={`/t/${t.id}`} className="-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{t.subject || "(no subject)"}</span>
            {unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" role="img" aria-label="Unread" />}
          </div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {from}
            {snippet ? ` \u00b7 ${snippet}` : ""}
            {waiting ? ` \u00b7 ${fmtRelative(t.last_message_at)}` : ""}
          </div>
        </div>
        {!waiting && <span className="shrink-0 text-xs text-muted-foreground tnum" title={fmtRelative(t.last_message_at)}>{fmtDate(t.last_message_at)}</span>}
      </Link>
      {waiting && (
        <button
          type="button"
          onClick={() => nav(`/t/${t.id}`)}
          className="shrink-0 rounded-md border border-current bg-card px-3 py-0.5 text-[12.5px] text-[#b4531c] transition-colors hover:bg-[#b4531c] hover:text-card dark:text-[#e08a55] dark:hover:bg-[#e08a55]"
        >
          Reply
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More actions" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <Ellipsis size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onSelect={() => run({ action: "reply_later", on: !t.reply_later }, t.reply_later ? "Removed from Reply Later" : "Added to Reply Later")}>
            <Clock /> {t.reply_later ? "Remove from Reply Later" : "Remind me later"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run({ action: "set_aside", on: !t.set_aside }, t.set_aside ? "Back in the Imbox" : "Set aside")}>
            <Bookmark /> {t.set_aside ? "Put back" : "Set aside"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run({ action: unread ? "mark_read" : "mark_unread" }, unread ? "Marked read" : "Marked unread")}>
            {unread ? <Eye /> : <EyeOff />} {unread ? "Mark read" : "Mark unread"}
          </DropdownMenuItem>
          {t.bucket !== "feed" && t.bucket !== "trash" && (
            <DropdownMenuItem onSelect={() => run({ action: "move", bucket: "feed" }, "Moved to Feed")}>
              <Tag /> Move to Feed
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {t.bucket === "trash" ? (
            <DropdownMenuItem onSelect={() => run({ action: "move", bucket: "imbox" }, "Restored to the Imbox")}><Tag /> Restore to the Imbox</DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onSelect={() => run({ action: "move", bucket: "trash" }, "Moved to trash")}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function ContactThreads({ threads, waitingIds, empty }: { threads: ThreadSummary[]; waitingIds: Set<string>; empty: string }) {
  if (threads.length === 0) return <p className="py-3 text-[13px] text-muted-foreground">{empty}</p>;
  const waiting = threads.filter((t) => waitingIds.has(t.id));
  const groups: { label: string; items: ThreadSummary[] }[] = [];
  for (const t of threads) {
    if (waitingIds.has(t.id)) continue;
    const label = monthOf(t.last_message_at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(t);
    else groups.push({ label, items: [t] });
  }
  const head = "mb-1 mt-3 flex justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground";
  return (
    <div>
      {waiting.length > 0 && (
        <>
          <div className={head}><span>Needs your reply</span><span className="tnum">{waiting.length}</span></div>
          <ul className="rounded-xl bg-[#fbeee5] px-3 dark:bg-[#33241a]">
            {waiting.map((t) => <Row key={t.id} t={t} waiting />)}
          </ul>
        </>
      )}
      {groups.map((g) => (
        <section key={g.label}>
          <div className={head}><span>{g.label}</span><span className="tnum">{g.items.length}</span></div>
          <ul>{g.items.map((t) => <Row key={t.id} t={t} waiting={false} />)}</ul>
        </section>
      ))}
    </div>
  );
}
