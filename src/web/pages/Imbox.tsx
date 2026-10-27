import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, Eye } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useImbox } from "../api";
import { CalendarCover } from "../calendar/CalendarCover";
import { AwayBanner } from "../components/AwayBanner";
import { BriefCard } from "../components/BriefCard";
import { DeckSkeleton, ImboxDeck, readToday } from "../components/ImboxDeck";
import { MailboxFilter } from "../components/MailboxFilter";
import { NotifyBanner } from "../components/NotifyBanner";
import { ThreadList } from "../components/ThreadList";
import { Piles } from "../components/Trays";
import { ALL, useAccount } from "../context/AccountContext";

// Shared with the mobile Imbox, so they live in a component of their own rather than in this page.
import { ConnectGmailCard, } from "../components/SyncPill";
export { ConnectGmailCard };

/** Heading link for the Previously seen list, which shows the latest few hundred, not everything. */
function SeeAll() {
  return (
    <Link to="/previously-seen" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
      See all <ChevronRight className="size-3" />
    </Link>
  );
}

export default function Imbox() {
  const { accounts, account, scope, user } = useAccount();
  const imbox = useImbox(accounts.length > 0);
  // Narrows Previously seen to one mailbox. Empty is all of them.
  const [box, setBox] = useState("");
  const newCount = (imbox.data?.new_threads.length ?? 0) + (imbox.data?.bundles ?? []).filter((b) => b.status === "open").length;

  if (accounts.length === 0) return <ConnectGmailCard />;
  const seenSection = {
    title: "Previously seen",
    hideCount: true,
    actions: <SeeAll />,
    groupByDay: true,
    intro: <MailboxFilter threads={imbox.data?.seen_threads ?? []} value={box} onChange={setBox} />,
    threads: (imbox.data?.seen_threads ?? []).filter((t) => !box || t.account_id === box),
    bundles: (imbox.data?.bundles ?? []).filter((b) => b.status === "seen" && (!box || b.account_id === box)),
    emptyIllustration: <Eye />,
    emptyTitle: box ? "Nothing from this mailbox." : "Nothing here yet.",
    emptyBody: box ? "Choose All mailboxes to see the rest." : "Once you open something, it settles down here.",
  };
  const d = imbox.data;
  const scopeLabel = accounts.length > 1 ? (scope === ALL ? "All accounts" : account?.email) : account?.email ?? accounts[0]?.email;
  if ((user?.settings?.imboxLayout ?? "deck") === "deck") {
    const openBundles = (d?.bundles ?? []).filter((b) => b.status === "open");
    const deck = imbox.isLoading ? <DeckSkeleton /> : imbox.error ? null : <ImboxDeck threads={d?.new_threads ?? []} read={readToday(d?.seen_threads)} />;
    return (
      <div className="mx-auto flex min-h-[calc(100vh-44px-48px)] w-full max-w-3xl flex-col pb-44 sm:pb-48">
        <NotifyBanner />
        <AwayBanner away={d?.away} className="mb-4" />
        {/* "Nothing new" and the new mail come first; the brief follows. */}
        {deck}
        <BriefCard />
        <CalendarCover />

        <ThreadList
          loading={imbox.isLoading}
          error={imbox.error}
          onRetry={() => imbox.refetch()}
          sections={[
            ...(openBundles.length > 0 ? [{ title: "Bundles", threads: [], bundles: openBundles }] : []),
            ...(d?.held_threads?.length ? [{ title: "Back to work", threads: d.held_threads }] : []),
            seenSection,
          ]}
        />
        <Piles replyLater={d?.reply_later ?? []} setAside={d?.set_aside ?? []} />
      </div>
    );
  }
  return (
    <div className="max-w-5xl mx-auto w-full flex flex-col min-h-[calc(100vh-44px-48px)] pb-44 sm:pb-48">
      <header className="mb-5 px-2">
        <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em]">Imbox</h1>
        <div className="mt-1 min-h-5 text-[13px] text-muted-foreground">
          {scopeLabel}
          {scope === ALL && accounts.length > 1 && <span className="text-tertiary"> · {accounts.length} mailboxes</span>}
        </div>
        {d && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs tnum">
            <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 font-medium", newCount > 0 ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
              {newCount > 0 ? `${newCount} new` : "All caught up"}
            </span>
            {d.seen_threads.length > 0 && <span className="inline-flex h-6 items-center rounded-full bg-muted/70 px-2.5 text-muted-foreground">{d.seen_threads.length} earlier</span>}
          </div>
        )}
      </header>

      <NotifyBanner />
      <AwayBanner away={d?.away} className="mb-4" />
      <BriefCard />
      <CalendarCover />

      <ThreadList
        loading={imbox.isLoading}
        error={imbox.error}
        onRetry={() => imbox.refetch()}
        sections={[
          {
            title: "New for you",
            threads: d?.new_threads ?? [],
            bundles: (d?.bundles ?? []).filter((b) => b.status === "open"),
            emptyNode: (
              <div className="mx-2 mb-4 mt-1 flex items-center gap-3 rounded-xl border border-dashed border-border/80 px-4 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <CheckCircle2 size={18} />
                </span>
                <div>
                  <div className="text-sm font-medium text-foreground">You're all caught up. Go enjoy your day.</div>
                  <div className="text-[13px] text-muted-foreground">Mail from people you've screened in shows up here.</div>
                </div>
              </div>
            ),
          },
          ...(d?.held_threads?.length ? [{ title: "Back to work", threads: d.held_threads }] : []),
          seenSection,
        ]}
      />
      <Piles replyLater={d?.reply_later ?? []} setAside={d?.set_aside ?? []} />
    </div>
  );
}
