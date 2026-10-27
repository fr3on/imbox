import { BrandIcon } from "../components/BrandIcons";
import { Link, useParams } from "react-router-dom";
import { useLabelThreads, useLabels } from "../api";
import { LoadMore, ThreadList } from "../components/ThreadList";
import { PageHeader } from "../components/EmptyState";
import { KeyLegend } from "../components/KeyLegend";
import { Button } from "@/components/ui/button";

export default function LabelThreads() {
  const { id } = useParams();
  const labels = useLabels();
  const label = labels.data?.find((l) => l.id === id);
  const q = useLabelThreads(id);
  const threads = q.data?.pages.flatMap((p) => p.threads) ?? [];
  const n = threads.length;
  const more = q.hasNextPage ? "+" : "";
  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader
        className="px-2"
        title={
          <span className="inline-flex items-center gap-2.5">
            <BrandIcon name="labels" className="size-5 text-muted-foreground" />
            {label?.name ?? "Label"}
          </span>
        }
        subtitle={n ? `${n}${more} ${n === 1 && !more ? "thread" : "threads"} with this label.` : "A label."}
        actions={
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link to="/labels">All labels</Link>
          </Button>
        }
      />
      {n > 0 && <KeyLegend />}
      <ThreadList showBucket loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyIcon={<BrandIcon name="labels" />} sections={[{ threads, emptyTitle: "Nothing wears this label yet.", emptyBody: "Select a thread and press b to tag it." }]} footer={<LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />} />
    </div>
  );
}
