import { BrandIcon } from "../components/BrandIcons";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Paperclip, Reply, } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { cn } from "@/lib/utils";
import { useThreads } from "../api";
import { useAccount } from "../context/AccountContext";
import { ConnectGmailCard } from "./Imbox";
import { LoadMore } from "../components/ThreadList";
import { Avatar } from "../components/Avatar";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../components/EmptyState";
import { ListFilters, useListFilters } from "../components/ListFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtTime } from "../lib/format";
import { cleanSnippet } from "../lib/snippet";
import { ageLabel, daysSince, groupByPerson, wroteLast, type SentPerson } from "../lib/sentPeople";

/** One thread under a person: its subject, whether they have answered, and a Nudge when they have not. */
function ThreadLine({ t, me }: { t: ThreadSummary; me: string }) {
  const nav = useNavigate();
  const waiting = wroteLast(t, me);
  return (
    <div className="group flex items-center gap-3 rounded-md py-1.5 pl-[52px] pr-2 hover:bg-muted">
      <Link to={`/t/${t.id}`} className="flex min-w-0 flex-1 items-center gap-2 outline-none">
        <span className="truncate text-[13px] font-medium">{t.subject || "(no subject)"}</span>
        {t.message_count > 1 && <span className="shrink-0 text-xs text-tertiary tnum">{t.message_count}</span>}
        {t.has_attachments && <Paperclip size={12} className="shrink-0 text-muted-foreground" />}
      </Link>
      <Badge variant="outline" className={cn("h-5 shrink-0 px-2 text-[11px] font-normal", waiting ? "text-foreground" : "border-transparent bg-foreground text-background")}>
        {waiting ? `Waiting · ${ageLabel(daysSince(t.last_message_at))}` : "Replied"}
      </Badge>
      {waiting && (
        <Button variant="outline" size="xs" className="shrink-0" onClick={() => nav(`/t/${t.id}?reply=1`)}>
          <Reply /> Nudge
        </Button>
      )}
      <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tnum">{fmtTime(t.last_message_at)}</span>
    </div>
  );
}

function PersonCard({ g, open, onToggle, me }: { g: SentPerson; open: boolean; onToggle: () => void; me: (accountId: string) => string }) {
  const latest = g.threads[0];
  const mine = wroteLast(latest, me(latest.account_id));
  const preview = cleanSnippet(latest.snippet);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring">
        <Avatar email={g.person.email} name={g.person.name} src={g.person.avatar_url} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold">{g.person.name || g.person.email}</span>
            {g.waiting > 0 && <span className="shrink-0 rounded-full border border-border px-2 text-[11px] text-foreground">{g.waiting} waiting</span>}
          </span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {mine ? "You" : g.person.name?.split(" ")[0] || "They"}: {preview || latest.subject}
          </span>
        </span>
        <span className="shrink-0 text-right text-xs text-muted-foreground tnum">
          <span className="block">{g.threads.length} {g.threads.length === 1 ? "thread" : "threads"}</span>
          <span className="block">{fmtTime(latest.last_message_at)}</span>
        </span>
        <ChevronRight size={15} className={cn("shrink-0 text-tertiary transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="pb-2">
          {g.threads.map((t) => (
            <ThreadLine key={t.id} t={t} me={me(t.account_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Sent, by the people you wrote to: the latest thing said, how many threads are waiting on them, and every thread one click away. */
export default function Sent() {
  const { accounts, accountFor } = useAccount();
  const enabled = accounts.length > 0;
  const f = useListFilters();
  const q = useThreads("sent", { enabled, q: f.state.q, label: f.state.label, filters: f.state.filters });
  const myEmail = (id: string) => accountFor(id)?.email ?? "";
  const loaded = useMemo(() => q.data?.pages.flatMap((p) => p.threads) ?? [], [q.data]);
  const people = useMemo(() => groupByPerson(loaded, myEmail), [loaded, accountFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const [opened, setOpened] = useState<Set<string>>(new Set());
  if (!enabled) return <ConnectGmailCard />;
  const toggle = (key: string) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const count = people.length ? `${people.length}${q.hasNextPage ? "+" : ""} ${people.length === 1 && !q.hasNextPage ? "person" : "people"}. ` : "";
  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader className="px-2" title="Sent" subtitle={`${count}Things you've said.`.trim()} />
      <ListFilters f={f} />
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <SkeletonRows />}
      {!q.isLoading && !q.error && people.length === 0 && (
        <EmptyState icon={<BrandIcon name="sent" />} title={f.active ? "No matches." : "Nothing sent yet."} body={f.active ? "Try fewer filters, or a different word." : "Press c to write something."} />
      )}
      <div>
        {people.map((g) => (
          // With a search or filter on, the matching threads are the point, so people start open (and a click folds one).
          <PersonCard key={g.key} g={g} open={opened.has(g.key) !== f.active} onToggle={() => toggle(g.key)} me={myEmail} />
        ))}
      </div>
      <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
    </div>
  );
}
