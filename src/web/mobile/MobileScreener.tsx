import { BrandIcon } from "../components/BrandIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Paperclip, X } from "lucide-react";
import type { DecisionScope, ScreenStatus } from "@shared/types";
import { cn } from "@/lib/utils";
import { useScreener, useScreenerDecide, type ScreenerSender } from "../api";
import { useAccount } from "../context/AccountContext";
import { fmtTime } from "../lib/format";
import { cleanSnippet } from "../lib/snippet";
import { Avatar, AccountGlyph } from "../components/Avatar";
import { ErrorState } from "../components/EmptyState";
import { AutoLetInNotice } from "../components/AutoLetInNotice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Screen } from "./Screen";
import { MobileConnectCard } from "./MobileImbox";
import { MobileEmpty } from "./MobileList";
import { useSwipe } from "./useSwipe";

type Target = "imbox" | "feed" | "paper_trail";
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

function groupOf(x: ScreenerSender): Group {
  if (x.ai?.bucket === "screened_out") return "suggested_out";
  if (x.suggestion === "feed") return "newsletters";
  if (x.suggestion === "paper_trail") return "receipts";
  return "people";
}

/** A group decision waiting for a yes: who it covers and what would happen to them. */
interface BulkPlan {
  group: Group;
  text: string;
  confirm: string;
  decision: ScreenStatus;
  senders: ScreenerSender[];
}

const SECTIONS: { key: Group; title: string; actions: { label: string; decision: ScreenStatus; text: string; confirm: string; ghost?: boolean }[] }[] = [
  { key: "people", title: "People", actions: [{ label: "Let all in", decision: "imbox", text: "Let {n} into the Imbox?", confirm: "Let them in" }] },
  {
    key: "newsletters",
    title: "Newsletters",
    actions: [
      { label: "Screen all out", decision: "screened_out", text: "Screen out {n}? You won't hear from them again.", confirm: "Screen them out", ghost: true },
      { label: "Let all in", decision: "feed", text: "Let {n} into Reading?", confirm: "Let them in" },
    ],
  },
  { key: "receipts", title: "Receipts", actions: [{ label: "Let all in", decision: "paper_trail", text: "Let {n} into Receipts?", confirm: "Let them in" }] },
  { key: "suggested_out", title: "Suggested Out", actions: [{ label: "Screen all out", decision: "screened_out", text: "Screen out {n}? You won't hear from them again.", confirm: "Screen them out" }] },
];

