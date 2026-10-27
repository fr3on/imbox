import { BrandIcon } from "../components/BrandIcons";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Paperclip, Reply, } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { cn } from "@/lib/utils";
import { useThreads } from "../api";
import { useAccount } from "../context/AccountContext";
import { Avatar } from "../components/Avatar";
import { ErrorState } from "../components/EmptyState";
import { LoadMore } from "../components/ThreadList";
import { useListFilters } from "../components/ListFilters";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtTime } from "../lib/format";
import { cleanSnippet } from "../lib/snippet";
import { ageLabel, daysSince, groupByPerson, wroteLast, type SentPerson } from "../lib/sentPeople";
import { Screen } from "./Screen";
import { MobileConnectCard } from "./MobileImbox";
import { MobileEmpty } from "./MobileList";
import { MobileListFilters } from "./MobileListFilters";

function ThreadLine({ t, me }: { t: ThreadSummary; me: string }) {
  const nav = useNavigate();
  const waiting = wroteLast(t, me);
  return (
    <div className="flex items-center gap-2 py-2 pl-[60px] pr-4 active:bg-muted/60" onClick={() => nav(`/t/${t.id}`)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-medium">{t.subject || "(no subject)"}</span>
          {t.message_count > 1 && <span className="shrink-0 text-xs text-tertiary tnum">{t.message_count}</span>}
          {t.has_attachments && <Paperclip size={12} className="shrink-0 text-muted-foreground" />}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12.5px]">
          <span className={cn("rounded-full px-2 py-px", waiting ? "border border-border text-foreground" : "bg-foreground text-background")}>{waiting ? `Waiting · ${ageLabel(daysSince(t.last_message_at))}` : "Replied"}</span>
          <span className="text-muted-foreground tnum">{fmtTime(t.last_message_at)}</span>
        </div>
      </div>
      {waiting && (
        <button type="button" className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] active:bg-muted" onClick={(e) => { e.stopPropagation(); nav(`/t/${t.id}?reply=1`); }}>
          <Reply size={13} /> Nudge
        </button>
      )}
    </div>
  );
}

function PersonCard({ g, open, onToggle, me }: { g: SentPerson; open: boolean; onToggle: () => void; me: (accountId: string) => string }) {
  const latest = g.threads[0];
  const mine = wroteLast(latest, me(latest.account_id));
  const preview = cleanSnippet(latest.snippet);
  return (
    <div className="border-b border-border/60">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/60">
        <Avatar email={g.person.email} name={g.person.name} src={g.person.avatar_url} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[15.5px] font-semibold">{g.person.name || g.person.email}</span>
            {g.waiting > 0 && <span className="shrink-0 rounded-full border border-border px-2 text-[11.5px]">{g.waiting} waiting</span>}
          </span>
          <span className="block truncate text-[14px] text-muted-foreground">
            {mine ? "You" : g.person.name?.split(" ")[0] || "They"}: {preview || latest.subject}
          </span>
          <span className="block text-[12px] text-muted-foreground tnum">
            {g.threads.length} {g.threads.length === 1 ? "thread" : "threads"} · {fmtTime(latest.last_message_at)}
          </span>
        </span>
        <ChevronRight size={16} className={cn("shrink-0 text-tertiary transition-transform", open && "rotate-90")} />
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

/** Sent, by the people you wrote to. Tap a person to see their threads and which of them are waiting on an answer. */
export default function MobileSent() {
  const { accounts, accountFor } = useAccount();
  const enabled = accounts.length > 0;
  const f = useListFilters();
  const q = useThreads("sent", { enabled, q: f.state.q, label: f.state.label, filters: f.state.filters });
  const myEmail = (id: string) => accountFor(id)?.email ?? "";
  const loaded = useMemo(() => q.data?.pages.flatMap((p) => p.threads) ?? [], [q.data]);
  const people = useMemo(() => groupByPerson(loaded, myEmail), [loaded, accountFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <Screen title="Sent" largeTitle back tabs>
      {!enabled ? (
        <MobileConnectCard />
      ) : (
        <>
          <MobileListFilters f={f} />
          {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {q.isLoading && (
            <div className="space-y-4 px-4" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-[40%]" />
                    <Skeleton className="h-3 w-[70%]" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!q.isLoading && !q.error && people.length === 0 && <MobileEmpty icon={<BrandIcon name="sent" />} title={f.active ? "No matches." : "Nothing sent yet."} body={f.active ? "Try fewer filters, or a different word." : undefined} />}
          {people.map((g) => (
            <PersonCard key={g.key} g={g} open={opened.has(g.key) !== f.active} onToggle={() => toggle(g.key)} me={myEmail} />
          ))}
          <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
        </>
      )}
    </Screen>
  );
}
