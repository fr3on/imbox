import { BrandIcon } from "../components/BrandIcons";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { messageLooksUrgent } from "@shared/urgent";
import { useAiSettings, useFeed, useFillGists, useBulkAction, type FeedBucket, } from "../api";
import { useAccount } from "../context/AccountContext";
import { ConnectGmailCard } from "./Imbox";
import { FeedCard } from "../components/FeedCard";
import { FileTile } from "./Files";
import { LoadMore } from "../components/ThreadList";
import { EmptyState, ErrorState, PageHeader } from "../components/EmptyState";
import { DigestCard } from "../components/DigestCard";
import { KeyLegend, UPDATES_KEYS } from "../components/KeyLegend";
import { UpdateRow } from "../components/UpdateRow";
import { useToast } from "../components/Toast";
import { useCardScroll, cardBeingRead } from "../lib/cardKeys";
import { useKeys } from "../lib/keys";
import { useDebounced } from "../lib/useDebounced";
import { buildStream, kindOf, ofKind, type Kind } from "../lib/updates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const OUT_MS = 120;

const EMPTY: Record<Kind, { icon: React.ReactNode; title: string; body: string }> = {
  all: { icon: <BrandIcon name="imbox" />, title: "Nothing new here.", body: "Newsletters, receipts and notices land here once you screen their senders in." },
  reading: { icon: <BrandIcon name="feed" />, title: "Nothing to read.", body: "Screen a newsletter into Feed and it shows up here." },
  receipts: { icon: <BrandIcon name="paper-trail" />, title: "No receipts or notices.", body: "Screen a sender into Feed and their mail shows up here." },
};

