import { BrandIcon } from "../components/BrandIcons";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Eye, FileText, Mail, } from "lucide-react";
import { useAccount } from "../context/AccountContext";
import { useEmptyTrash, useLabelThreads, useLabels, useThreads } from "../api";
import { LoadMore } from "../components/ThreadList";
import { fmtRelative } from "../lib/format";
import { Screen } from "./Screen";
import { MobileConnectCard } from "./MobileImbox";
import { MobileList } from "./MobileList";
import { ActionSheet } from "./ActionSheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useListFilters } from "../components/ListFilters";
import { MobileListFilters } from "./MobileListFilters";

type Cfg = { title: string; subtitle?: string; icon: ReactNode; empty: string; emptyBody?: string; dense?: boolean; groupByMonth?: boolean; showBucket?: boolean; fab?: boolean };

/** Bucket-driven list screens (paper trail, trays, library lists). */
export function MobileBucketScreen({ bucket, back, cfg }: { bucket: string; back?: boolean; cfg: Cfg }) {
  const { accounts } = useAccount();
  const f = useListFilters();
  const isTrash = bucket === "trash";
  const emptyTrash = useEmptyTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const filterable = bucket !== "previously_seen";
  const q = useThreads(bucket, { enabled: accounts.length > 0, q: f.state.q, label: f.state.label, filters: f.state.filters });
  const threads = q.data?.pages.flatMap((p) => p.threads) ?? [];
  const bundles = bucket === "paper_trail" ? q.data?.pages[0]?.bundles ?? [] : [];
  // Every thread list swipes the same way — right selects, left turns read state over —
  // so no screen overrides them. Everything a bucket could offer on a swipe
  // (Done on a tray, Cancel on Bubble Up) is one swipe-right away in the bar below,
  // which is where the rest of the filing already lives.
  return (
    <Screen
      title={cfg.title}
      largeTitle
      back={back}
      subtitle={accounts.length ? cfg.subtitle : undefined}
      fab={cfg.fab}
      tabs
      right={
        isTrash && threads.length > 0 ? (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmEmpty(true)}>
            Empty
          </Button>
        ) : undefined
      }
    >
      {accounts.length === 0 ? (
        <MobileConnectCard />
      ) : (
        <>
        {filterable && <MobileListFilters f={f} showWhere={bucket === "everything"} />}
        <MobileList
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          onRefresh={() => q.refetch()}
          dense={cfg.dense}
          inTrash={isTrash}
          groupByMonth={cfg.groupByMonth}
          showBucket={cfg.showBucket}
          emptyIcon={cfg.icon}
          sections={[{ threads: bucket === "bubble_up" ? threads.map((t) => ({ ...t, snippet: t.bubble_up_at ? `Bubbles up ${fmtRelative(t.bubble_up_at)}` : t.snippet })) : threads, bundles, emptyTitle: f.active ? "No matches." : cfg.empty, emptyBody: f.active ? "Try fewer filters, or a different word." : cfg.emptyBody }]}
          footer={<LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />}
        />
        <ActionSheet
          open={confirmEmpty}
          onOpenChange={setConfirmEmpty}
          title="Empty the trash?"
          description="Everything in it is deleted for good, here and in your mailboxes. There is no undo."
          actions={[
            {
              icon: <BrandIcon name="trash" />,
              label: "Empty trash",
              destructive: true,
              onSelect: () => emptyTrash.mutate(undefined, { onSuccess: (r) => toast(r.deleted === 1 ? "Deleted 1 thread" : `Deleted ${r.deleted} threads`), onError: (e) => toast((e as Error).message) }),
            },
          ]}
        />
        </>
      )}
    </Screen>
  );
}

export const BUCKETS: Record<string, Cfg> = {
  paper_trail: { title: "Receipts", subtitle: "Receipts, confirmations, and the rest of the paperwork.", icon: <FileText />, empty: "No paperwork yet.", emptyBody: "Receipts land here once you screen those senders into Feed.", dense: true, groupByMonth: true, fab: true },
  reply_later: { title: "Reply Later", subtitle: "Threads you meant to answer.", icon: <BrandIcon name="reply-later" />, empty: "Nothing to reply to.", emptyBody: "Long-press a thread in the Imbox and choose Reply later to park it here." },
  set_aside: { title: "Set Aside", subtitle: "Things you want close at hand.", icon: <BrandIcon name="set-aside" />, empty: "Nothing set aside.", emptyBody: "Long-press a thread in the Imbox and choose Set aside to keep it handy." },
  bubble_up: { title: "Bubble Up", subtitle: "Out of sight until the moment you picked.", icon: <BrandIcon name="bubble-up" />, empty: "Nothing scheduled.", emptyBody: "Long-press a thread and choose Bubble up." },
  previously_seen: { title: "Previously seen", icon: <Eye />, empty: "Nothing here yet.", emptyBody: "Once you open something, it settles down here." },
  sent: { title: "Sent", icon: <BrandIcon name="sent" />, empty: "Nothing sent yet.", showBucket: true },
  trash: { title: "Trash", icon: <BrandIcon name="trash" />, empty: "Trash is empty." },
  everything: { title: "Everything", icon: <Mail />, empty: "Nothing here.", showBucket: true },
};

export function MobileLabelThreads() {
  const { id } = useParams();
  const { accounts } = useAccount();
  const labels = useLabels(accounts.length > 0);
  const q = useLabelThreads(id);
  const label = labels.data?.find((l) => l.id === id);
  return (
    <Screen title={label?.name ?? "Label"} largeTitle back>
      <MobileList loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} onRefresh={() => q.refetch()} emptyIcon={<BrandIcon name="labels" />} sections={[{ threads: q.data?.pages.flatMap((p) => p.threads) ?? [], emptyTitle: "No threads with this label." }]} showBucket footer={<LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />} />
    </Screen>
  );
}

export { MobileSearch } from "./MobileSearch";
