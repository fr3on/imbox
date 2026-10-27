import { BrandIcon } from "../../components/BrandIcons";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { Attachment, CalEvent, MergedContact } from "@shared/types";
import {
  BookmarkCheck,
  Mail,
  Paperclip,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { readRequestWithAi, useSavedSearches, useSavedSearchMutations, useSearch, useSearchAnswer, useSearchOverview } from "../../api";
import { contentWords, highlightTerms, isNaturalLanguage, looksLikeQuestion, parseSearch, withoutPiece } from "@shared/searchQuery";
import { extractDates, planRequest, queryFromPlan } from "@shared/searchPlan";
import { SearchFilterBar } from "../../components/SearchFilters";
import { useToast } from "../../components/Toast";
import { PageHeader } from "../../components/EmptyState";
import { LoadMore, ThreadList } from "../../components/ThreadList";

import type { SearchTab } from "./types";
import { fileIcon, fmtSize } from "./format";
import { useTextHighlight } from "./highlight";
import { RECENT_KEY, readRecent, rememberSearch } from "./recent";
import { EXAMPLES, ZeroState } from "./ZeroState";
import { OverviewSection } from "./results/Overview";
import { AnswerSection } from "./results/Answer";
import { AlsoMatching } from "./results/AlsoMatching";
import { ContactsTab } from "./results/ContactsTab";
import { FilesTab } from "./results/FilesTab";
import { EventsTab } from "./results/EventsTab";

export { EXAMPLES, fmtSize, fileIcon, useTextHighlight, RECENT_KEY, readRecent, rememberSearch };
export type { SearchTab };

export default function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const q = sp.get("q") ?? "";
  // `ask` is the request as typed when it was read into the filters in `q`; `exact` searches the typed words as they are.
  const ask = sp.get("ask") ?? "";
  const exact = sp.get("exact") === "1";
  const tabParam = (sp.get("tab") as SearchTab) || "all";
  const [activeTab, setActiveTab] = useState<SearchTab>(tabParam);
  const [text, setText] = useState(q);
  const [reading, setReading] = useState(false);
  const [wantOverview, setWantOverview] = useState(false);

  useEffect(() => setText(q), [q]);
  useEffect(() => setActiveTab(tabParam), [tabParam]);
  useEffect(() => setWantOverview(false), [q]);

  const sort = sp.get("sort") === "newest" ? "newest" : "best";
  const res = useSearch(q, sort, { exact, relax: !!ask });
  const question = !exact && looksLikeQuestion(ask || q);
  const { pieces, parsed: readAs } = parseSearch(q);
  const answer = useSearchAnswer(ask || q, question, ask ? q : undefined);
  const [recent, setRecent] = useState<string[]>(readRecent);
  useEffect(() => {
    if (q.trim()) {
      rememberSearch(q.trim());
      setRecent(readRecent());
    }
  }, [q]);
  const firstPage = res.data?.pages[0];
  const words = firstPage?.terms ?? highlightTerms(parseSearch(!exact && isNaturalLanguage(q) ? contentWords(q) || q : q).parsed);
  const threads = res.data?.pages.flatMap((p) => p.threads) ?? [];
  const contacts: MergedContact[] = firstPage?.contacts ?? [];
  const files: Attachment[] = firstPage?.files ?? [];
  const events: CalEvent[] = firstPage?.events ?? [];
  const overview = useSearchOverview(q, !!firstPage?.relaxed, wantOverview && threads.length > 0);
  const saved = useSavedSearches();
  const savedMut = useSavedSearchMutations();
  const savedHere = saved.data?.find((x) => x.query === q);

  const counts = firstPage?.counts ?? {
    threads: threads.length,
    contacts: contacts.length,
    files: files.length,
    events: events.length,
    total: threads.length + contacts.length + files.length + events.length,
  };
  // Calendar events have their own tab; the numbers on the page are for mail, people and files.
  const shown = counts.total - counts.events;

  const listRef = useRef<HTMLDivElement>(null);
  useTextHighlight(listRef, words, threads);
  const inputRef = useRef<HTMLInputElement>(null);

  const setTab = (t: SearchTab) => {
    setActiveTab(t);
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (t === "all") p.delete("tab");
      else p.set("tab", t);
      return p;
    });
  };

  const go = (next: string, extra: { ask?: string; exact?: boolean } = {}) => {
    setText(next);
    setSp((prev) => {
      const p = new URLSearchParams(prev);
      if (next) p.set("q", next);
      else p.delete("q");
      if (extra.ask) p.set("ask", extra.ask);
      else p.delete("ask");
      if (extra.exact) p.set("exact", "1");
      else p.delete("exact");
      return p;
    });
  };

  // A request in plain words ("unread mail from Harbor Bank last month") is read into words and filters first, so the filters show as chips
  // that can be taken off. The AI reads it when it is set up; otherwise, or if it cannot, the page's own rules do.
  const submit = async (raw: string) => {
    const t = raw.trim();
    if (!t) return go("");
    const plain = parseSearch(t).pieces.length === 0;
    const natural = isNaturalLanguage(t);
    if (plain && (natural || extractDates(t, Date.now()))) {
      setReading(true);
      const plan = (natural ? await readRequestWithAi(t) : null) ?? planRequest(t);
      setReading(false);
      const next = queryFromPlan(plan);
      if (next && next !== t) return go(next, { ask: t });
    }
    go(t);
  };

  const countText = q && !res.isLoading ? `${shown} ${shown === 1 ? "result" : "results"} for “${q}”` : undefined;

  const toggleSave = () => {
    if (savedHere) savedMut.remove.mutate(savedHere.id, { onSuccess: () => toast.toast("Search removed") });
    else savedMut.save.mutate({ q }, { onSuccess: () => toast.toast("Search saved"), onError: (e) => toast.toast((e as Error).message) });
  };

  const tabs: { id: SearchTab; label: string; icon?: React.ReactNode; count: number }[] = [
    { id: "all", label: "All", count: shown },
    { id: "mail", label: "Mail", icon: <Mail size={13} />, count: counts.threads },
    { id: "contacts", label: "People", icon: <BrandIcon name="sender" size={13} />, count: counts.contacts },
    { id: "files", label: "Files", icon: <Paperclip size={13} />, count: counts.files },
    ...(counts.events > 0 ? [{ id: "events" as const, label: "Calendar", icon: <BrandIcon name="calendar" size={13} />, count: counts.events }] : []),
  ];

  return (
    <div className="max-w-5xl mx-auto w-full px-2 sm:px-4 py-2">
      <style>{`::highlight(imbox-search){background:var(--accent);color:var(--foreground);text-decoration:underline;text-underline-offset:2px}`}</style>
      <PageHeader
        className="px-0 mb-4"
        title="Search"
        subtitle={countText ?? "Search across mail, people, attachments, and calendar events."}
      />

      {/* Main Search Bar */}
      <form
        role="search"
        className="relative mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <BrandIcon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search mail, people and files, or ask in your own words…"
          className="w-full h-12 pl-11 pr-24 rounded-xl border border-border/80 bg-background text-base placeholder:text-muted-foreground outline-none focus:border-foreground/50 focus:ring-2 focus:ring-ring/20 shadow-xs transition-all"
        />
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {reading && <span className="text-xs text-muted-foreground">Reading…</span>}
          {text && !reading && (
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Clear" className="text-muted-foreground hover:text-foreground" onClick={() => { go(""); inputRef.current?.focus(); }}>
              <X size={14} />
            </Button>
          )}
          {!reading && <Kbd className="hidden sm:inline-flex text-[11px] px-1.5 py-0.5 font-mono">↵</Kbd>}
        </div>
      </form>

      {/* How the request was read, as chips that can be taken off */}
      {q && (ask || pieces.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 pb-3" aria-label="How this search was read">
          {ask && !exact && <span className="text-[13px] text-muted-foreground">Read from “{ask}” as</span>}
          {pieces.map((pc) => (
            <span key={pc.text} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2.5 pr-1 text-[12.5px]">
              {pc.label}
              <button type="button" aria-label={`Remove ${pc.label}`} className="grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => go(withoutPiece(q, pc), { ask })}>
                <X size={11} />
              </button>
            </span>
          ))}
          {readAs.terms.length > 0 && ask && !exact && (
            <span className="text-[13px] text-muted-foreground">
              about <b className="font-medium text-foreground">{readAs.terms.join(" ")}</b>
            </span>
          )}
          {ask && !exact && (
            <button type="button" onClick={() => go(ask, { exact: true })} className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Search the exact words instead
            </button>
          )}
        </div>
      )}

      {q && (
        <div className="pb-3">
          <SearchFilterBar
            q={q}
            facets={firstPage?.facets}
            onChange={(next) => go(next, { ask })}
            trailing={
              <>
                <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={threads.length === 0 || wantOverview} onClick={() => setWantOverview(true)}>
                  <BrandIcon name="assistant" /> Summarize
                </Button>
                <Button type="button" variant="outline" size="sm" className="rounded-full" aria-pressed={!!savedHere} onClick={toggleSave} disabled={savedMut.save.isPending || savedMut.remove.isPending}>
                  {savedHere ? <BookmarkCheck /> : <BrandIcon name="set-aside" />} {savedHere ? "Saved" : "Save search"}
                </Button>
              </>
            }
          />
        </div>
      )}

      {q && firstPage?.relaxed && words.length > 0 && (
        <p className="-mt-1 pb-3 text-[13px] text-muted-foreground">
          No mail has every word. Showing mail that matches: <b className="font-medium text-foreground">{words.join(" ")}</b>
        </p>
      )}

      {q ? (
        <div className="space-y-6">
          {/* Category Tabs */}
          <div className="flex items-center gap-1 border-b border-border/60 pb-1">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                className={cn(
                  "px-3.5 py-2 rounded-lg text-xs sm:text-[13px] font-medium transition-all flex items-center gap-2",
                  activeTab === tb.id ? "bg-muted text-foreground font-semibold shadow-2xs" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                {tb.icon}
                <span>{tb.label}</span>
                {tb.count > 0 && <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-background border border-border/60">{tb.count}</span>}
              </button>
            ))}
            <span className="flex-1" />
            <div role="group" aria-label="Order" className="flex items-center gap-0.5 text-xs">
              {(["best", "newest"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  aria-pressed={sort === o}
                  onClick={() =>
                    setSp((prev) => {
                      const p = new URLSearchParams(prev);
                      if (o === "best") p.delete("sort");
                      else p.set("sort", o);
                      return p;
                    })
                  }
                  className={cn("rounded-md px-2 py-1", sort === o ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {o === "best" ? "Best match" : "Newest"}
                </button>
              ))}
            </div>
          </div>

          {/* What the results are about, written by the AI when asked for */}
          {wantOverview && (activeTab === "all" || activeTab === "mail") && (
            <OverviewSection overview={overview} />
          )}

          {/* TAB: ALL (Blended view) */}
          {activeTab === "all" && (
            <div className="space-y-8" ref={listRef}>
              <AnswerSection answer={answer} />

              {/* People and files that match, in one thin strip */}
              <AlsoMatching contacts={contacts} files={files} onSelectTab={setTab} />

              {/* Mail Threads Matches */}
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Mail size={14} /> Mail & Messages ({threads.length})
                  </h2>
                </div>
                <ThreadList
                  showBucket
                  loading={res.isLoading}
                  error={res.error}
                  onRetry={() => res.refetch()}
                  emptyIcon={<BrandIcon name="search" />}
                  sections={[
                    {
                      threads,
                      emptyTitle: "No mail matches.",
                      emptyBody: "No email threads matched your query.",
                    },
                  ]}
                  footer={
                    <LoadMore
                      hasMore={!!res.hasNextPage}
                      loading={res.isFetchingNextPage}
                      onMore={() => res.fetchNextPage()}
                    />
                  }
                />
              </section>
            </div>
          )}

          {/* TAB: MAIL */}
          {activeTab === "mail" && (
            <div ref={listRef}>
              <ThreadList
                showBucket
                loading={res.isLoading}
                error={res.error}
                onRetry={() => res.refetch()}
                emptyIcon={<Mail />}
                sections={[
                  {
                    threads,
                    emptyTitle: "No matching emails.",
                    emptyBody: "Try adjusting your search terms or filters.",
                  },
                ]}
                footer={
                  <LoadMore
                    hasMore={!!res.hasNextPage}
                    loading={res.isFetchingNextPage}
                    onMore={() => res.fetchNextPage()}
                  />
                }
              />
            </div>
          )}

          {/* TAB: CONTACTS */}
          {activeTab === "contacts" && (
            <ContactsTab contacts={contacts} q={q} />
          )}

          {/* TAB: FILES */}
          {activeTab === "files" && (
            <FilesTab files={files} q={q} />
          )}

          {/* TAB: CALENDAR */}
          {activeTab === "events" && (
            <EventsTab events={events} q={q} />
          )}
        </div>
      ) : (
        <ZeroState
          savedSearches={saved.data}
          recent={recent}
          onSubmitExample={submit}
          onGo={go}
          onRemoveSaved={(id) => savedMut.remove.mutate(id)}
        />
      )}
    </div>
  );
}
