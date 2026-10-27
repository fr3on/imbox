import { BrandIcon } from "../components/BrandIcons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, X } from "lucide-react";
import { toast } from "sonner";
import type { MergedContact, ScreenStatus } from "@shared/types";
import { cn } from "@/lib/utils";
import { useBulkContactStatus, useContacts, useUpdateContact } from "../api";
import { Avatar } from "../components/Avatar";
import { ContactInsights } from "../components/ContactInsights";
import { EmptyState, ErrorState } from "../components/EmptyState";
import { fmtTime } from "../lib/format";
import { filterContacts, sortContacts, tabCounts, type ContactSort, type ContactTab } from "../lib/contactKind";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionSheet } from "./ActionSheet";
import { Pick } from "./MobileListFilters";
import { Screen } from "./Screen";

const TABS: { key: ContactTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "people", label: "People" },
  { key: "services", label: "Services" },
  { key: "waiting", label: "Waiting" },
  { key: "out", label: "Screened out" },
];

const WHERE = [
  ["any", "Anywhere"],
  ["imbox", "Imbox"],
  ["feed", "Feed"],
] as const;
const SORT = [
  ["latest", "Latest first"],
  ["messages", "Most messages"],
  ["name", "Name"],
] as const;

const DEST: Record<ScreenStatus, { label: string; icon: React.ReactNode }> = {
  pending: { label: "Screener", icon: <BrandIcon name="screener" /> },
  imbox: { label: "Imbox", icon: <BrandIcon name="imbox" /> },
  feed: { label: "Feed", icon: <BrandIcon name="feed" /> },
  paper_trail: { label: "Receipts", icon: <FileText /> },
  screened_out: { label: "Out", icon: <BrandIcon name="not-now" /> },
};

const MOVES: { status: ScreenStatus; label: string; icon: React.ReactNode }[] = [
  { status: "imbox", label: "Imbox", icon: <BrandIcon name="imbox" /> },
  { status: "feed", label: "Feed", icon: <BrandIcon name="feed" /> },
  { status: "screened_out", label: "Screen out", icon: <BrandIcon name="not-now" /> },
];

