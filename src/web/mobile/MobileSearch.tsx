import { BrandIcon } from "../components/BrandIcons";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookmarkCheck, FileText, Paperclip, X } from "lucide-react";
import type { Attachment, MergedContact } from "@shared/types";
import { contentWords, highlightTerms, isNaturalLanguage, isoDay, looksLikeQuestion, parseSearch, withFilter, withoutFilter, withoutPiece } from "@shared/searchQuery";
import { extractDates, planRequest, queryFromPlan } from "@shared/searchPlan";
import { cn } from "@/lib/utils";
import { readRequestWithAi, useSavedSearchMutations, useSavedSearches, useSearch, useSearchAnswer, useSearchOverview, type SearchFacets } from "../api";
import { LoadMore } from "../components/ThreadList";
import { bucketName } from "../components/BulkBar";
import { Avatar } from "../components/Avatar";
import { Screen } from "./Screen";
import { MobileList } from "./MobileList";
import { Pick } from "./MobileListFilters";

// Phone search. It speaks the same query language as the desktop page: a request in plain words is read into chips and filters, the filter
// row writes its changes back into the query text, and the AI parts (reading, Summarize, Answer) only show up when a provider is set up.

const DAY = 86_400_000;
const EXAMPLES = ["invoices from last month", "unread mail with attachments", "receipts since March", "what did we agree about the budget?"];
const RECENT_KEY = "inbox.search.recent";

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function rememberSearch(q: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...readRecent().filter((x) => x !== q)].slice(0, 6)));
  } catch {
    /* storage can be blocked */
  }
}

const chip = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] active:opacity-70 [&>svg]:size-3.5";

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn(chip, on ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
      {children}
    </button>
  );
}

function Filters({ q, facets, onChange }: { q: string; facets?: SearchFacets | null; onChange: (next: string) => void }) {
  const { parsed } = parseSearch(q);
  const now = Date.now();
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const set = (key: string, value: string | null) => onChange(withFilter(q, key, value));

  const senders = facets?.senders ?? [];
  const fromOpts: [string, string][] = [["any", "Any sender"], ...senders.map((s): [string, string] => [s.email, `${s.name || s.email} (${s.count})`])];
  if (parsed.from && !senders.some((s) => s.email.toLowerCase() === parsed.from.toLowerCase())) fromOpts.push([parsed.from, parsed.from]);

  const periods: [string, number][] = [["7", 7], ["30", 30], ["90", 90], ["365", 365]];
  const timeOpts: [string, string][] = [["any", "Any time"], ["7", "Past week"], ["30", "Past month"], ["90", "Past 3 months"], ["365", "Past year"]];
  const custom = parsed.after !== null || parsed.before !== null;
  const timeValue = !custom ? "any" : parsed.before === null ? periods.find(([, d]) => parsed.after === today - d * DAY)?.[0] ?? "custom" : "custom";
  if (timeValue === "custom") timeOpts.push(["custom", "Custom dates"]);
  const setTime = (v: string) => {
    if (v === "custom") return;
    const base = withoutFilter(q, "after", "before");
    onChange(v === "any" ? base : [base, `after:${isoDay(today - Number(v) * DAY)}`].filter(Boolean).join(" "));
  };

  const places = (facets?.places ?? []).filter((p) => p.bucket !== "trash");
  const whereOpts: [string, string][] = [["any", "Everywhere"], ...places.map((p): [string, string] => [p.bucket, `${bucketName(p.bucket)} (${p.count})`])];
  const mailboxes = facets?.mailboxes ?? [];
  const boxOpts: [string, string][] = [["any", "All mailboxes"], ...mailboxes.map((m): [string, string] => [m.email, `${m.email} (${m.count})`])];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 scrollbar-none" role="group" aria-label="Narrow the results">
      <Pick label="From" value={parsed.from || "any"} onChange={(v) => set("from", v === "any" ? null : v)} options={fromOpts} />
      <Pick label="Date" value={timeValue} onChange={setTime} options={timeOpts} />
      <Toggle on={parsed.hasAttachment} onClick={() => set("has", parsed.hasAttachment ? null : "file")}>
        <Paperclip aria-hidden="true" /> Has file
      </Toggle>
      <Toggle on={parsed.unread === true} onClick={() => set("is", parsed.unread === true ? null : "unread")}>
        Unread
      </Toggle>
      {(places.length > 1 || parsed.bucket) && <Pick label="Where" value={parsed.bucket || "any"} onChange={(v) => set("in", v === "any" ? null : v)} options={whereOpts} />}
      {(mailboxes.length > 1 || parsed.mailbox) && <Pick label="Mailbox" value={parsed.mailbox || "any"} onChange={(v) => set("mailbox", v === "any" ? null : v)} options={boxOpts} />}
    </div>
  );
}