function Skel() {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-5">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

/**
 * Feeds and Paper Trail as one page: a single stream by day. Newsletters are cards you read; receipts and notices are compact lines, and a long
 * run of them in one day folds into one line. The chips narrow it to one kind. The two buckets are untouched underneath.
 */
export default function Feed() {
  const { accounts } = useAccount();
  const [sp, setSp] = useSearchParams();
  const kind: Kind = sp.get("kind") === "reading" ? "reading" : sp.get("kind") === "receipts" ? "receipts" : "all";
  const setKind = (k: Kind) => setSp((p) => { const n = new URLSearchParams(p); if (k === "all") n.delete("kind"); else n.set("kind", k); return n; }, { replace: true });
  const [show, setShow] = useState<"new" | "all">("new");
  const bulk = useBulkAction();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [filesOnly, setFilesOnly] = useState(false);
  // The search and the files chip are answered by the server, over everything, not over the pages loaded so far.
  const needle = useDebounced(q.trim(), 300);
  const feed = useFeed(accounts.length > 0, show, "library", { q: needle, files: filesOnly });
  const aiOn = useAiSettings().data?.configured === true;
  const [confirmAll, setConfirmAll] = useState(false);
  const [readId, setReadId] = useState<string | null>(null);
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const loaded = feed.data?.pages.flatMap((p) => p.threads) ?? [];
  const searched = loaded;
  const inKind = ofKind(searched, kind);
  // What demands something is a receipt or notice; a newsletter that says "expires soon" is not it.
  const urgentIds = new Set(searched.filter((t) => kindOf(t) === "receipts" && !!t.latest_message && messageLooksUrgent(t.latest_message)).map((t) => t.id));
  const threads = urgentOnly && urgentIds.size > 0 ? inKind.filter((t) => urgentIds.has(t.id)) : inKind;
  // What has not been looked at: new newsletters and notices, and unread receipts (which stay on the page once read).
  const clearable = threads.filter((t) => !t.seen);
  const reading = threads.find((t) => t.id === readId) ?? null;
  const rest = threads.filter((t) => t.id !== reading?.id);
  const shelf = filesOnly ? rest.filter((t) => t.files?.length) : [];
  const items = useMemo(() => (filesOnly ? [] : buildStream(rest, folds)), [rest, folds, filesOnly]);
  // The one-line summaries the page did not come with are asked for together, a few at a time, and not once per card.
  useFillGists(reading ? [reading, ...rest.filter((t) => kindOf(t) === "reading")] : rest.filter((t) => kindOf(t) === "reading"), aiOn && !filesOnly);
  const more = feed.hasNextPage ? "+" : "";
  // A chip filters what is loaded, so when the newest pages hold only the other kind, keep fetching rather than show an empty list with more mail still to come.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const wantMore = kind !== "all" && inKind.length < 10 && !!hasNextPage && !isFetchingNextPage && !feed.isLoading && !feed.error;
  useEffect(() => {
    if (wantMore) fetchNextPage();
  }, [wantMore, fetchNextPage, loaded.length]);
  const readingN = ofKind(searched, "reading").length;
  const receiptsN = ofKind(searched, "receipts").length;

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
    }, OUT_MS);
  };
  // A receipt stays on the page once read, so it is marked in place; a newsletter or notice fades out as it leaves.
  const done = (id: string) => {
    const t = loaded.find((x) => x.id === id);
    if (t?.bucket === "paper_trail") bulk.mutate({ thread_ids: [id], action: "seen" }, { onSuccess: () => toast("Marked read", { kind: "success" }) });
    else finish(id, () => bulk.mutate({ thread_ids: [id], action: "seen" }, { onSuccess: () => toast("Done", { kind: "success" }) }));
  };

  const openReading = (id: string) => {
    setReadId(id);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  // The keyboard walks the rows: j and k move, Enter opens, e is Done.
  const nav = useNavigate();
  const rowIds = items.flatMap((it) => (it.type === "reading" || it.type === "receipt" ? [it.t.id] : []));
  const [cursorId, setCursorId] = useState<string | null>(null);
  const step = (d: 1 | -1) => {
    if (!rowIds.length) return;
    const i = cursorId ? rowIds.indexOf(cursorId) : -1;
    const id = rowIds[Math.min(Math.max(i + d, 0), rowIds.length - 1)];
    setCursorId(id);
    document.querySelector(`[data-update-row="${id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const cur = cursorId ? loaded.find((t) => t.id === cursorId) : undefined;
  useKeys(
    {
      j: () => step(1),
      k: () => step(-1),
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      Enter: () => cur && (kindOf(cur) === "reading" ? openReading(cur.id) : nav(`/t/${cur.id}`)),
      e: () => cur && !cur.seen && done(cur.id),
    },
    accounts.length > 0 && !reading,
  );
  useCardScroll();
  // `e` is Done on the newsletter that is open.
  useKeys({ e: () => { const id = cardBeingRead(); if (id) done(id); } }, accounts.length > 0 && !!reading);

  if (accounts.length === 0) return <ConnectGmailCard />;
  const empty = !feed.isLoading && threads.length === 0 && !feed.error && !wantMore && !isFetchingNextPage;

  return (
    <div className="max-w-5xl mx-auto w-full">
      {(() => {
        const tools = loaded.length > 0 || q.trim() !== "" || filesOnly;
        return (
          <>
            <PageHeader
              className="px-2"
              title="Feed"
              subtitle={readingN ? `${readingN}${more} to read, and your receipts, notices and alerts.` : "Newsletters to read, and the receipts, notices and alerts you keep."}
              actions={
                tools ? (
                  <div className="relative w-56 max-w-full">
                    <BrandIcon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Feed" aria-label="Search Feed" className="pl-8" />
                    {q && (
                      <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            />
            {rowIds.length > 0 && <KeyLegend hints={UPDATES_KEYS} />}
            {tools && (
              <div role="group" aria-label="What to show" className="mb-4 grid grid-cols-2 gap-2.5 px-2 sm:grid-cols-4">
                {(
                  [
                    { id: "reading", label: "Reading", n: `${readingN}${more}`, icon: <BrandIcon name="feed" />, on: kind === "reading", toggle: () => setKind(kind === "reading" ? "all" : "reading") },
                    { id: "receipts", label: "Receipts and alerts", n: `${receiptsN}${more}`, icon: <BrandIcon name="paper-trail" />, on: kind === "receipts", toggle: () => setKind(kind === "receipts" ? "all" : "receipts") },
                    ...(urgentIds.size > 0 ? [{ id: "urgent", label: "Needs a response", n: `${urgentIds.size}`, icon: <AlertTriangle />, on: urgentOnly, toggle: () => setUrgentOnly((v) => !v) }] : []),
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.on}
                    onClick={c.toggle}
                    className={cn("grid gap-0.5 rounded-xl border p-3.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring", c.on ? "border-2 border-foreground p-[13px]" : "border-border hover:bg-accent")}
                  >
                    <span className="text-muted-foreground [&>svg]:size-5">{c.icon}</span>
                    <span className={cn("mt-1 w-fit text-[26px] font-semibold leading-none tracking-[-0.03em] tnum", c.id === "urgent" && "rounded-md bg-amber-500/15 px-1.5 text-amber-800 dark:text-amber-300")}>{c.n}</span>
                    <span className="mt-1 text-sm font-medium">{c.label}</span>
                  </button>
                ))}
              </div>
            )}
            {kind === "all" && show === "new" && !needle && !filesOnly && !urgentOnly && accounts.length > 0 && <DigestCard fold className="mb-4 mx-2" />}
            {tools && (
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-2 text-[13px] text-muted-foreground">
                <span className="tnum">
                  {show === "new" ? `Showing ${threads.length}${more} new` : `Showing ${threads.length}${more}, including done`}
                  <button type="button" onClick={() => setShow(show === "new" ? "all" : "new")} className="ml-2 underline underline-offset-2 hover:text-foreground">
                    {show === "new" ? "Show done" : "Hide done"}
                  </button>
                </span>
                <span className="flex-1" />
                {show === "new" && clearable.length > 1 &&
                  (confirmAll ? (
                    <div className="flex items-center gap-1.5">
                      <span>Mark {clearable.length} as done?</span>
                      <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ thread_ids: clearable.map((t) => t.id), action: "seen" }, { onSuccess: () => { setConfirmAll(false); toast(`${clearable.length} marked done`, { kind: "success" }); } })}>
                        Yes, all
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmAll(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setConfirmAll(true)}>
                      <CheckCheck /> Mark all done
                    </Button>
                  ))}
              </div>
            )}
          </>
        );
      })()}
      {feed.error && <ErrorState error={feed.error} onRetry={() => feed.refetch()} />}
      {feed.isLoading && (
        <div className="space-y-3">
          <Skel />
          <Skel />
        </div>
      )}
      {empty && (needle ? <EmptyState icon={<BrandIcon name="search" />} title="No matches." body="Try a different word, or clear the search." /> : <EmptyState icon={EMPTY[kind].icon} title={EMPTY[kind].title} body={EMPTY[kind].body} />)}

      {reading && (
        <section aria-label="Reading" className="mb-6">
          <Button variant="ghost" size="sm" className="mb-2 text-muted-foreground" onClick={() => setReadId(null)}>
            <ArrowLeft /> Back to the list
          </Button>
          <div data-feed-card={reading.id} className={cn("scroll-mt-16 transition-opacity duration-100", leaving.has(reading.id) && "opacity-0")}>
            <FeedCard t={reading} bucket={reading.bucket as FeedBucket} onLeave={finish} />
          </div>
        </section>
      )}

      {shelf.length > 0 && (
        <section aria-label="Files" className="mb-8">
          <div className="mb-3 flex items-center gap-3 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            Files
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-2 sm:grid-cols-3 lg:grid-cols-4">
            {shelf.flatMap((t) =>
              (t.files ?? []).map((f) => (
                <div key={f.id} className={cn("flex min-w-0 flex-col transition-opacity duration-100", leaving.has(t.id) && "opacity-0")}>
                  <FileTile f={f} />
                  <Button variant="ghost" size="xs" className="mt-1 self-start text-muted-foreground" title="Marks the whole message done, not only this file" onClick={() => done(t.id)}>
                    <Check /> Message done
                  </Button>
                </div>
              )),
            )}
          </div>
        </section>
      )}

      <div className="space-y-0.5">
        {items.map((it) => (
          <Fragment key={it.key}>
            {it.type === "day" && (
              <div className="flex items-center gap-3 px-2 pb-1 pt-4 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground first:pt-0">
                {it.label}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {(it.type === "reading" || it.type === "receipt") && (
              <div className={cn("transition-opacity duration-100", leaving.has(it.t.id) && "opacity-0")}>
                <UpdateRow
                  t={it.t}
                  active={cursorId === it.t.id}
                  // A newsletter opens in the reader above the list; anything else opens its thread.
                  {...(it.type === "reading" ? { onOpen: () => openReading(it.t.id) } : { to: `/t/${it.t.id}` })}
                  onDone={() => done(it.t.id)}
                  doneLabel={it.t.bucket === "paper_trail" ? "Mark read" : "Done"}
                />
              </div>
            )}
            {it.type === "fold" && (
              <button
                type="button"
                onClick={() => setFolds((f) => new Set(f).add(it.key))}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground">
                  Open <ChevronRight className="size-3.5" />
                </span>
              </button>
            )}
          </Fragment>
        ))}
      </div>
      {readId && !reading && <span className="sr-only">That one is already done.</span>}
      <LoadMore hasMore={!!feed.hasNextPage} loading={feed.isFetchingNextPage} onMore={() => feed.fetchNextPage()} />
    </div>
  );
}
