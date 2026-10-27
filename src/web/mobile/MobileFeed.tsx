import { BrandIcon } from "../components/BrandIcons";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCheck, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { messageLooksUrgent } from "@shared/urgent";
import { useAiSettings, useFeed, useFillGists, useBulkAction, type FeedBucket, } from "../api";
import { useAccount } from "../context/AccountContext";
import { LoadMore } from "../components/ThreadList";
import { ErrorState } from "../components/EmptyState";
import { UrgentChip } from "../components/UrgentChip";
import { DigestCard } from "../components/DigestCard";
import { UpdateRow } from "../components/UpdateRow";
import { useMenuPreset } from "../lib/menuPresets";
import { useDebounced } from "../lib/useDebounced";
import { buildStream, kindOf, ofKind, type Kind } from "../lib/updates";
import { FileTile } from "../pages/Files";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Screen } from "./Screen";
import { MobileConnectCard } from "./MobileImbox";
import { MobileEmpty } from "./MobileList";
import { MobileFeedCard } from "./MobileFeedCard";
import { usePullToRefresh } from "./usePullToRefresh";

const EMPTY: Record<Kind, { icon: React.ReactNode; title: string; body: string }> = {
  all: { icon: <BrandIcon name="imbox" />, title: "Nothing new here.", body: "Newsletters, receipts and notices land here once you screen their senders in." },
  reading: { icon: <BrandIcon name="feed" />, title: "Nothing to read.", body: "Screen a newsletter into Feed and it shows up here." },
  receipts: { icon: <BrandIcon name="paper-trail" />, title: "No receipts or notices.", body: "Screen a sender into Feed and their mail shows up here." },
};

