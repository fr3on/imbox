import { BrandIcon } from "@/components/BrandIcons";
import { Button } from "@/components/ui/button";
import type { AiDraftCard } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { useCompose } from "@/context/ComposeContext";
import { draftSentThread, markDraftSent, subscribeSentDrafts } from "@/lib/sentDrafts";
import { Prose, textToHtml } from "./prose";

export function DraftCard({ d, sentThreadId }: { d: AiDraftCard; sentThreadId?: string }) {
  const { openCompose } = useCompose();
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "sending" | "sent">(sentThreadId ? "sent" : "idle");
  const [threadId, setThreadId] = useState<string | undefined>(sentThreadId);
  // A draft can also be sent from the composer this card opened, or by the assistant itself.
  useEffect(() => {
    const sync = () => {
      const t = draftSentThread(d.draft_id);
      if (t !== null) {
        setState("sent");
        setThreadId((prev) => prev ?? t);
      }
    };
    sync();
    return subscribeSentDrafts(sync);
  }, [d.draft_id]);
  useEffect(() => {
    if (sentThreadId) {
      setState("sent");
      setThreadId(sentThreadId);
    }
  }, [sentThreadId]);
  const send = async () => {
    setState("sending");
    try {
      await api.post("/api/send", { draft_id: d.draft_id, account_id: d.account_id, thread_id: d.thread_id, to: d.to, cc: d.cc, subject: d.subject, body_html: textToHtml(d.body_text) });
      setState("sent");
      toast("Sent");
      markDraftSent(d.draft_id);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    } catch (e) {
      setState("idle");
      toast.error((e as Error).message);
    }
  };
  if (state === "sent") {
    // Collapsed: the mail is gone, so the card stops offering to send it.
    return (
      <div className="my-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px] flex items-center gap-2 text-muted-foreground">
        <Check className="size-3.5 shrink-0" />
        <span className="truncate">
          Sent to {d.to.map((a) => a.name || a.email).join(", ")} · <span className="text-foreground/80">{d.subject}</span>
        </span>
        {threadId && (
          <Link className="ml-auto shrink-0 underline underline-offset-2 hover:text-foreground" to={`/t/${threadId}`}>
            Open
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg bg-muted/50 p-3 text-[13px]">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <BrandIcon name="drafts" size={14} />
        <span className="truncate">Draft · from {d.from} · to {d.to.map((a) => a.name || a.email).join(", ")}{d.cc.length ? ` · cc ${d.cc.map((a) => a.email).join(", ")}` : ""}</span>
      </div>
      <div className="font-medium mb-1">{d.subject}</div>
      <Prose text={d.body_text} className="text-[13px] leading-5 text-foreground/90 max-h-56 overflow-y-auto" />
      <div className="flex items-center gap-2 mt-3">
        <Button size="sm" onClick={send} disabled={state === "sending"}>{state === "sending" ? <Loader2 className="animate-spin" /> : <Send />} Send</Button>
        <Button size="sm" variant="ghost" onClick={() => openCompose({ draft_id: d.draft_id, account_id: d.account_id, thread_id: d.thread_id, to: d.to, cc: d.cc, subject: d.subject, body_html: textToHtml(d.body_text) })}>Open in composer</Button>
      </div>
    </div>
  );
}
