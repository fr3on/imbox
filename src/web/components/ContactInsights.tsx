import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { Lightbulb, } from "lucide-react";
import { toast } from "sonner";
import type { MergedContact } from "@shared/types";
import { cn } from "@/lib/utils";
import { markContactReview, useContactReview, useUpdateContact } from "../api";
import { useAccount } from "../context/AccountContext";
import { combineInsights, type Insight, type MoveTo } from "../lib/contactInsights";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "inbox.contacts.dismissed";
const loadDismissed = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};
const saveDismissed = (s: Set<string>) => {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* private mode: they come back on reload */
  }
};

const PLACE: Record<MoveTo, { label: string; icon: React.ReactNode }> = {
  imbox: { label: "Imbox", icon: <BrandIcon name="imbox" /> },
  feed: { label: "Feed", icon: <BrandIcon name="feed" /> },
  paper_trail: { label: "Receipts", icon: <BrandIcon name="paper-trail" /> },
};

/** The AI sometimes names a place by its internal id; say what the page says. */
const plainReason = (r: string) => r.replace(/\bpaper[_ ]trail\b/gi, "Receipts").replace(/\bfeed\b/gi, "Feed");

const nameOf = (c: MergedContact) => c.name || c.email.split("@")[0];

/**
 * "Worth a look" on the Contacts page: senders who write a great deal (bundle them, or show them the door) and senders whose mail looks
 * filed in the wrong place. The first comes from plain counting, the second from rules and, when an AI provider is set up, its review.
 * Every suggestion can be acted on in one press or waved away.
 */
export function ContactInsights({ list, compact }: { list: MergedContact[]; compact?: boolean }) {
  const { accounts } = useAccount();
  const review = useContactReview(accounts.length > 0);
  const update = useUpdateContact();
  const [dismissed, setDismissed] = useState(loadDismissed);
  const ai = (review.data?.suggestions ?? []).map((s) => ({ email: s.email, to: s.suggest, reason: s.reason }));
  const insights = combineInsights(list, ai, dismissed);
  if (insights.length === 0) return null;

  const wave = (i: Insight) => {
    const next = new Set(dismissed).add(i.key);
    setDismissed(next);
    saveDismissed(next);
    if (i.source === "ai") void markContactReview(i.contact.email, "dismissed");
  };
  const fail = (e: unknown) => toast.error((e as Error).message);
  const bundle = (i: Insight) => update.mutate({ id: i.contact.id, bundled: true }, { onSuccess: () => toast(`${nameOf(i.contact)} is bundled`), onError: fail });
  const screenOut = (i: Insight) => update.mutate({ id: i.contact.id, screen_status: "screened_out" }, { onSuccess: () => toast(`${nameOf(i.contact)} is screened out`), onError: fail });
  const move = (i: Insight) => {
    if (!i.to) return;
    update.mutate(
      { id: i.contact.id, screen_status: i.to },
      {
        onSuccess: () => {
          toast(`Now goes to ${PLACE[i.to!].label}`);
          if (i.source === "ai") void markContactReview(i.contact.email, "applied");
        },
        onError: fail,
      },
    );
  };

  const btn = compact ? "h-9 px-3 text-[13px]" : "";
  return (
    <section aria-label="Worth a look" className={cn("mb-4 rounded-xl border border-border/70 bg-card", compact && "mx-4")}>
      <header className="flex items-center gap-2 px-3.5 pt-3 text-[13px] font-medium">
        <Lightbulb className="size-3.5 text-muted-foreground" /> Worth a look
        <span className="text-xs font-normal text-tertiary tnum">{insights.length}</span>
      </header>
      <ul className="divide-y divide-border/50">
        {insights.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
            <Avatar email={i.contact.email} name={i.contact.name} src={i.contact.avatar_url} size={compact ? 32 : 28} />
            <div className="min-w-0 flex-1 basis-40">
              <div className="flex items-center gap-1.5 truncate text-[13.5px] font-medium leading-5">
                <span className="truncate">{nameOf(i.contact)}</span>
                {i.source === "ai" && <BrandIcon name="assistant" className="size-3 shrink-0 text-muted-foreground" aria-label="Spotted by the AI" />}
              </div>
              <div className="line-clamp-2 text-[12.5px] leading-4 text-muted-foreground">
                {plainReason(i.reason)}
                {i.kind === "misfiled" && i.to && <> · now in {i.contact.screen_status === "feed" ? "Feed" : i.contact.screen_status === "paper_trail" ? "Receipts" : "the Imbox"}</>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {i.kind === "noisy" ? (
                <>
                  <Button size={compact ? "sm" : "xs"} variant="outline" className={btn} disabled={update.isPending} onClick={() => bundle(i)}>
                    Bundle
                  </Button>
                  <Button size={compact ? "sm" : "xs"} variant="ghost" className={cn("text-muted-foreground", btn)} disabled={update.isPending} onClick={() => screenOut(i)}>
                    Screen out
                  </Button>
                  <Button size={compact ? "sm" : "xs"} variant="ghost" className={cn("text-muted-foreground", btn)} onClick={() => wave(i)}>
                    Not now
                  </Button>
                </>
              ) : (
                <>
                  <Button size={compact ? "sm" : "xs"} variant="outline" className={btn} disabled={update.isPending} onClick={() => move(i)}>
                    {i.to && PLACE[i.to].icon} Move to {i.to && PLACE[i.to].label}
                  </Button>
                  <Button size={compact ? "sm" : "xs"} variant="ghost" className={cn("text-muted-foreground", btn)} onClick={() => wave(i)}>
                    Keep it there
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