function AiCard({ label, loading, off, answer, error, sources, empty }: { label: string; loading: boolean; off?: boolean; answer?: string; error?: boolean; sources: { thread_id: string; subject: string; from: string }[]; empty?: string }) {
  return (
    <section className="mx-3 mb-3 rounded-xl border border-border/70 bg-muted/40 p-3.5" aria-label={label} aria-busy={loading}>
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        <BrandIcon name="assistant" size={12} aria-hidden="true" /> {label}
      </div>
      {loading && <p className="mt-1.5 text-[14px] text-muted-foreground">Reading the top results…</p>}
      {off && <p className="mt-1.5 text-[14px] text-muted-foreground">Set up an AI provider in Settings to get this.</p>}
      {error && <p className="mt-1.5 text-[14px] text-muted-foreground">It could not be written. Try again in a moment.</p>}
      {!loading && !off && !error && !answer && empty && <p className="mt-1.5 text-[14px] text-muted-foreground">{empty}</p>}
      {answer && (
        <>
          <p className="mt-1.5 text-[14.5px] leading-relaxed">{answer}</p>
          {sources.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">From</span>
              {sources.map((s) => (
                <Link key={s.thread_id} to={`/t/${s.thread_id}`} className="max-w-full truncate rounded-full border border-border bg-background px-2.5 py-0.5 text-[12.5px] active:bg-muted">
                  {s.from}: {s.subject}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);

export function MobileSearch() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const ask = sp.get("ask") ?? "";
  const exact = sp.get("exact") === "1";
  const [text, setText] = useState(q);
  const [reading, setReading] = useState(false);
  const [wantOverview, setWantOverview] = useState(false);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setText(q), [q]);
  useEffect(() => setWantOverview(false), [q]);

  const res = useSearch(q, "best", { exact, relax: !!ask });
  const firstPage = res.data?.pages[0];
  const threads = res.data?.pages.flatMap((p) => p.threads) ?? [];
  const contacts: MergedContact[] = firstPage?.contacts ?? [];
  const files: Attachment[] = firstPage?.files ?? [];
  const { pieces, parsed: readAs } = parseSearch(q);
  const question = !exact && looksLikeQuestion(ask || q);
  const answer = useSearchAnswer(ask || q, question, ask ? q : undefined);
  const overview = useSearchOverview(q, !!firstPage?.relaxed, wantOverview && threads.length > 0);
  const saved = useSavedSearches();
  const savedMut = useSavedSearchMutations();
  const savedHere = saved.data?.find((x) => x.query === q);
  const words = firstPage?.terms ?? highlightTerms(parseSearch(!exact && isNaturalLanguage(q) ? contentWords(q) || q : q).parsed);

  useEffect(() => {
    if (q.trim()) {
      rememberSearch(q.trim());
      setRecent(readRecent());
    }
  }, [q]);

  const go = (next: string, extra: { ask?: string; exact?: boolean } = {}) => {
    setText(next);
    const p = new URLSearchParams();
    if (next) p.set("q", next);
    if (next && extra.ask) p.set("ask", extra.ask);
    if (next && extra.exact) p.set("exact", "1");
    setSp(p, { replace: true });
  };

  const submit = async (raw: string) => {
    const t = raw.trim();
    if (!t) return go("");
    inputRef.current?.blur();
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

  const toggleSave = () => {
    if (savedHere) savedMut.remove.mutate(savedHere.id);
    else savedMut.save.mutate({ q });
  };

  const shown = (firstPage?.counts?.total ?? 0) - (firstPage?.counts?.events ?? 0);

  return (
    <Screen
      title="Search"
      back
      below={
        <div className="px-3 pb-2">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(text);
            }}
            className="flex h-10 items-center gap-2 rounded-lg bg-muted px-3"
          >
            <BrandIcon name="search" size={16} className="shrink-0 text-muted-foreground" />
            <input ref={inputRef} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search, or ask in your own words" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-tertiary" type="search" enterKeyHint="search" />
            {reading && <span className="text-xs text-muted-foreground">Reading…</span>}
            {text && !reading && (
              <button type="button" onClick={() => { go(""); inputRef.current?.focus(); }} aria-label="Clear" className="text-muted-foreground">
                <X size={16} />
              </button>
            )}
          </form>
        </div>
      }
    >
      <div className="pt-12">
        {q ? (
          <>
            {(ask || pieces.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2" aria-label="How this search was read">
                {ask && !exact && <span className="text-[13px] text-muted-foreground">Read from “{ask}” as</span>}
                {pieces.map((pc) => (
                  <span key={pc.text} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2.5 pr-1 text-[12.5px]">
                    {pc.label}
                    <button type="button" aria-label={`Remove ${pc.label}`} className="grid size-5 place-items-center rounded-full text-muted-foreground active:bg-muted" onClick={() => go(withoutPiece(q, pc), { ask })}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {readAs.terms.length > 0 && ask && !exact && (
                  <span className="text-[13px] text-muted-foreground">
                    about <b className="font-medium text-foreground">{readAs.terms.join(" ")}</b>
                  </span>
                )}
                {ask && !exact && (
                  <button type="button" onClick={() => go(ask, { exact: true })} className="text-[13px] text-muted-foreground underline underline-offset-2">
                    Search the exact words instead
                  </button>
                )}
              </div>
            )}

            <Filters q={q} facets={firstPage?.facets} onChange={(next) => go(next, { ask })} />

            <div className="flex items-center gap-1.5 px-3 pb-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{!res.isLoading ? `${shown} ${shown === 1 ? "result" : "results"}` : "Searching…"}</span>
              <button type="button" disabled={threads.length === 0 || wantOverview} onClick={() => setWantOverview(true)} className={cn(chip, "border border-border disabled:opacity-40")}>
                <BrandIcon name="assistant" /> Summarize
              </button>
              <button type="button" aria-pressed={!!savedHere} onClick={toggleSave} disabled={savedMut.save.isPending || savedMut.remove.isPending} className={cn(chip, "border border-border disabled:opacity-40")}>
                {savedHere ? <BookmarkCheck /> : <BrandIcon name="set-aside" />} {savedHere ? "Saved" : "Save"}
              </button>
            </div>

            {firstPage?.relaxed && words.length > 0 && (
              <p className="px-3 pb-2 text-[13px] text-muted-foreground">
                No mail has every word. Showing mail that matches: <b className="font-medium text-foreground">{words.join(" ")}</b>
              </p>
            )}

            {wantOverview && <AiCard label="Overview · written by AI" loading={overview.isLoading} off={overview.data?.off} answer={overview.data?.answer} error={!!overview.error || (!!overview.data && !overview.data.off && !overview.data.answer && !!overview.data.error)} sources={overview.data?.sources ?? []} empty="Nothing to summarize here." />}
            {answer.data && !answer.data.off && answer.data.answer && <AiCard label="Answer · written by AI" loading={false} answer={answer.data.answer} sources={answer.data.sources} />}

            {(contacts.length > 0 || files.length > 0) && (
              <section aria-label="Also matching" className="pb-3">
                <h2 className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Also matching</h2>
                <div className="flex gap-2 overflow-x-auto px-3 scrollbar-none">
                  {contacts.slice(0, 4).map((c) => (
                    <Link key={c.id} to={`/contacts/${c.id}`} className="flex w-56 shrink-0 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2 active:bg-muted/40">
                      <Avatar email={c.email} name={c.name} src={c.avatar_url} size={28} />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium">{c.name || c.email}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.message_count ? `${c.message_count} messages` : "Person"}</div>
                      </div>
                    </Link>
                  ))}
                  {files.slice(0, 6).map((f) => (
                    <Link key={f.id} to={`/t/${f.thread_id}`} className="flex w-56 shrink-0 items-center gap-2.5 rounded-xl border border-border/70 bg-card px-3 py-2 active:bg-muted/40">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted"><FileText size={16} className="text-muted-foreground" /></span>
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium">{f.filename || "Untitled"}</div>
                        <div className="truncate text-xs text-muted-foreground">{fmtSize(f.size)}{f.from ? ` · ${f.from.name || f.from.email}` : ""}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <MobileList loading={res.isLoading} error={res.error} onRetry={() => res.refetch()} emptyIcon={<BrandIcon name="search" />} showBucket sections={[{ threads, emptyTitle: "No matches.", emptyBody: "Try fewer words, or take a filter off." }]} footer={<LoadMore hasMore={!!res.hasNextPage} loading={res.isFetchingNextPage} onMore={() => res.fetchNextPage()} />} />
          </>
        ) : (
          <div className="px-4 py-6 text-[14px]">
            <p className="text-center text-muted-foreground">Search mail, people and files, or ask in your own words.</p>
            <Suggest title="Try asking" items={EXAMPLES.map((e) => ({ key: e, label: e, onPick: () => void submit(e) }))} />
            {(saved.data?.length ?? 0) > 0 && (
              <Suggest
                title="Saved searches"
                items={(saved.data ?? []).map((x) => ({ key: x.id, label: x.name, onPick: () => go(x.query), onRemove: () => savedMut.remove.mutate(x.id) }))}
              />
            )}
            {recent.length > 0 && <Suggest title="Recent searches" items={recent.map((r) => ({ key: r, label: r, onPick: () => go(r) }))} />}
          </div>
        )}
      </div>
    </Screen>
  );
}

function Suggest({ title, items }: { title: string; items: { key: string; label: string; onPick: () => void; onRemove?: () => void }[] }) {
  return (
    <div className="mt-6">
      <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span key={it.key} className="inline-flex max-w-full items-center rounded-full bg-muted text-[13px] text-muted-foreground">
            <button type="button" onClick={it.onPick} className={cn("min-h-8 min-w-0 truncate px-3 active:opacity-70", it.onRemove && "pr-1.5")}>{it.label}</button>
            {it.onRemove && (
              <button type="button" aria-label={`Remove ${it.label}`} onClick={it.onRemove} className="grid size-8 place-items-center rounded-full">
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
