import { BrandIcon } from "../components/BrandIcons";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, CheckCheck, MoveRight, X } from "lucide-react";
import type { MergedContact, ScreenStatus } from "@shared/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useBulkContactStatus, useContacts, useUpdateContact } from "../api";
import { filterContacts, kindOf, sortContacts, tabCounts, type ContactKind, type ContactSort, type ContactTab, type KindOverrides } from "../lib/contactKind";
import { useKindOverrides } from "../lib/contactKindOverride";
import { useCompose } from "../context/ComposeContext";
import { useAccount } from "../context/AccountContext";
import { AccountDot, Avatar } from "../components/Avatar";
import { ContactInsights } from "../components/ContactInsights";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../components/EmptyState";
import { fmtTime } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCardScroll } from "../lib/cardKeys";

export const STATUS_META: Record<ScreenStatus, { label: string; short: string; icon: React.ReactNode }> = {
  pending: { label: "In Screener", short: "Screener", icon: <BrandIcon name="screener" /> },
  imbox: { label: "Imbox", short: "Imbox", icon: <BrandIcon name="imbox" /> },
  feed: { label: "Feed", short: "Feed", icon: <BrandIcon name="feed" /> },
  paper_trail: { label: "Receipts", short: "Receipts", icon: <BrandIcon name="paper-trail" /> },
  screened_out: { label: "Screened out", short: "Out", icon: <BrandIcon name="not-now" /> },
};

export function StatusChip({ s, small }: { s: ScreenStatus; small?: boolean }) {
  const m = STATUS_META[s];
  return (
    <Badge variant="secondary" className={cn("gap-1 font-normal text-muted-foreground [&>svg]:size-3", small && "text-[11px] px-1.5")}>
      {m.icon}
      {m.label}
    </Badge>
  );
}

const CHOICES: ScreenStatus[] = ["imbox", "feed", "paper_trail", "screened_out"];