function Row({ s, open, onToggle, target, onTarget, onDecide, leaving }: { s: ScreenerSender; open: boolean; onToggle: () => void; target: Target; onTarget: (t: Target) => void; onDecide: (d: ScreenStatus, scope?: DecisionScope) => void; leaving: "yes" | "no" | null }) {
  const { multi, glyphFor, accountFor } = useAccount();
  const nav = useNavigate();
  const swipe = useSwipe({ threshold: 120, onRight: () => onDecide(target), onLeft: () => onDecide("screened_out") });
  const why = reason(s);
  const acct = accountFor(s.contact.account_id);
  const chosen = TARGETS.find((t) => t.value === target);
  const count = s.contact.message_count;
  const first = s.threads[0];
  const domain = s.contact.email.split("@")[1];
  return (
    <div className={cn("relative overflow-hidden transition-all duration-200", leaving && "max-h-0 opacity-0")}>
      {swipe.dx > 0 && (
        <div className="absolute inset-0 flex items-center bg-muted pl-5 text-[14px] font-medium">
          <span className={cn("flex items-center gap-2 transition-transform [&>svg]:size-5", swipe.past && "scale-110")}>
            <Check /> Let in · {chosen?.label}
          </span>
        </div>
      )}
      {swipe.dx < 0 && (
        <div className="absolute inset-0 flex items-center justify-end bg-muted pr-5 text-[14px] font-medium">
          <span className={cn("flex items-center gap-2 transition-transform [&>svg]:size-5", swipe.past && "scale-110")}>
            Screen out <X />
          </span>
        </div>
      )}
      <div
        {...swipe.handlers}
        className="relative touch-pan-y select-none bg-background [-webkit-touch-callout:none]"
        style={{ transform: `translateX(${swipe.dx}px)`, transition: swipe.dragging ? "none" : "transform 220ms cubic-bezier(.2,.8,.2,1)" }}
      >
        <button type="button" aria-expanded={open} onClick={() => !swipe.consumeClick() && onToggle()} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-muted/50">
          <Avatar email={s.contact.email} name={s.contact.name} src={s.contact.avatar_url} size={40} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15.5px] font-semibold leading-5">{s.contact.name || s.contact.email.split("@")[0]}</span>
              {multi && acct && <AccountGlyph glyph={glyphFor(acct.id)} label={acct.email} />}
              <span className="ml-auto shrink-0 text-[12px] text-muted-foreground tnum">{first ? fmtTime(first.last_message_at) : ""}</span>
            </span>
            <span className="block truncate text-[14px] leading-5 text-foreground/85">{first?.subject || "(no subject)"}</span>
            <span className={cn("flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5", why.out ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
              <span className="shrink-0 [&>svg]:size-3.5">{why.icon}</span>
              <span className="truncate">
                {why.text} · {domain}
              </span>
            </span>
          </span>
        </button>
        {open && (
          <div className="space-y-3 px-4 pb-4">
            <div className="text-[12.5px] text-muted-foreground tnum">
              {s.contact.email} · {count} {count === 1 ? "message" : "messages"} · since {fmtTime(s.contact.first_seen_at)}
            </div>
            <ul className="space-y-3">
              {s.threads.slice(0, 3).map((t) => (
                <li key={t.id} className="min-w-0" onClick={() => nav(`/t/${t.id}?peek=1`)}>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium">{t.subject || "(no subject)"}</span>
                    {t.has_attachments && <Paperclip className="size-3.5 shrink-0 self-center text-muted-foreground" />}
                  </div>
                  {cleanSnippet(t.snippet) && <div className="line-clamp-2 text-[14px] text-muted-foreground">{cleanSnippet(t.snippet)}</div>}
                </li>
              ))}
              {(s.thread_count ?? s.threads.length) > 3 && <li className="text-[12.5px] text-muted-foreground">+{(s.thread_count ?? s.threads.length) - 3} more</li>}
            </ul>
            <ToggleGroup type="single" variant="outline" spacing={0} value={target} onValueChange={(v) => v && onTarget(v as Target)} className="grid w-full grid-cols-3" aria-label="Deliver to">
              {TARGETS.map((t) => (
                <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label} className="h-10 w-full text-[13px] text-muted-foreground aria-checked:bg-muted aria-checked:font-medium aria-checked:text-foreground">
                  {t.icon} {t.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="ghost" className="h-11 px-4 text-[15px] text-muted-foreground" onClick={() => onDecide("screened_out")}>
                <X /> Screen out
              </Button>
              <Button className="h-11 text-[15px]" onClick={() => onDecide(target)}>
                <Check /> Let in to {chosen?.label}
              </Button>
            </div>
            {multi && acct && (
              <button type="button" className="h-9 w-full rounded-md text-[13px] text-muted-foreground active:bg-muted active:text-foreground" onClick={() => onDecide(target, "account")}>
                Only for {acct.email.split("@")[0]}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MobileScreener() {
  const { accounts, user } = useAccount();
  const s = useScreener(accounts.length > 0);
  const decide = useScreenerDecide();
  const senders = useMemo(() => s.data?.senders ?? [], [s.data]);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [leaving, setLeaving] = useState<Record<string, "yes" | "no">>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const targetFor = (x: ScreenerSender): Target => targets[x.contact.id] ?? (x.suggestion === "imbox" ? user?.settings?.defaultScreenTarget ?? "imbox" : x.suggestion);
  const act = (x: ScreenerSender, d: ScreenStatus, scope: DecisionScope = "all") => {
    if (leaving[x.contact.id]) return;
    // The card fades first, then the decision fires and (via onMutate) drops it from the cache — firing
    // both at once would remove the card from the list before the fade ever gets a frame to animate from.
    setLeaving((l) => ({ ...l, [x.contact.id]: d === "screened_out" ? "no" : "yes" }));
    timers.current.push(
      window.setTimeout(() => {
        decide.mutate({ contact_id: x.contact.id, decision: d, scope, threads: x.threads, thread_count: x.thread_count });
        setLeaving((l) => {
          const n = { ...l };
          delete n[x.contact.id];
          return n;
        });
      }, 200),
    );
  };
  const waiting = senders.length;

  // The Screener already guesses each sender's kind; the page follows that guess. Nothing happens to a group until the bar asks and gets a yes.
  const groups = useMemo(() => {
    const by: Record<Group, ScreenerSender[]> = { people: [], newsletters: [], receipts: [], suggested_out: [] };
    for (const x of senders) by[groupOf(x)].push(x);
    return by;
  }, [senders]);
  // One kind at a time: tabs for the kinds that have someone waiting, and All when there is more than one; a tab that empties hands over.
  const [tab, setTab] = useState<Group | "all" | null>(null);
  const filled = SECTIONS.filter((sec) => groups[sec.key].length > 0);
  const tabIds: (Group | "all")[] = [...filled.map((f) => f.key), ...(filled.length > 1 ? (["all"] as const) : [])];
  const activeTab: Group | "all" = tab && tabIds.includes(tab) ? tab : tabIds[0] ?? "all";
  const [plan, setPlan] = useState<BulkPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const noun = (n: number) => `${n} ${n === 1 ? "sender" : "senders"}`;
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
    toast(done === plan.senders.length ? `${noun(done)} sorted` : `Sorted ${done} of ${plan.senders.length}. Something went wrong, so the rest are still here.`);
  };
  return (
    <Screen
      title="Screener"
      largeTitle
      subtitle={accounts.length ? (waiting ? `${waiting} ${waiting === 1 ? "sender" : "senders"} waiting. Tap a sender for details. Swipe right to let in, left to screen out.` : "First-time senders wait here.") : undefined}
    >
      {accounts.length === 0 ? (
        <MobileConnectCard />
      ) : (
        <>
          <AutoLetInNotice compact className="mx-4 mb-3" />
          {s.error && <ErrorState error={s.error} onRetry={() => s.refetch()} />}
          {s.isLoading && (
            <div className="space-y-3 px-4" aria-busy>
              {[0, 1].map((i) => (
                <div key={i} className="rounded-xl bg-muted/50 p-4 space-y-3">
                  <div className="flex gap-3">
                    <Skeleton className="size-12 rounded-[4px]" />
                    <div className="flex-1 space-y-2 pt-1">
                      <Skeleton className="h-4 w-[45%]" />
                      <Skeleton className="h-3.5 w-[65%]" />
                    </div>
                  </div>
                  <Skeleton className="h-12" />
                  <Skeleton className="h-10" />
                </div>
              ))}
            </div>
          )}
          {!s.isLoading && waiting === 0 && !s.error && <MobileEmpty icon={<BrandIcon name="not-now" />} title="Nobody at the door." body="Every new sender has been dealt with." />}
          {tabIds.length > 1 && (
            <div role="tablist" aria-label="Kinds of sender" className="mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabIds.map((id) => {
                const label = id === "all" ? "All" : id === "suggested_out" ? "Suggested Out" : SECTIONS.find((x) => x.key === id)!.title;
                const n = id === "all" ? waiting : groups[id].length;
                const on = id === activeTab;
                return (
                  <button
                    key={id}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    onClick={() => setTab(id)}
                    className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[14px] transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground active:bg-muted")}
                  >
                    {label}
                    <span className={cn("tnum text-[12px]", on ? "text-background/70" : "text-tertiary")}>{n}</span>
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
              <section key={sec.key} aria-label={sec.title} className="mb-5">
                <header className="mx-4 mb-2.5 flex items-center gap-2">
                  {activeTab === "all" && <h2 className="text-[15px] font-semibold">{sec.title}</h2>}
                  <span className="text-[13px] text-muted-foreground tnum">{activeTab === "all" ? list.length : `${list.length} ${list.length === 1 ? "sender" : "senders"}`}</span>
                  <span className="flex-1" />
                  {sec.actions.map((a) => (
                    <Button
                      key={a.label}
                      variant={a.ghost ? "ghost" : "outline"}
                      className={cn("h-9 px-3 text-[13px]", a.ghost && "text-muted-foreground")}
                      disabled={planBusy}
                      onClick={() => setPlan({ group: sec.key, text: a.text.replace("{n}", noun(list.length)), confirm: a.confirm, decision: a.decision, senders: list })}
                    >
                      {a.label}
                    </Button>
                  ))}
                </header>
                {plan?.group === sec.key && (
                  <div role="alertdialog" className="mx-4 mb-3 space-y-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[14px]">
                    <p>{plan.text}</p>
                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {plan.senders.slice(0, 3).map((x) => x.contact.name || x.contact.email.split("@")[0]).join(", ")}
                      {plan.senders.length > 3 ? ` and ${plan.senders.length - 3} more` : ""}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="h-10" onClick={() => setPlan(null)} disabled={planBusy}>
                        Cancel
                      </Button>
                      <Button className="h-10" onClick={runPlan} disabled={planBusy}>
                        {planBusy ? "Sorting…" : plan.confirm}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="divide-y divide-border/60 border-y border-border/60">
                  {list.map((x) => (
                    <Row
                      key={x.contact.id}
                      s={x}
                      open={openId === x.contact.id}
                      onToggle={() => setOpenId((o) => (o === x.contact.id ? null : x.contact.id))}
                      target={targetFor(x)}
                      leaving={leaving[x.contact.id] ?? null}
                      onTarget={(t) => setTargets((m) => ({ ...m, [x.contact.id]: t }))}
                      onDecide={(d, scope) => act(x, d, scope)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </Screen>
  );
}
