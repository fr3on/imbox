import { BrandIcon } from "../components/BrandIcons";
import { cleanSnippet } from "../lib/snippet";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Paperclip, X } from "lucide-react";
import type { DecisionScope, ScreenStatus } from "@shared/types";
import { cn } from "@/lib/utils";
import { useScreenedOut, useScreener, useScreenerDecide, type ScreenerSender } from "../api";
import { useAccount } from "../context/AccountContext";
import { useKeys } from "../lib/keys";
import { overlayOpen, useFocusRegion } from "../lib/focusStore";
import { scrollPageBy } from "../lib/cardKeys";
import { fmtTime } from "../lib/format";
import { ConnectGmailCard } from "./Imbox";
import { Avatar, AccountGlyph } from "../components/Avatar";
import { EmptyState, ErrorState, PageHeader } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "../components/Toast";
import { AutoLetInNotice } from "../components/AutoLetInNotice";

type Target = "imbox" | "feed" | "paper_trail";

const OUT_MS = 120;

const TARGETS: { value: Target; label: string; icon: React.ReactNode }[] = [
  { value: "imbox", label: "Imbox", icon: <BrandIcon name="imbox" /> },
  { value: "feed", label: "Reading", icon: <BrandIcon name="feed" /> },
  { value: "paper_trail", label: "Receipts", icon: <BrandIcon name="paper-trail" /> },
];

function reason(s: ScreenerSender): { text: string; icon: React.ReactNode; ai?: boolean; out?: boolean } {
  if (s.ai?.reason) {
    const out = s.ai.bucket === "screened_out";
    return { text: out ? `Suggest screening out: ${s.ai.reason}` : s.ai.reason, icon: <BrandIcon name="assistant" />, ai: true, out };
  }
  if (s.suggestion === "feed") {
    const unsub = s.threads.some((t) => /unsubscribe/i.test(t.snippet));
    return { text: unsub ? "Has an unsubscribe link" : "Looks like a newsletter", icon: <BrandIcon name="feed" /> };
  }
  if (s.suggestion === "paper_trail") return { text: "Looks like a receipt", icon: <BrandIcon name="paper-trail" /> };
  return { text: "Probably a person", icon: <BrandIcon name="sender" /> };
}


type Group = "people" | "newsletters" | "receipts" | "suggested_out";

/** A group decision waiting for a yes: who it covers and what would happen to them. */
interface BulkPlan {
  group: Group;
  text: string;
  confirm: string;
  decision: ScreenStatus;
  senders: ScreenerSender[];
}

const SECTIONS: { key: Group; title: string; icon: React.ReactNode; actions: { label: string; decision: ScreenStatus; text: string; confirm: string; ghost?: boolean }[] }[] = [
  { key: "people", title: "People", icon: <BrandIcon name="sender" />, actions: [{ label: "Let all in to Imbox", decision: "imbox", text: "Let {n} into the Imbox?", confirm: "Let them in" }] },
  {
    key: "newsletters",
    title: "Newsletters",
    icon: <BrandIcon name="feed" />,
    actions: [
      { label: "Screen all out", decision: "screened_out", text: "Screen out {n}? You won't hear from them again.", confirm: "Screen them out", ghost: true },
      { label: "Let all in to Reading", decision: "feed", text: "Let {n} into Reading?", confirm: "Let them in" },
    ],
  },
  { key: "receipts", title: "Receipts", icon: <BrandIcon name="paper-trail" />, actions: [{ label: "Let all in to Receipts", decision: "paper_trail", text: "Let {n} into Receipts?", confirm: "Let them in" }] },
  { key: "suggested_out", title: "Suggested Out", icon: <BrandIcon name="assistant" />, actions: [{ label: "Screen all out", decision: "screened_out", text: "Screen out {n}? You won't hear from them again.", confirm: "Screen them out" }] },
];

function groupOf(x: ScreenerSender): Group {
  if (x.ai?.bucket === "screened_out") return "suggested_out";
  if (x.suggestion === "feed") return "newsletters";
  if (x.suggestion === "paper_trail") return "receipts";
  return "people";
}

