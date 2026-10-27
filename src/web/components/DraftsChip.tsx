import { useState } from "react";
import { Link } from "react-router-dom";
import type { Draft } from "@shared/types";
import { useDrafts } from "../api";
import { useCompose } from "../context/ComposeContext";
import { draftPreview, firstRecipient } from "../lib/draftPeople";
import { fmtTime } from "../lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrandIcon } from "./BrandIcons";

const SHOWN = 5;

/**
 * Beside Write in the header, when there are drafts waiting: "Drafts 2", and a short list to pick one up from. It is
 * there so that what you started is in front of you where you go to start something new. Nothing shows without drafts.
 */
export function DraftsChip() {
  const { data } = useDrafts();
  const { openCompose } = useCompose();
  const [open, setOpen] = useState(false);
  const drafts = (data ?? []).filter((d) => d.status === "draft").sort((a, b) => b.updated_at - a.updated_at);
  if (!drafts.length) return null;

  const pickUp = (d: Draft) => {
    setOpen(false);
    openCompose({ draft_id: d.id, account_id: d.account_id, thread_id: d.thread_id, reply_to_message_id: d.reply_to_message_id, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body_html: d.body_html, title: "Draft" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Drafts waiting"
          aria-label={`${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} waiting`}
          className="hidden h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground sm:inline-flex"
        >
          Drafts
          <span className="rounded bg-muted px-1 text-[10px] leading-4 tabular-nums">{drafts.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] max-w-[calc(100vw-1rem)] p-0 shadow-lg">
        <div className="px-3.5 pb-1.5 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pick one up</div>
        <ul>
          {drafts.slice(0, SHOWN).map((d) => {
            const who = firstRecipient(d);
            const snippet = draftPreview(d.body_html);
            return (
              <li key={d.id} className="border-t border-border/60">
                <button type="button" onClick={() => pickUp(d)} className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{d.subject || "(no subject)"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{who ? `To ${who.name || who.email}` : "No one yet"}{snippet ? ` \u00b7 ${snippet}` : ""}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(d.updated_at)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-border/60 px-3.5 py-2 text-xs text-muted-foreground">
          <Link to="/drafts" onClick={() => setOpen(false)} className="hover:text-foreground">
            {drafts.length > SHOWN ? `View all ${drafts.length} drafts` : "View all drafts"}
          </Link>
          <button type="button" className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => { setOpen(false); openCompose(); }}>
            <BrandIcon name="write" size={12} /> New message
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
