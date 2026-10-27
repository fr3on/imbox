import { BrandIcon } from "../components/BrandIcons";
import { useState, type ReactNode } from "react";
import { Eye, } from "lucide-react";
import { useEmptyTrash, useThreads } from "../api";
import { useAccount } from "../context/AccountContext";
import { ConnectGmailCard } from "./Imbox";
import { LoadMore, ThreadList } from "../components/ThreadList";
import { PageHeader } from "../components/EmptyState";
import { KeyLegend } from "../components/KeyLegend";
import { ListFilters, useListFilters } from "../components/ListFilters";
import { useToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const ART: Record<string, { icon: ReactNode; title: string; body: string }> = {
  previously_seen: { icon: <Eye />, title: "Nothing seen yet.", body: "Once you open something in the Imbox, it settles down here." },
  trash: { icon: <BrandIcon name="trash" />, title: "Trash is empty.", body: "Nothing to take out." },
  sent: { icon: <BrandIcon name="sent" />, title: "Nothing sent yet.", body: "Press c to write something." },
  everything: { icon: <BrandIcon name="imbox" />, title: "Nothing here.", body: "Empty lists are underrated." },
};

export default function ListPage({ bucket, title, subtitle, showBucket }: { bucket: string; title: string; subtitle?: string; showBucket?: boolean }) {
  const { accounts } = useAccount();
  const isSeen = bucket === "previously_seen";
  const enabled = accounts.length > 0;
  const f = useListFilters();
  const q = useThreads(bucket, { enabled, q: f.state.q, label: f.state.label, filters: f.state.filters });
  const isTrash = bucket === "trash";
  const emptyTrash = useEmptyTrash();
  const { toast } = useToast();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  if (!enabled) return <ConnectGmailCard />;
  const threads = q.data?.pages.flatMap((p) => p.threads) ?? [];
  const loading = q.isLoading;
  const error = q.error;
  const art = ART[bucket] ?? ART.everything;
  const count = threads.length ? `${threads.length}${q.hasNextPage ? "+" : ""} ${threads.length === 1 && !q.hasNextPage ? "thread" : "threads"}. ` : "";
  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader
        className="px-2"
        title={title}
        subtitle={`${count}${subtitle ?? ""}`.trim() || undefined}
        actions={
          isTrash && threads.length > 0 ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmEmpty(true)}>
              <BrandIcon name="trash" /> Empty trash
            </Button>
          ) : undefined
        }
      />
      {threads.length > 0 && <KeyLegend trash={isTrash} />}
      {!isSeen && <ListFilters f={f} showWhere={bucket === "everything"} />}
      <ThreadList
        loading={loading}
        error={error}
        onRetry={() => q.refetch()}
        showBucket={showBucket}
        inTrash={isTrash}
        emptyIcon={art.icon}
        sections={[{ threads, emptyTitle: f.active ? "No matches." : art.title, emptyBody: f.active ? "Try fewer filters, or a different word." : art.body }]}
        footer={<LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />}
      />
      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Empty the trash?</AlertDialogTitle>
            <AlertDialogDescription>Everything in it is deleted for good, here and in your mailboxes. There is no undo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                emptyTrash.mutate(undefined, {
                  onSuccess: (r) => toast(r.deleted === 1 ? "Deleted 1 thread" : `Deleted ${r.deleted} threads`, { kind: "success" }),
                  onError: (e) => toast((e as Error).message, { kind: "error" }),
                })
              }
            >
              Empty trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