function Row({ c, selecting, selected, onToggle, onOpen, onDestination }: { c: MergedContact; selecting: boolean; selected: boolean; onToggle: () => void; onOpen: () => void; onDestination: () => void }) {
  const d = DEST[c.screen_status];
  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5", selected && "bg-accent")}>
      <button type="button" onClick={selecting ? onToggle : onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70">
        {selecting ? <Checkbox checked={selected} aria-label={`Select ${c.name || c.email}`} className="size-5 shrink-0" tabIndex={-1} /> : <Avatar email={c.email} name={c.name} src={c.avatar_url} size={40} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-medium leading-5">{c.name || c.email.split("@")[0]}</span>
          <span className="block truncate text-[13px] leading-4 text-muted-foreground">{c.email}</span>
          <span className="block text-[12px] leading-4 text-tertiary tnum">
            {c.message_count > 0 ? `${c.message_count} ${c.message_count === 1 ? "message" : "messages"} · ` : ""}
            {fmtTime(c.last_seen_at)}
          </span>
        </span>
      </button>
      {!selecting && (
        <button
          type="button"
          onClick={onDestination}
          aria-label={`Goes to ${d.label}. Change`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-muted/70 px-2.5 text-[12.5px] text-muted-foreground active:bg-muted [&>svg]:size-3.5"
        >
          {d.icon} {d.label}
        </button>
      )}
    </div>
  );
}

/** Contacts on a phone: tabs you can swipe, big rows, one tap to change where someone's mail goes, and a Select mode with a bottom bar. */
export default function MobileContacts() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<ContactTab>("all");
  const [dest, setDest] = useState<ScreenStatus | "any">("any");
  const [sort, setSort] = useState<ContactSort>("latest");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [changing, setChanging] = useState<MergedContact | null>(null);
  const res = useContacts(q);
  const update = useUpdateContact();
  const bulk = useBulkContactStatus();

  const all = res.data ?? [];
  const counts = tabCounts(all);
  const showDest = tab === "all" || tab === "people" || tab === "services";
  const shown = sortContacts(filterContacts(all, tab, showDest ? dest : "any"), sort);
  const ids = shown.map((c) => c.id);
  const live = [...selected].filter((id) => ids.includes(id));

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const move = (status: ScreenStatus, doneLabel: string) =>
    bulk.mutate(
      { ids: live, status },
      {
        onSuccess: (r) => {
          toast(r.failed ? `${doneLabel} ${r.ok}. ${r.failed} could not be changed.` : `${doneLabel} ${r.ok}`);
          stopSelecting();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );

  return (
    <Screen
      title="Contacts"
      largeTitle
      back="/more"
      backLabel="More"
      subtitle="Everyone who's written to you, and where their mail goes."
      tabs={!selecting}
      bottomInset={selecting ? 76 : 0}
      titleRight={
        all.length > 0 ? (
          <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} className="mr-1 h-9 rounded-full px-3 text-[15px] font-medium text-foreground active:bg-muted">
            {selecting ? "Done" : "Select"}
          </button>
        ) : undefined
      }
    >
      <div className="px-4 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-lg bg-muted px-3">
          <BrandIcon name="search" size={16} className="shrink-0 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" enterKeyHint="search" type="search" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-tertiary" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-muted-foreground">
              <X size={16} />
            </button>
          )}
        </label>
      </div>

      {!q && showDest && !selecting && <ContactInsights list={all} compact />}

      <div role="tablist" aria-label="Kinds of contact" className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setSelected(new Set());
            }}
            className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] active:opacity-70", tab === t.key ? "bg-foreground font-medium text-background" : "bg-muted text-muted-foreground")}
          >
            {t.label}
            <span className={cn("tnum text-[12px]", tab === t.key ? "text-background/70" : "text-tertiary")}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {showDest && <Pick label="Where their mail goes" value={dest} onChange={(v) => setDest(v as ScreenStatus | "any")} options={WHERE} />}
        <Pick label="Sort by" value={sort} onChange={(v) => setSort(v as ContactSort)} options={SORT} />
      </div>

      {res.error && <ErrorState error={res.error} onRetry={() => res.refetch()} />}
      {res.isLoading && (
        <div className="space-y-3 px-4 pt-2" aria-busy>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-[45%]" />
                <Skeleton className="h-3 w-[70%]" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!res.isLoading && all.length === 0 && !res.error && (
        <EmptyState icon={<BrandIcon name="screener" />} title={q ? "Nobody by that name." : "No one's written yet."} body={q ? "Try a different spelling, or part of the address." : "People show up here as their mail arrives."} />
      )}
      {!res.isLoading && all.length > 0 && shown.length === 0 && <EmptyState icon={<BrandIcon name="search" />} title="Nobody here." body="Nothing matches this tab and filter." />}

      <div className="divide-y divide-border/50">
        {shown.map((c) => (
          <Row
            key={c.email}
            c={c}
            selecting={selecting}
            selected={live.includes(c.id)}
            onToggle={() => toggle(c.id)}
            onOpen={() => nav(`/contacts/${c.id}`)}
            onDestination={() => (c.screen_status === "pending" ? nav("/screener") : setChanging(c))}
          />
        ))}
      </div>

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 px-3 pt-2 backdrop-blur" style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium tnum">{live.length} selected</div>
              {ids.length > live.length && (
                <button type="button" className="text-[12.5px] text-muted-foreground active:text-foreground" onClick={() => setSelected(new Set(ids))}>
                  Select all {ids.length}
                </button>
              )}
            </div>
            <Button variant="outline" size="lg" className="h-11 px-4 text-[15px]" disabled={live.length === 0 || bulk.isPending} onClick={() => setMoveOpen(true)}>
              Move to
            </Button>
            <Button variant="outline" size="lg" className="h-11 px-4 text-[15px] text-destructive" disabled={live.length === 0 || bulk.isPending} onClick={() => move("screened_out", "Screened out")}>
              <BrandIcon name="not-now" /> Screen out
            </Button>
          </div>
        </div>
      )}

      <ActionSheet
        open={moveOpen}
        onOpenChange={setMoveOpen}
        title={`Move ${live.length} ${live.length === 1 ? "contact" : "contacts"} to`}
        actions={MOVES.filter((m) => m.status !== "screened_out").map((m) => ({ icon: m.icon, label: m.label, onSelect: () => move(m.status, `Moved to ${m.label}:`) }))}
      />
      <ActionSheet
        open={!!changing}
        onOpenChange={(o) => !o && setChanging(null)}
        title={changing ? `Where ${changing.name || changing.email.split("@")[0]}'s mail goes` : undefined}
        actions={MOVES.map((m) => ({
          icon: m.icon,
          label: m.label,
          checked: changing?.screen_status === m.status,
          onSelect: () => changing && update.mutate({ id: changing.id, screen_status: m.status }, { onSuccess: () => toast(`Now goes to ${m.label}`), onError: (e) => toast.error((e as Error).message) }),
        }))}
      />
    </Screen>
  );
}