/** Feeds and Paper Trail as one stream on a phone: newsletters as cards, receipts and notices as lines, a long run in one day folded. */
export default function MobileFeed() {
  const { accounts } = useAccount();
  const [sp, setSp] = useSearchParams();
  const kind: Kind = sp.get("kind") === "reading" ? "reading" : sp.get("kind") === "receipts" ? "receipts" : "all";
  const setKind = (k: Kind) => setSp((p) => { const n = new URLSearchParams(p); if (k === "all") n.delete("kind"); else n.set("kind", k); return n; }, { replace: true });
  const [show, setShow] = useState<"new" | "all">("new");
  const [q, setQ] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [filesOnly, setFilesOnly] = useState(false);
  // The search and the files chip are answered by the server, over everything, not over the pages loaded so far.
  const needle = useDebounced(q.trim(), 300);
  const feed = useFeed(accounts.length > 0, show, "library", { q: needle, files: filesOnly });
  const ptr = usePullToRefresh(() => feed.refetch(), accounts.length > 0);
  const bulk = useBulkAction();
  const aiOn = useAiSettings().data?.configured === true;
  const [confirmAll, setConfirmAll] = useState(false);
  const [readId, setReadId] = useState<string | null>(null);
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  // When the menu style puts this page in the bottom bar there is no "More" to go back to.
  const preset = useMenuPreset();
  const inBar = preset.mobile.includes("updates");

  const loaded = feed.data?.pages.flatMap((p) => p.threads) ?? [];
  const searched = loaded;
  const inKind = ofKind(searched, kind);
  const urgentIds = new Set(searched.filter((t) => kindOf(t) === "receipts" && !!t.latest_message && messageLooksUrgent(t.latest_message)).map((t) => t.id));
  const threads = urgentOnly && urgentIds.size > 0 ? inKind.filter((t) => urgentIds.has(t.id)) : inKind;
  const reading = threads.find((t) => t.id === readId) ?? null;
  const rest = threads.filter((t) => t.id !== reading?.id);
  const shelf = filesOnly ? rest.filter((t) => t.files?.length) : [];
  const items = useMemo(() => (filesOnly ? [] : buildStream(rest, folds)), [rest, folds, filesOnly]);
  const more = feed.hasNextPage ? "+" : "";
  // The one-line summaries the page did not come with are asked for together, a few at a time, and not once per card.
  useFillGists(reading ? [reading, ...rest.filter((t) => kindOf(t) === "reading")] : rest.filter((t) => kindOf(t) === "reading"), aiOn && !filesOnly);
  // A chip filters what is loaded, so when the newest pages hold only the other kind, keep fetching rather than show an empty list with more mail still to come.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const wantMore = kind !== "all" && inKind.length < 10 && !!hasNextPage && !isFetchingNextPage && !feed.isLoading && !feed.error;
  useEffect(() => {
    if (wantMore) fetchNextPage();
  }, [wantMore, fetchNextPage, loaded.length]);
  const readingN = ofKind(searched, "reading").length;

  const finish = (id: string, cb: () => void) => {
    if (id === readId) setReadId(null);
    setLeaving((l) => new Set([...l, id]));
    window.setTimeout(() => {
      cb();
      setLeaving((l) => {
        const n = new Set(l);
        n.delete(id);
        return n;
      });
    }, 160);
  };
  const done = (id: string) => finish(id, () => bulk.mutate({ thread_ids: [id], action: "seen" }, { onSuccess: () => toast("Done") }));
  const empty = !feed.isLoading && threads.length === 0 && !feed.error && !wantMore && !isFetchingNextPage;
  const unread = threads.filter((t) => !t.seen);

  return (
    <Screen
      title="Feed"
      largeTitle
      back={inBar ? undefined : "/more"}
      backLabel={inBar ? undefined : "More"}
      subtitle={accounts.length ? (readingN ? `${readingN}${more} to read, and your receipts and notices.` : "Newsletters to read, and the receipts and notices you keep.") : undefined}
      fab={accounts.length > 0}
      titleRight={
        accounts.length > 0 ? (
          <ToggleGroup type="single" value={show} onValueChange={(v) => v && setShow(v as "new" | "all")} variant="outline" size="sm" className="mr-2">
            <ToggleGroupItem value="new">New</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        ) : undefined
      }
    >
      {accounts.length === 0 ? (
        <MobileConnectCard />
      ) : (
        <div {...ptr.handlers}>
          {ptr.indicator}
          {kind === "all" && show === "new" && !needle && !filesOnly && !urgentOnly && <DigestCard compact className="mx-4 mb-3" />}
          {(loaded.length > 0 || q.trim() !== "" || filesOnly) && (
            <div className="mx-4 mb-3 space-y-2">
              <label className="flex h-10 items-center gap-2 rounded-lg bg-muted px-3">
                <BrandIcon name="search" size={16} className="shrink-0 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reading and receipts" enterKeyHint="search" type="search" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-tertiary" />
                {q && (
                  <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-muted-foreground">
                    <X size={16} />
                  </button>
                )}
              </label>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Kind">
                {([["all", "All"], ["reading", `Reading${readingN ? ` ${readingN}${more}` : ""}`], ["receipts", "Receipts and alerts"]] as const).map(([k, label]) => (
                  <Button key={k} variant={kind === k ? "secondary" : "outline"} className="h-9 shrink-0" aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {label}
                  </Button>
                ))}
                {urgentIds.size > 0 && <UrgentChip large count={urgentIds.size} on={urgentOnly} onToggle={() => setUrgentOnly((v) => !v)} />}
              </div>
              {show === "new" && unread.length > 1 && (
                <div className="flex items-center justify-end gap-2 text-[13px]">
                  {confirmAll ? (
                    <>
                      <span className="text-muted-foreground">Mark {unread.length} as done?</span>
                      <Button size="sm" className="h-9" disabled={bulk.isPending} onClick={() => bulk.mutate({ thread_ids: unread.map((t) => t.id), action: "seen" }, { onSuccess: () => { setConfirmAll(false); toast(`${unread.length} marked done`); } })}>Yes, all</Button>
                      <Button size="sm" variant="outline" className="h-9" onClick={() => setConfirmAll(false)}>Cancel</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={() => setConfirmAll(true)}>
                      <CheckCheck /> Mark all done
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          {feed.error && <ErrorState error={feed.error} onRetry={() => feed.refetch()} />}
          {feed.isLoading && (
            <div className="space-y-4 px-4" aria-busy>
              <Skeleton className="h-5 w-[40%]" />
              <Skeleton className="h-6 w-[80%]" />
              <Skeleton className="h-32" />
            </div>
          )}
          {empty && (needle ? <MobileEmpty icon={<BrandIcon name="search" />} title="No matches." body="Try a different word, or clear the search." /> : <MobileEmpty icon={EMPTY[kind].icon} title={EMPTY[kind].title} body={EMPTY[kind].body} />)}

          {reading && (
            <section aria-label="Reading" className="mb-5 px-4">
              <Button variant="ghost" className="mb-2 h-9 px-2 text-muted-foreground" onClick={() => setReadId(null)}>
                <ArrowLeft /> Back to the list
              </Button>
              <div className={cn("transition-opacity duration-150", leaving.has(reading.id) && "opacity-0")}>
                <MobileFeedCard t={reading} bucket={reading.bucket as FeedBucket} onLeave={finish} />
              </div>
            </section>
          )}

          {shelf.length > 0 && (
            <section aria-label="Files" className="mb-6 px-4">
              <div className="mb-3 flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                Files
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                {shelf.flatMap((t) =>
                  (t.files ?? []).map((f) => (
                    <div key={f.id} className={cn("flex min-w-0 flex-col transition-opacity duration-150", leaving.has(t.id) && "opacity-0")}>
                      <FileTile f={f} />
                      <Button variant="ghost" className="mt-1 h-9 self-start px-2 text-[13px] text-muted-foreground" onClick={() => done(t.id)}>
                        <Check /> Message done
                      </Button>
                    </div>
                  )),
                )}
              </div>
            </section>
          )}

          <div className="space-y-1 px-4">
            {items.map((it) => (
              <Fragment key={it.key}>
                {it.type === "day" && (
                  <div className="flex items-center gap-3 pb-1 pt-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground first:pt-0">
                    {it.label}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                {(it.type === "reading" || it.type === "receipt") && (
                  <div className={cn("transition-opacity duration-150", leaving.has(it.t.id) && "opacity-0")}>
                    <UpdateRow
                      mobile
                      t={it.t}
                      {...(it.type === "reading" ? { onOpen: () => { setReadId(it.t.id); window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" })); } } : { to: `/t/${it.t.id}` })}
                    />
                  </div>
                )}
                {it.type === "fold" && (
                  <button type="button" onClick={() => setFolds((f) => new Set(f).add(it.key))} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed border-border px-3.5 py-2.5 text-left text-[13.5px] text-muted-foreground active:bg-muted/50">
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground">
                      Open <ChevronRight className="size-4" />
                    </span>
                  </button>
                )}
              </Fragment>
            ))}
          </div>
          <LoadMore hasMore={!!feed.hasNextPage} loading={feed.isFetchingNextPage} onMore={() => feed.fetchNextPage()} />
        </div>
      )}
    </Screen>
  );
}
