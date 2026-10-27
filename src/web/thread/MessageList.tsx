import * as React from "react";
import { cleanSnippet } from "@/lib/snippet";
import { printMessages } from "@/lib/printMessages";
import { ChevronDown, ChevronUp, ChevronsDownUp, GitMerge, ScrollText, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useClipMutations } from "@/api";
import { fmtTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { ThreadDetail, } from "@shared/types";
import { MessageRow } from "./MessageRow";
import { buildTimelineItems } from "./messages";
import { BounceToggle, useHideBounces } from "./useHideBounces";
import type { OpenReply, Run } from "./types";

export function MessageList({ t, names, expanded, setExpanded, showTimeline, setShowTimeline, msgCursor, allExpanded, openReply, run }: { t: ThreadDetail; names: string[]; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; showTimeline: boolean; setShowTimeline: (v: boolean) => void; msgCursor: number; allExpanded: boolean; openReply: OpenReply; run: Run }) {
  const clips = useClipMutations();
  const bounce = useHideBounces(t.messages);
  // What is on screen: failure notices drop out when hidden, and the latest is the last one left.
  const vis = t.messages.filter((m) => !bounce.hidden.has(m.id));
  const latestId = vis[vis.length - 1]?.id;
  return (
    <>
      {/* Messages */}
      <div className="mt-5">
        <BounceToggle count={bounce.count} hide={bounce.hidden.size > 0} onToggle={bounce.toggle} className="mb-2" />
        {vis.length > 2 && (
          <div className="flex justify-end items-center gap-1.5 mb-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => {
                if (allExpanded) {
                  setShowTimeline(false);
                  setExpanded(new Set([latestId]));
                } else {
                  setExpanded(new Set(t.messages.map((m) => m.id)));
                }
              }}
            >
              <ChevronsDownUp /> {allExpanded ? "Focus on latest" : `Expand all ${vis.length}`}
            </Button>
          </div>
        )}

        {/* Option C: Focus Mode Header & Option B: Stepper Timeline */}
        {vis.length > 2 && !allExpanded && (
          <div className="mb-4">
            {!showTimeline ? (
              <button
                type="button"
                onClick={() => setShowTimeline(true)}
                className="group flex w-full items-center justify-between rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-left text-xs transition-colors hover:border-foreground/30 hover:bg-muted"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ScrollText className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  <span className="font-medium text-foreground">
                    {vis.length - 1} earlier message{vis.length - 1 === 1 ? "" : "s"}
                  </span>
                  <span className="text-muted-foreground truncate hidden sm:inline">
                    · {names.slice(0, 3).join(", ")}{names.length > 3 ? ` +${names.length - 3}` : ""} ({fmtTime(vis[0].date)} – {fmtTime(vis[vis.length - 2].date)})
                  </span>
                </div>
                <span className="flex items-center gap-1 font-medium text-muted-foreground group-hover:text-foreground shrink-0 text-[11.5px]">
                  View timeline <ChevronDown className="size-3.5" />
                </span>
              </button>
            ) : (
              <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <ScrollText className="size-3.5 text-muted-foreground" />
                    <span>Thread Timeline ({vis.length} messages)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-foreground h-6 px-2 text-[11px]"
                      onClick={() => setExpanded(new Set(t.messages.map((m) => m.id)))}
                    >
                      Expand all
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-foreground h-6 px-2 text-[11px] gap-1"
                      onClick={() => setShowTimeline(false)}
                    >
                      Hide timeline <ChevronUp className="size-3" />
                    </Button>
                  </div>
                </div>
                {/* Stepper Timeline (Option B) */}
                <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
                  {buildTimelineItems(t.messages).filter((item) => item.type === "message" ? !bounce.hidden.has(item.message.id) : bounce.hidden.size === 0).map((item, idx) => {
                    if (item.type === "bounces") {
                      return (
                        <div key={`bounce-${idx}`} className="flex items-center gap-1.5 px-2 py-1 text-[11.5px] text-amber-600 dark:text-amber-400">
                          <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
                          <span className="font-medium">{item.count} delivery failure notification{item.count === 1 ? "" : "s"} skipped</span>
                        </div>
                      );
                    }
                    const m = item.message;
                    const isLatest = m.id === latestId;
                    const isOpened = expanded.has(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setExpanded((s) => {
                            const next = new Set(s);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            return next;
                          });
                          setTimeout(() => {
                            document.querySelector(`[data-msg-index="${item.index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 50);
                        }}
                        className={cn(
                          "group flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/70",
                          isLatest && "bg-muted/40 font-medium"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={cn("size-2 rounded-full shrink-0", isLatest ? "bg-foreground" : isOpened ? "bg-foreground/50" : "bg-muted-foreground/30")} />
                          <span className={cn("truncate max-w-36 shrink-0", isLatest ? "font-semibold text-foreground" : "text-foreground/90")}>
                            {m.from.name || m.from.email.split("@")[0]}
                          </span>
                          <span className="text-muted-foreground truncate">{cleanSnippet(m.snippet)}</span>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground tnum">{fmtTime(m.date)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-border">
          {t.messages.map((m, i) => {
            if (bounce.hidden.has(m.id)) return null;
            const isLatest = m.id === latestId;
            const isUserOpened = expanded.has(m.id);
            const inFocusMode = vis.length > 2 && !allExpanded;

            if (inFocusMode && !isLatest && !isUserOpened) {
              return null;
            }

            return (
              <MessageRow
                key={m.id}
                m={m}
                onPrint={(msg) => printMessages(t.subject, [msg])}
                index={i}
                focused={i === msgCursor}
                isLast={isLatest}
                expanded={expanded.has(m.id)}
                onToggle={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(m.id)) n.delete(m.id);
                    else n.add(m.id);
                    return n;
                  })
                }
                onReply={(mode, msg) => openReply(mode, msg)}
                onClip={(text) =>
                  clips.create.mutate(
                    { thread_id: t.id, message_id: m.id, text },
                    {
                      onSuccess: () => toast("Clip saved"),
                      onError: (err: any) => toast.error(err?.message || "Failed to save clip"),
                    }
                  )
                }
                onMarkUnread={() => run({ action: "mark_unread" }, "Marked unread")}
              />
            );
          })}
        </div>
        {t.merged_threads.length > 0 && (
          <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <GitMerge size={12} /> Includes merged: {t.merged_threads.map((m) => m.subject).join(", ")}
          </div>
        )}
      </div>
    </>
  );
}