/** Inline "where their mail goes" property, Notion-style: a quiet select that mutates on change. */
export function StatusSelect({ c, className }: { c: MergedContact; className?: string }) {
  const update = useUpdateContact();
  if (c.screen_status === "pending") {
    return (
      <Link to="/screener" className={cn("inline-flex", className)}>
        <StatusChip s="pending" small />
      </Link>
    );
  }
  return (
    <Select value={c.screen_status} onValueChange={(v) => update.mutate({ id: c.id, screen_status: v as ScreenStatus })}>
      <SelectTrigger size="sm" className={cn("h-7 border-transparent bg-transparent px-1.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted [&>svg]:opacity-0 hover:[&>svg]:opacity-100", className)} aria-label="Where their mail goes">
        <SelectValue>
          <span className="inline-flex items-center gap-1.5 [&>svg]:size-3.5">
            {STATUS_META[c.screen_status].icon}
            {STATUS_META[c.screen_status].label}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {CHOICES.map((s) => (
          <SelectItem key={s} value={s}>
            <span className="inline-flex items-center gap-2 [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
              {STATUS_META[s].icon}
              {STATUS_META[s].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The kinds as cards, like the Screener's. "All" is the link beside the count, not a card.
const TABS: { key: ContactTab; label: string; icon: React.ReactNode }[] = [
  { key: "people", label: "People", icon: <BrandIcon name="sender" /> },
  { key: "services", label: "Services", icon: <BrandIcon name="feed" /> },
  { key: "waiting", label: "Waiting", icon: <BrandIcon name="screener" /> },
  { key: "out", label: "Screened out", icon: <BrandIcon name="not-now" /> },
];

const DESTINATIONS: { value: ScreenStatus | "any"; label: string; icon?: React.ReactNode }[] = [
  { value: "any", label: "Anywhere" },
  { value: "imbox", label: "Imbox", icon: <BrandIcon name="imbox" /> },
  { value: "feed", label: "Feed", icon: <BrandIcon name="feed" /> },
];

const SORTS: { value: ContactSort; label: string }[] = [
  { value: "latest", label: "Latest first" },
  { value: "messages", label: "Most messages" },
  { value: "name", label: "Name" },
];

const MOVES: { status: ScreenStatus; label: string; icon: React.ReactNode }[] = [
  { status: "imbox", label: "Imbox", icon: <BrandIcon name="imbox" /> },
  { status: "feed", label: "Feed", icon: <BrandIcon name="feed" /> },
  { status: "paper_trail", label: "Receipts", icon: <BrandIcon name="paper-trail" /> },
];

/** A quick action on a row: an icon that appears on hover, with its name in a tooltip. */
function RowAction({ label, onClick, children }: { label: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick} className="text-muted-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Rows({
  list,
  multi,
  selected,
  onToggle,
  byName,
  overrides,
  onKind,
}: {
  list: MergedContact[];
  multi: boolean;
  selected: Set<string>;
  onToggle: (id: string, shift: boolean) => void;
  /** Sorted by name: a letter heading starts each run. */
  byName: boolean;
  overrides: KindOverrides;
  onKind: (email: string, kind: ContactKind) => void;
}) {
  const { accountFor, colorFor } = useAccount();
  const { openCompose } = useCompose();
  const update = useUpdateContact();
  const any = selected.size > 0;
  const cols = multi ? 7 : 6;
  let letter = "";
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="border-0 hover:bg-transparent">
          <TableHead className="h-7 w-9 pl-2" />
          <TableHead className="h-7 w-[46%] text-xs font-normal text-muted-foreground sm:w-[28%]">Name</TableHead>
          <TableHead className="hidden h-7 text-xs font-normal text-muted-foreground sm:table-cell">Email</TableHead>
          <TableHead className="hidden h-7 w-[72px] text-right text-xs font-normal text-muted-foreground sm:table-cell">Messages</TableHead>
          {multi && <TableHead className="hidden h-7 w-[150px] text-xs font-normal text-muted-foreground md:table-cell">Mailbox</TableHead>}
          <TableHead className="h-7 w-[34%] text-xs font-normal text-muted-foreground sm:w-[19%]">Goes to</TableHead>
          <TableHead className="hidden h-7 w-[150px] pr-2 text-right text-xs font-normal text-muted-foreground sm:table-cell">Last</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((c) => {
          const on = selected.has(c.id);
          const name = c.name || c.email.split("@")[0];
          const first = (name[0] ?? "#").toUpperCase();
          const heading = byName && first !== letter ? (letter = first) : "";
          const kind = kindOf(c, overrides);
          return (
            <Fragment key={c.email}>
              {heading && (
                <TableRow className="border-0 hover:bg-transparent">
                  <TableCell colSpan={cols} className="h-8 px-2 pb-0 pt-3 font-mono text-[11px] tracking-[0.07em] text-tertiary">{heading}</TableCell>
                </TableRow>
              )}
              <TableRow data-state={on ? "selected" : undefined} className={cn("group h-10 border-0", on ? "bg-accent hover:bg-accent" : "hover:bg-muted")}>
                <TableCell className="w-9 py-0 pl-2">
                  <Checkbox
                    checked={on}
                    onClick={(e) => onToggle(c.id, (e as React.MouseEvent).shiftKey)}
                    aria-label={`Select ${name}`}
                    className={cn("size-4 rounded-[3px] transition-opacity", on || any ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")}
                  />
                </TableCell>
                <TableCell className="py-0">
                  <Link to={`/contacts/${c.id}`} className="flex h-10 min-w-0 items-center gap-2.5">
                    <Avatar email={c.email} name={c.name} src={c.avatar_url} size={20} />
                    <span className="truncate text-sm font-medium">{name}</span>
                  </Link>
                </TableCell>
                <TableCell className="hidden truncate py-0 text-muted-foreground sm:table-cell">
                  <Link to={`/contacts/${c.id}`} className="block truncate">{c.email}</Link>
                </TableCell>
                <TableCell className="hidden py-0 text-right text-[13px] text-muted-foreground tnum sm:table-cell">{c.message_count > 0 ? c.message_count : ""}</TableCell>
                {multi && (
                  <TableCell className="hidden py-0 md:table-cell">
                    {c.accounts.length === 1 ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <AccountDot color={colorFor(c.accounts[0]!.account_id)} />
                        <span className="truncate">{accountFor(c.accounts[0]!.account_id)?.email}</span>
                      </span>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="flex gap-0.5">
                              {c.accounts.slice(0, 3).map((a) => (
                                <AccountDot key={a.account_id} color={colorFor(a.account_id)} />
                              ))}
                            </span>
                            <span className="tnum">{c.accounts.length} mailboxes</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{c.accounts.map((a) => accountFor(a.account_id)?.email ?? a.account_id).join(" · ")}</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                )}
                <TableCell className="overflow-hidden py-0">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusSelect c={c} className="min-w-0" />
                    {c.mixed && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="shrink-0 px-1.5 text-[11px] font-normal text-muted-foreground">Mixed</Badge>
                        </TooltipTrigger>
                        <TooltipContent>{c.accounts.map((a) => `${accountFor(a.account_id)?.email ?? a.account_id}: ${STATUS_META[a.screen_status].label}`).join(" · ")}</TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </TableCell>
                <TableCell className="hidden py-0 pr-2 text-right text-xs text-muted-foreground tnum sm:table-cell">
                  <span className="group-hover:hidden group-focus-within:hidden">{fmtTime(c.last_seen_at)}</span>
                  <span className="hidden items-center justify-end gap-0.5 group-hover:flex group-focus-within:flex">
                    {c.screen_status === "screened_out" && (
                      <Button variant="outline" size="xs" disabled={update.isPending} onClick={() => update.mutate({ id: c.id, screen_status: "imbox" }, { onSuccess: () => toast(`${name} is let back in`) })}>
                        Let back in
                      </Button>
                    )}
                    <RowAction label="Write" onClick={() => openCompose({ to: [{ email: c.email, name: c.name }] })}>
                      <BrandIcon name="write" />
                    </RowAction>
                    {c.screen_status !== "pending" && (
                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" aria-label="Move" className="text-muted-foreground hover:text-foreground">
                                <MoveRight />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>Move</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                          {MOVES.map((m) => (
                            <DropdownMenuItem key={m.status} onSelect={() => update.mutate({ id: c.id, screen_status: m.status })}>
                              {m.icon} {m.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {c.screen_status !== "pending" && c.screen_status !== "screened_out" && (
                      <RowAction label={kind === "person" ? "This is a service, not a person" : "This is a person, not a service"} onClick={() => onKind(c.email, kind === "person" ? "service" : "person")}>
                        {kind === "person" ? <Bot /> : <BrandIcon name="sender" />}
                      </RowAction>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The bar that appears while contacts are ticked: where to send them all, or never see them again. */
function BulkContacts({ ids, total, onClear, onAll }: { ids: string[]; total: number; onClear: () => void; onAll: () => void }) {
  const bulk = useBulkContactStatus();
  const go = (status: ScreenStatus, doneLabel: string) =>
    bulk.mutate(
      { ids, status },
      {
        onSuccess: (r) => {
          toast(r.failed ? `${doneLabel} ${r.ok}. ${r.failed} could not be changed.` : `${doneLabel} ${r.ok}`);
          onClear();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  return (
    <div role="toolbar" aria-label={`Actions for ${ids.length} selected`} className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-border/70 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2 duration-150">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Clear selection" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onClear}>
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Clear selection <Kbd className="ml-1">esc</Kbd>
        </TooltipContent>
      </Tooltip>
      <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-foreground px-2 text-xs font-medium text-background tnum">{ids.length} selected</span>
      {total > ids.length && (
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onAll}>
          <CheckCheck /> Select all {total}
        </Button>
      )}
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" disabled={bulk.isPending} className="shrink-0 gap-1.5 text-muted-foreground hover:text-foreground">
            <MoveRight /> Move to
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {MOVES.map((m) => (
            <DropdownMenuItem key={m.status} onSelect={() => go(m.status, `Moved to ${m.label}:`)}>
              {m.icon} {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="min-w-2 flex-1" />
      <Button variant="ghost" size="sm" disabled={bulk.isPending} className="shrink-0 gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => go("screened_out", "Screened out")}>
        <BrandIcon name="not-now" /> Screen out
      </Button>
    </div>
  );
}

const PAGE = 50;

export default function Contacts() {
  useCardScroll();
  // What is typed, and what is searched for: the search waits for a pause in the typing rather than asking the server for every letter.
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(typed.trim()), 250);
    return () => window.clearTimeout(t);
  }, [typed]);
  const { overrides, setKind } = useKindOverrides();
  // The list draws a page at a time; the rest is a click away.
  const [limit, setLimit] = useState(PAGE);
  const [tab, setTab] = useState<ContactTab>("all");
  const [dest, setDest] = useState<ScreenStatus | "any">("any");
  const [sort, setSort] = useState<ContactSort>("latest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClick, setLastClick] = useState<string | null>(null);
  const { multi } = useAccount();
  const res = useContacts(q);
  const all = res.data ?? [];
  const counts = tabCounts(all, overrides);
  // Where it goes only means something for people who have been let in.
  const showDest = tab === "all" || tab === "people" || tab === "services";
  const shown = sortContacts(filterContacts(all, tab, showDest ? dest : "any", overrides), sort);
  const page = shown.slice(0, limit);
  const ids = shown.map((c) => c.id);
  // A new search, tab, filter or order starts again from the first page.
  useEffect(() => setLimit(PAGE), [q, tab, dest, sort]);
  // A selection can only include what is on screen; changing the view drops anything that has left it.
  const live = [...selected].filter((id) => ids.includes(id));

  const toggle = (id: string, shift: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (shift && lastClick) {
        const a = ids.indexOf(lastClick);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClick(id);
  };
  const clear = () => setSelected(new Set());

  return (
    <div className="mx-auto w-full max-w-5xl px-2" onKeyDown={(e) => e.key === "Escape" && live.length > 0 && clear()}>
      <PageHeader
        title="Contacts"
        subtitle="Everyone who's written to you, and where their mail goes."
        actions={
          <div className="relative w-56 max-w-full">
            <BrandIcon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search people…" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search contacts" className="pl-8" />
          </div>
        }
      />

      {!q && showDest && <ContactInsights list={all} />}

      <div role="tablist" aria-label="Kinds of contact" className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setTab(t.key);
                clear();
              }}
              className={cn("grid gap-0.5 rounded-xl border p-3.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring", on ? "border-2 border-foreground p-[13px]" : "border-border hover:bg-accent")}
            >
              <span className="text-muted-foreground [&>svg]:size-5">{t.icon}</span>
              <span className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.03em] tnum">{counts[t.key]}</span>
              <span className="mt-1 text-sm font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px] text-muted-foreground tnum">
          {tab === "all" ? `All ${counts.all} contacts` : `Showing ${shown.length} of ${counts.all}`}
          {tab !== "all" && (
            <button type="button" onClick={() => { setTab("all"); clear(); }} className="ml-2 underline underline-offset-2 hover:text-foreground">
              Show all
            </button>
          )}
        </span>
        <span className="flex-1" />
        {showDest && (
          <Select value={dest} onValueChange={(v) => setDest(v as ScreenStatus | "any")}>
            <SelectTrigger size="sm" className="h-7 w-auto gap-1.5 border-transparent bg-muted/60 px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Where their mail goes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DESTINATIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  <span className="inline-flex items-center gap-2 [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
                    {d.icon}
                    {d.value === "any" ? "Goes anywhere" : `Goes to ${d.label}`}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={(v) => setSort(v as ContactSort)}>
          <SelectTrigger size="sm" className="h-7 w-auto gap-1.5 border-transparent bg-muted/60 px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {live.length > 0 && <BulkContacts ids={live} total={ids.length} onClear={clear} onAll={() => setSelected(new Set(ids))} />}

      {res.error && <ErrorState error={res.error} onRetry={() => res.refetch()} />}
      {res.isLoading && <SkeletonRows rows={8} compact />}
      {!res.isLoading && all.length === 0 && !res.error && (
        <EmptyState
          icon={<BrandIcon name="screener" />}
          title={q ? "Nobody by that name." : "No one's written yet."}
          body={q ? "Try a different spelling, or just part of the address." : "People show up here as their mail arrives, along with where you've decided it goes."}
        />
      )}
      {!res.isLoading && all.length > 0 && shown.length === 0 && (
        <EmptyState icon={<BrandIcon name="search" />} title="Nobody here." body="Nothing matches this tab and filter. Try another tab, or set the destination to Anywhere." />
      )}
      {shown.length > 0 && <Rows list={page} multi={multi} selected={new Set(live)} onToggle={toggle} byName={sort === "name"} overrides={overrides} onKind={(email, kind) => { setKind(email, kind); toast(kind === "person" ? "Listed under People" : "Listed under Services"); }} />}
      {shown.length > PAGE && (
        <div className="mt-2 flex items-center justify-between px-2 text-[13px] text-muted-foreground">
          <span className="tnum">Showing {Math.min(limit, shown.length)} of {shown.length}</span>
          {limit < shown.length && (
            <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