function SenderRow({
  s,
  index,
  focused,
  open,
  leaving,
  target,
  onTarget,
  onDecide,
  onFocus,
  onToggle,
}: {
  s: ScreenerSender;
  index: number;
  focused: boolean;
  open: boolean;
  leaving: "yes" | "no" | null;
  target: Target;
  onTarget: (t: Target) => void;
  onDecide: (d: ScreenStatus, scope?: DecisionScope) => void;
  onFocus: () => void;
  onToggle: () => void;
}) {
  const { multi, glyphFor, accountFor } = useAccount();
  const why = reason(s);
  const acct = accountFor(s.contact.account_id);
  const chosen = TARGETS.find((t) => t.value === target);
  const first = s.threads[0];
  const domain = s.contact.email.split("@")[1];
  return (
    <div
      data-screener-index={index}
      onMouseEnter={onFocus}
      className={cn("scroll-mt-20 border-b border-border/60 transition-opacity duration-100 last:border-0", leaving && "opacity-0", focused && "bg-muted/40")}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 basis-64 items-center gap-3 text-left">
          <Avatar email={s.contact.email} name={s.contact.name} src={s.contact.avatar_url} size={36} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2 text-sm">
              <b className="shrink-0 font-semibold">{s.contact.name || s.contact.email.split("@")[0]}</b>
              <span className="truncate text-muted-foreground">{first?.subject || "(no subject)"}</span>
              {multi && acct && <AccountGlyph glyph={glyphFor(acct.id)} label={acct.email} />}
            </span>
            <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", why.out ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
              <span className="shrink-0 [&>svg]:size-3">{why.icon}</span>
              <span className="truncate">
                {why.text} · {domain} · {first ? fmtTime(first.last_message_at) : fmtTime(s.contact.first_seen_at)}
              </span>
            </span>
          </span>
        </button>
        <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={target} onValueChange={(v) => v && onTarget(v as Target)} className="shrink-0" aria-label="Deliver to">
          {TARGETS.map((t, i) => (
            <Tooltip key={t.value}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={t.value} aria-label={t.label} className="h-8 px-2.5 text-muted-foreground aria-checked:bg-background aria-checked:font-medium aria-checked:text-foreground aria-checked:shadow-xs">
                  {t.icon} <span className="max-[520px]:hidden">{t.label}</span>
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                Deliver to {t.label} <Kbd className="ml-1">{i + 1}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onDecide("screened_out")}>
                <X /> Out
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Never see them again <Kbd className="ml-1">n</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={() => onDecide(target)}>
                <Check /> Let in
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Deliver to {chosen?.label} <Kbd className="ml-1">y</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {open && (
        <div className="space-y-2.5 pb-4 pl-[56px] pr-2">
          <div className="text-xs text-muted-foreground tnum">
            {s.contact.email} · {s.contact.message_count} {s.contact.message_count === 1 ? "message" : "messages"} · since {fmtTime(s.contact.first_seen_at)}
          </div>
          {s.threads.slice(0, 3).map((t) => (
            <div key={t.id} className="min-w-0">
              <Link to={`/t/${t.id}?peek=1`} className="group flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-medium group-hover:underline underline-offset-2">{t.subject || "(no subject)"}</span>
                {t.has_attachments && <Paperclip className="size-3 shrink-0 self-center text-muted-foreground" />}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tnum">{fmtTime(t.last_message_at)}</span>
              </Link>
              {cleanSnippet(t.snippet) && <div className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{cleanSnippet(t.snippet)}</div>}
            </div>
          ))}
          {(s.thread_count ?? s.threads.length) > 3 && <div className="text-xs text-muted-foreground">+{(s.thread_count ?? s.threads.length) - 3} more</div>}
          {multi && acct && (
            <button type="button" className="rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => onDecide(target, "account")}>
              Only for {acct.email.split("@")[0]}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Screener() {
  const { accounts, user } = useAccount();
  const s = useScreener(accounts.length > 0);
  const decide = useScreenerDecide();
  const raw = useMemo(() => s.data?.senders ?? [], [s.data]);
  const [cursor, setCursor] = useState(0);
  const [tab, setTab] = useState<Group | "all" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [leaving, setLeaving] = useState<Record<string, "yes" | "no">>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The Screener already guesses each sender's kind; the page follows that guess. Each group is one section, in this order.
  const groups = useMemo(() => {
    const by: Record<Group, ScreenerSender[]> = { people: [], newsletters: [], receipts: [], suggested_out: [] };
    for (const x of raw) by[groupOf(x)].push(x);
    return by;
  }, [raw]);
  const senders = useMemo(() => [...groups.people, ...groups.newsletters, ...groups.receipts, ...groups.suggested_out], [groups]);
  // One kind at a time. The tabs are the kinds that have someone waiting, and All when there is more than one; a tab that empties
  // hands over to the next.
  const filled = SECTIONS.filter((sec) => groups[sec.key].length > 0);
  const tabIds: (Group | "all")[] = [...filled.map((f) => f.key), ...(filled.length > 1 ? (["all"] as const) : [])];
  const activeTab: Group | "all" = tab && tabIds.includes(tab) ? tab : tabIds[0] ?? "all";
  const visible = useMemo(() => (activeTab === "all" ? senders : groups[activeTab]), [activeTab, senders, groups]);
  useEffect(() => {
    if (cursor >= visible.length) setCursor(Math.max(0, visible.length - 1));
  }, [visible.length, cursor]);

  const targetFor = (x: ScreenerSender): Target => targets[x.contact.id] ?? (x.suggestion === "imbox" ? user?.settings?.defaultScreenTarget ?? "imbox" : x.suggestion);

  const act = (x: ScreenerSender, d: ScreenStatus, scope: DecisionScope = "all") => {
    if (leaving[x.contact.id]) return;
    // The row fades first, then the decision fires and (via onMutate) drops it from the cache, so the fade gets a frame to animate.
    setLeaving((l) => ({ ...l, [x.contact.id]: d === "screened_out" ? "no" : "yes" }));
    timers.current.push(
      window.setTimeout(() => {
        decide.mutate({ contact_id: x.contact.id, decision: d, scope, threads: x.threads, thread_count: x.thread_count });
        setLeaving((l) => {
          const n = { ...l };
          delete n[x.contact.id];
          return n;
        });
      }, OUT_MS),
    );
  };

  // Whole groups at once, after a yes. Nothing happens until the bar below the section header asks and gets one.
  const { toast } = useToast();
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const runPlan = async () => {
    if (!plan) return;
    setPlanBusy(true);
    let done = 0;
    for (const x of plan.senders) {
      try {
        await decide.mutateAsync({ contact_id: x.contact.id, decision: plan.decision, scope: "all", threads: x.threads, thread_count: x.thread_count });
        done++;
      } catch {
        break;
      }
    }
    setPlanBusy(false);
    setPlan(null);
    if (done === plan.senders.length) toast(`${noun(done, "sender", "senders")} sorted`);
    else toast(`Sorted ${done} of ${plan.senders.length}. Something went wrong, so the rest are still here.`, { kind: "error" });
  };

  const current = visible[cursor];
  const region = useFocusRegion();
  const move = (delta: number) => {
    if (overlayOpen()) return;
    setCursor((c) => {
      const next = Math.min(Math.max(c + delta, 0), visible.length - 1);
      // Nowhere left to go: let the arrows scroll the page instead of doing nothing.
      if (next === c) scrollPageBy(delta * 0.25);
      else requestAnimationFrame(() => document.querySelector(`[data-screener-index="${next}"]`)?.scrollIntoView({ block: "nearest" }));
      return next;
    });
  };
  const stepTab = (delta: number) => {
    if (overlayOpen() || tabIds.length < 2) return;
    setTab(tabIds[(tabIds.indexOf(activeTab) + delta + tabIds.length) % tabIds.length]);
    setCursor(0);
  };
  useKeys(
    {
      ArrowLeft: () => stepTab(-1),
      ArrowRight: () => stepTab(1),
      j: () => move(1),
      k: () => move(-1),
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      y: () => current && act(current, targetFor(current)),
      n: () => current && act(current, "screened_out"),
      "1": () => current && setTargets((t) => ({ ...t, [current.contact.id]: "imbox" })),
      "2": () => current && setTargets((t) => ({ ...t, [current.contact.id]: "feed" })),
      "3": () => current && setTargets((t) => ({ ...t, [current.contact.id]: "paper_trail" })),
    },
    senders.length > 0 && region === "content",
  );

  if (accounts.length === 0) return <ConnectGmailCard />;
  const waiting = senders.length;
  const more = Math.max(0, (s.data?.total ?? 0) - raw.length);


  return (
    <div className="max-w-5xl mx-auto w-full">
      <PageHeader
        className="px-2"
        title="The Screener"
        subtitle={waiting ? `${waiting} ${waiting === 1 ? "sender" : "senders"} waiting${more ? `, and ${more} more behind them` : ""}. Say yes and pick where their mail goes, or say no and never hear from them again.` : "First-time senders wait here. Nobody waiting right now."}
      />
      <AutoLetInNotice className="mx-2 mb-3" />
      {s.error && <ErrorState error={s.error} onRetry={() => s.refetch()} />}
      {s.isLoading && (
        <div className="space-y-3 px-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-[40%]" />
                <Skeleton className="h-3 w-[60%]" />
              </div>
            </div>
          ))}
        </div>
      )}
      {!s.isLoading && waiting === 0 && !s.error && (
        <EmptyState
          icon={<BrandIcon name="not-now" />}
          title="Nobody at the door."
          body="Every new sender has been dealt with."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">Back to the Imbox</Link>
            </Button>
          }
        />
      )}
      {waiting > 0 && (
        <>
          {tabIds.length > 1 && (
            <div role="tablist" aria-label="Kinds of sender" className="mb-5 grid grid-cols-2 gap-2.5 px-2 sm:grid-cols-4">
              {filled.map((sec) => {
                const on = sec.key === activeTab;
                return (
                  <button
                    key={sec.key}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    onClick={() => {
                      setTab(sec.key);
                      setCursor(0);
                    }}
                    className={cn("grid gap-0.5 rounded-xl border p-3.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring", on ? "border-2 border-foreground p-[13px]" : "border-border hover:bg-accent")}
                  >
                    <span className="text-muted-foreground [&>svg]:size-5">{sec.icon}</span>
                    <span className={cn("mt-1 w-fit text-[26px] font-semibold leading-none tracking-[-0.03em] tnum", sec.key === "suggested_out" && "rounded-md bg-amber-500/15 px-1.5 text-amber-800 dark:text-amber-300")}>{groups[sec.key].length}</span>
                    <span className="mt-1 text-sm font-medium">{sec.title}</span>
                  </button>
                );
              })}
            </div>
          )}
          {SECTIONS.map((sec) => {
            const list = groups[sec.key];
            if (list.length === 0) return null;
            if (activeTab !== "all" && activeTab !== sec.key) return null;
            return (
              <section key={sec.key} aria-label={sec.title} className="mb-7">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-2 pb-2">
                  {activeTab === "all" && <h2 className="text-sm font-semibold">{sec.title}</h2>}
                  <span className="text-xs text-muted-foreground tnum">{activeTab === "all" ? noun(list.length, "sender", "senders") : `Showing ${noun(list.length, "sender", "senders")}`}</span>
                  {activeTab !== "all" && tabIds.includes("all") && (
                    <button type="button" onClick={() => { setTab("all"); setCursor(0); }} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                      Show all {waiting}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    {sec.actions.map((a) => (
                      <Button
                        key={a.label}
                        variant={a.ghost ? "ghost" : "outline"}
                        size="sm"
                        className={a.ghost ? "text-muted-foreground" : undefined}
                        disabled={planBusy}
                        onClick={() => setPlan({ group: sec.key, text: a.text.replace("{n}", noun(list.length, "sender", "senders")), confirm: a.confirm, decision: a.decision, senders: list })}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </header>
                {plan?.group === sec.key && (
                  <div role="alertdialog" className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px]">
                    <span>
                      {plan.text}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {plan.senders.slice(0, 3).map((x) => x.contact.name || x.contact.email.split("@")[0]).join(", ")}
                        {plan.senders.length > 3 ? ` and ${plan.senders.length - 3} more` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => setPlan(null)} disabled={planBusy}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={runPlan} disabled={planBusy}>
                        {planBusy ? "Sorting…" : plan.confirm}
                      </Button>
                    </span>
                  </div>
                )}
                {list.map((x) => {
                  const i = visible.indexOf(x);
                  return (
                    <SenderRow
                      key={x.contact.id}
                      s={x}
                      index={i}
                      focused={i === cursor}
                      open={openId === x.contact.id}
                      leaving={leaving[x.contact.id] ?? null}
                      target={targetFor(x)}
                      onTarget={(t) => setTargets((m) => ({ ...m, [x.contact.id]: t }))}
                      onDecide={(d, scope) => act(x, d, scope)}
                      onFocus={() => setCursor(i)}
                      onToggle={() => {
                        setCursor(i);
                        setOpenId((o) => (o === x.contact.id ? null : x.contact.id));
                      }}
                    />
                  );
                })}
              </section>
            );
          })}
        </>
      )}
      <ScreenedOutStrip />
    </div>
  );
}

/** Under the list: where the senders you said no to went, with the way to look through them and let one back in. */
function ScreenedOutStrip() {
  const data = useScreenedOut().data;
  const out = data?.contacts ?? [];
  if (out.length === 0) return null;
  const n = data?.total ?? out.length;
  return (
    <aside aria-label="Screened out" className="mx-2 mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-[13px] text-muted-foreground">
      <span className="flex gap-1">
        {out.slice(0, 3).map((c) => (
          <span key={c.id}>
            <Avatar email={c.email} name={c.name} src={c.avatar_url} size={22} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1">
        {n} {n === 1 ? "sender" : "senders"} screened out. Look through them, or let one back in.
      </span>
      <Button variant="outline" size="sm" asChild>
        <Link to="/screened-out">
          <BrandIcon name="not-now" /> Review
        </Link>
      </Button>
    </aside>
  );
}
