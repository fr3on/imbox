import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { JEV_PHISHING_FROM, phishingSignal } from "@shared/phishing";
import type { ThreadDetail } from "@shared/types";
import { api, invalidateMail, useJev, useJevPhishing } from "../api";
import { Button } from "@/components/ui/button";

/**
 * "This may be phishing": shown above a message that puts on a known name (or a web address, or your own domain) it was not sent from while pressing you to act. Report blocks the sender
 * and trashes the thread; "Looks fine" hides the warning until something newer arrives. Nothing happens unless a button is pressed.
 */
export function PhishingBanner({ thread, className }: { thread: ThreadDetail; className?: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const last = useMemo(() => [...thread.messages].reverse().find((m) => !m.is_from_me), [thread.messages]);
  // A fast AI check (Jev) when it is on: asked once for a message from someone not let in, and kept.
  const jevOn = !!useJev().data?.capabilities.find((c) => c.id === "phishing")?.enabled;
  const worthAsking = !!last && !thread.phish_ok && thread.phish_verdict !== "ok" && thread.bucket !== "trash" && thread.sender_status !== "imbox";
  const jev = useJevPhishing(thread.id, jevOn && worthAsking).data;
  const jevP = typeof jev?.probability === "number" && jev.probability >= JEV_PHISHING_FROM ? Math.round(jev.probability * 100) : 0;
  const signal = useMemo(() => {
    if (!last || thread.phish_ok || thread.bucket === "trash" || thread.sender_status === "imbox") return null;
    const rules = phishingSignal({ from: last.from, to: last.to, reply_to: last.reply_to, auth: last.auth_results, verdict: thread.phish_verdict, subject: last.subject, text_body: last.text_body, html_body: last.html_body });
    if (thread.phish_verdict === "ok") return null;
    if (rules) return jevP ? { ...rules, reason: `${rules.reason} A quick AI check agrees (${jevP}%).` } : rules;
    return jevP ? { brand: "", domain: last.from.email.split("@").pop() ?? "", reason: `A quick AI check rates this ${jevP}% likely to be phishing.` } : null;
  }, [last, thread.phish_ok, thread.phish_verdict, thread.bucket, thread.sender_status, jevP]);
  if (!signal || !last) return null;

  const report = async () => {
    setBusy(true);
    try {
      await api.post(`/api/threads/${thread.id}/report`);
      invalidateMail(qc);
      toast(`Reported. ${last.from.email} is blocked and the message is in the trash.`);
      nav(-1);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't report it");
      setBusy(false);
    }
  };
  const looksFine = () => {
    qc.setQueriesData<ThreadDetail>({ queryKey: ["thread", thread.id] }, (old) => (old ? { ...old, phish_ok: true } : old));
    api.post("/api/ai/actions/state", { thread_id: thread.id, action_id: "phish_ok", state: "done" }).catch((e) => {
      qc.setQueriesData<ThreadDetail>({ queryKey: ["thread", thread.id] }, (old) => (old ? { ...old, phish_ok: false } : old));
      toast.error((e as Error).message || "Couldn't save that");
    });
  };

  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-3", className)}>
      <ShieldAlert className="size-5 shrink-0 text-destructive" />
      <div className="min-w-[12rem] flex-1">
        <p className="text-sm font-medium text-destructive">This may be phishing</p>
        <p className="text-[13px] text-destructive/90">{signal.reason}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="destructive" disabled={busy} onClick={report}>
          Report phishing
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={looksFine}>
          Looks fine
        </Button>
      </div>
    </div>
  );
}
