import { Forward, Reply, ReplyAll, X } from "lucide-react";
import { Composer } from "@/components/Composer";
import { replyInitial, type ReplyMode } from "@/lib/reply";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Account, ThreadDetail, User } from "@shared/types";
import type { OpenReply, ReplyState } from "./types";

export function ReplyBox({ t, reply, setReply, openReply, account, user, replyTarget }: { t: ThreadDetail; reply: ReplyState | null; setReply: (r: ReplyState | null) => void; openReply: OpenReply; account: Account | undefined; user: User | null; replyTarget: string | undefined }) {
  const modeLabel: Record<ReplyMode, string> = { reply: "Reply", replyAll: "Reply all", forward: "Forward" };
  return (
    <>
      {/* Reply box */}
      <div id="reply-box" className="mt-4 scroll-mt-6">
        {reply ? (
          <div className="rounded-lg ring-1 ring-border overflow-hidden bg-background">
            <div className="flex items-center gap-2 px-3 h-9 border-b border-border text-[13px]">
              <span className="text-muted-foreground [&>svg]:size-3.5">{reply.mode === "forward" ? <Forward /> : reply.mode === "replyAll" ? <ReplyAll /> : <Reply />}</span>
              <span className="font-medium">{modeLabel[reply.mode]}</span>
              {reply.mode !== "forward" && <span className="text-muted-foreground truncate">to {reply.m.is_from_me ? reply.m.to.map((a) => a.name || a.email).join(", ") : reply.m.from.name || reply.m.from.email}</span>}
              <span className="flex-1" />
              <Button variant="ghost" size="icon-xs" aria-label="Close" className="text-muted-foreground" onClick={() => setReply(null)}>
                <X />
              </Button>
            </div>
            <Composer key={reply.key} inline initial={{ ...replyInitial(t, reply.m, reply.mode, account?.email), ...(reply.body_html ? { body_html: reply.body_html } : {}) }} onDone={() => setReply(null)} onCancel={() => setReply(null)} />
          </div>
        ) : (
          <button type="button" onClick={() => openReply("reply")} className="w-full flex items-center gap-2.5 rounded-md px-2 h-10 text-left hover:bg-muted group">
            <Avatar email={account?.email ?? ""} name={account?.display_name || user?.name} src={account?.avatar_url} size={20} />
            <span className="text-[13px] text-muted-foreground group-hover:text-foreground truncate">Reply to {replyTarget || "this thread"}…</span>
            <span className="flex-1" />
            <Kbd>r</Kbd>
          </button>
        )}
      </div>
    </>
  );
}
