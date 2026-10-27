import { BrandIcon } from "../components/BrandIcons";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, } from "lucide-react";
import { toast } from "sonner";
import type { DecisionScope, ScreenStatus } from "@shared/types";
import { cn } from "@/lib/utils";
import { useContact, useContactInsights, useUpdateContact } from "../api";
import { useAccount } from "../context/AccountContext";
import { useCompose } from "../context/ComposeContext";
import { Avatar, AccountDot, AccountGlyph } from "../components/Avatar";
import { ErrorState } from "../components/EmptyState";
import { LoadMore } from "../components/ThreadList";
import { ContactStory } from "../components/ContactStory";
import { ContactThreads } from "../components/ContactThreads";
import { STATUS_META } from "./Contacts";
import { fmtDate, fmtRelative } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Layers } from "lucide-react";

const OPTIONS: ScreenStatus[] = ["imbox", "feed", "paper_trail", "screened_out"];

const BLURB: Record<ScreenStatus, string> = {
  pending: "Still waiting at the door. Decide in the Screener, or pick a place here.",
  imbox: "Their mail lands in your Imbox, front and centre.",
  feed: "Newsletters and the like. Goes to Feed, to read when you feel like it.",
  paper_trail: "Receipts and notices. Files itself into Feed.",
  screened_out: "Their mail never reaches you. They won't know.",
};

export default function ContactDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const q = useContact(id);
  const update = useUpdateContact();
  const insights = useContactInsights(id);
  const { openCompose } = useCompose();
  const { multi, glyphFor, colorFor, accountFor } = useAccount();
  const c = q.data?.contact;
  const [scope, setScope] = useState<DecisionScope>("all");
  const [show, setShow] = useState<"all" | "you" | "them">("all");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<number | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (c && loadedFor.current !== c.id) {
      loadedFor.current = c.id;
      setName(c.name);
      setNotes(c.notes);
    }
  }, [c]);

  const autosave = (n: string) => {
    setNotes(n);
    setSaveState("saving");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!c) return;
      update.mutate(
        { id: c.id, notes: n },
        {
          onSuccess: () => {
            setSaveState("saved");
            window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
          },
          onError: () => setSaveState("idle"),
        },
      );
    }, 600);
  };

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!c) {
    return (
      <div className="max-w-5xl mx-auto w-full px-2">
        <Skeleton className="h-6 w-20 mb-6" />
        <div className="flex gap-4">
          <Skeleton className="size-10 rounded-[4px] shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      </div>
    );
  }

  const status = c.screen_status;
  const acc = accountFor(c.account_id);
  const threads = q.data?.threads ?? [];
  const unread = threads.filter((t) => !t.seen).length;
  const mailboxes = c.accounts.length;
  const canBundle = status === "imbox" || status === "paper_trail";
  const story = insights.data;
  const waitingYou = story?.waiting_on_you ?? [];
  const waitingThem = story?.waiting_on_them ?? [];
  const wanted = new Set((show === "you" ? waitingYou : show === "them" ? waitingThem : []).map((l) => l.thread_id));
  const shown = show === "all" ? threads : threads.filter((t) => wanted.has(t.id));
  const recent = (story?.months ?? []).slice(-12);
  const peak = Math.max(1, ...recent.map((x) => x.n));
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Button variant="ghost" size="sm" className="mb-3 text-muted-foreground" onClick={() => nav(-1)}>
        <ArrowLeft /> Back <Kbd className="ml-1">esc</Kbd>
      </Button>

      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
        <Avatar email={c.email} name={c.name} src={c.avatar_url} size={44} className="rounded-xl" />
        <div className="min-w-0 flex-1 basis-64">
          <input
            className="w-full bg-transparent text-lg font-semibold leading-6 tracking-[-0.01em] outline-none placeholder:text-tertiary"
            value={name}
            placeholder={c.email.split("@")[0]}
            aria-label="Name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== c.name && update.mutate({ id: c.id, name: name.trim() })}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            <a href={`mailto:${c.email}`} className="hover:text-foreground">{c.email}</a>
            {unread > 0 && <span>· {unread} unread</span>}
            {mailboxes === 1 && acc && <span>· in {acc.email}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-foreground/80 [&>svg]:size-3.5 [&>svg]:text-muted-foreground">
              {STATUS_META[status].icon}
              {status === "pending" ? "Waiting in the Screener" : c.mixed ? "Mail goes to different places" : `Goes to ${STATUS_META[status].label}`}
            </span>
            {c.bundled && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-foreground/80">
                <Layers size={13} className="text-muted-foreground" /> Bundled
              </span>
            )}
            {mailboxes > 1 && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-foreground/80" title={c.accounts.map((a) => accountFor(a.account_id)?.email ?? a.account_id).join(", ")}>
                {mailboxes} mailboxes
                <span className="flex items-center gap-1">
                  {c.accounts.slice(0, 4).map((a) => (
                    <AccountDot key={a.account_id} color={colorFor(a.account_id)} />
                  ))}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => nav(`/search?q=${encodeURIComponent(`from:${c.email}`)}`)}>
            <BrandIcon name="search" /> Their mail
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(c.email).then(() => toast("Address copied"), () => toast.error("Couldn't copy"))}>
            <Copy /> Copy address
          </Button>
          <Button size="sm" onClick={() => openCompose({ to: [{ email: c.email, name: c.name }] })}>
            <BrandIcon name="write" /> Write
          </Button>
        </div>
      </header>

      {status === "pending" && (insights.data?.conversations ?? 0) >= 3 && (
        <div className="mx-2 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
          <p className="min-w-0 flex-1 basis-60 text-[13.5px]">
            {c.name || c.email.split("@")[0]} has {insights.data!.conversations} conversations with you and is still waiting in the Screener.
          </p>
          <Button size="sm" onClick={() => update.mutate({ id: c.id, screen_status: "imbox", scope })}>
            Let in
          </Button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setShow(show === "you" ? "all" : "you")}
          disabled={waitingYou.length === 0}
          aria-pressed={show === "you"}
          className={cn("rounded-xl border px-3.5 py-3 text-left transition-colors", waitingYou.length > 0 ? "border-transparent bg-[#fbeee5] text-[#b4531c] dark:bg-[#33241a] dark:text-[#e08a55]" : "border-border/70 bg-card", show === "you" && "ring-2 ring-current/40")}
        >
          <b className="block text-[22px] font-semibold leading-tight tnum">{waitingYou.length}</b>
          <span className={cn("text-xs", waitingYou.length === 0 && "text-muted-foreground")}>Waiting on you</span>
        </button>
        <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
          <b className="block text-[22px] font-semibold leading-tight tnum">{threads.length}{q.hasNextPage ? "+" : ""}</b>
          <span className="text-xs text-muted-foreground">{threads.length === 1 ? "Conversation" : "Conversations"}{c.message_count > threads.length ? ` · ${c.message_count} messages` : ""}</span>
        </div>
        <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
          <b className="block text-[22px] font-semibold leading-tight tnum" title={fmtRelative(c.first_seen_at)}>{fmtDate(c.first_seen_at)}</b>
          <span className="text-xs text-muted-foreground">First wrote</span>
        </div>
        <div className="rounded-xl border border-border/70 bg-card px-3.5 py-3">
          <b className="block text-[22px] font-semibold leading-tight tnum" title={fmtDate(c.last_seen_at)}>{fmtRelative(c.last_seen_at)}</b>
          <span className="flex items-end justify-between gap-2 text-xs text-muted-foreground">
            Last wrote
            {recent.length > 1 && recent.some((x) => x.n > 0) && (
              <span className="flex h-4 w-14 items-end gap-px" aria-hidden="true">
                {recent.map((x) => <i key={x.m} className="flex-1 rounded-[1px] bg-foreground/45" style={{ height: `${Math.max(12, (x.n / peak) * 100)}%` }} />)}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,1.4fr)]">
        <div className="grid min-w-0 content-start gap-3">
          <section className="min-w-0 rounded-xl border border-border/70 bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold">Conversations</h2>
              {(waitingYou.length > 0 || waitingThem.length > 0) && (
                <ToggleGroup type="single" size="sm" value={show} onValueChange={(v) => v && setShow(v as typeof show)}>
                  <ToggleGroupItem value="all" className="text-xs text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground">All</ToggleGroupItem>
                  {waitingYou.length > 0 && <ToggleGroupItem value="you" className="text-xs text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground">Waiting on you</ToggleGroupItem>}
                  {waitingThem.length > 0 && <ToggleGroupItem value="them" className="text-xs text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground">Waiting on them</ToggleGroupItem>}
                </ToggleGroup>
              )}
            </div>
            <ContactThreads
              threads={shown}
              waitingIds={new Set(waitingYou.map((l) => l.thread_id))}
              empty={show === "all" ? "Nothing between you two yet. Threads with this person will collect here." : "Nothing waiting."}
            />
            <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => q.fetchNextPage()} />
          </section>
          {story && story.files.length > 0 && <ContactStory data={story} />}
        </div>
        <aside className="grid content-start gap-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border border-border/70 bg-card p-4">
          <h2 className="text-[13px] font-semibold">Where their mail goes</h2>
          <ToggleGroup
            type="single"
            size="sm"
            value={status === "pending" ? "" : status}
            onValueChange={(v) => v && update.mutate({ id: c.id, screen_status: v as ScreenStatus, scope })}
            className="mt-3 grid w-full grid-cols-2 gap-2"
          >
            {OPTIONS.map((o) => (
              <ToggleGroupItem
                key={o}
                value={o}
                aria-label={STATUS_META[o].label}
                className="h-10 w-full justify-start gap-2 rounded-lg border border-border/70 px-3 text-muted-foreground data-[state=on]:border-foreground/30 data-[state=on]:bg-accent data-[state=on]:text-foreground [&>svg]:size-3.5"
              >
                {STATUS_META[o].icon}
                {STATUS_META[o].short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="mt-2 text-[13px] text-muted-foreground">{BLURB[status]}</p>

          {c.accounts.length > 1 && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <div className="text-[12.5px] font-medium">Applies to</div>
              <ToggleGroup type="single" size="sm" value={scope} onValueChange={(v) => v && setScope(v as DecisionScope)} className="mt-1.5 flex-wrap">
                <ToggleGroupItem value="all" className="text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground">
                  All mailboxes
                </ToggleGroupItem>
                <ToggleGroupItem value="account" className="text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground">
                  Only {acc?.email ?? "this mailbox"}
                </ToggleGroupItem>
              </ToggleGroup>
              {c.mixed && (
                <ul className="mt-2 space-y-0.5 text-[12.5px] text-muted-foreground">
                  {c.accounts.map((a) => (
                    <li key={a.account_id} className="flex items-center gap-1.5">
                      {multi && <AccountGlyph glyph={glyphFor(a.account_id)} />}
                      <span className="truncate">{accountFor(a.account_id)?.email ?? a.account_id}</span>
                      <span className="ml-auto shrink-0 text-foreground/80">{STATUS_META[a.screen_status].label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={cn("mt-4 flex items-start gap-3 border-t border-border/60 pt-3", !canBundle && "opacity-60")}>
            <Switch checked={c.bundled} disabled={!canBundle} onCheckedChange={(on) => update.mutate({ id: c.id, bundled: on, scope })} aria-label="Bundle up this sender" className="mt-0.5" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] font-medium"><Layers size={14} className="text-muted-foreground" /> Bundle up</div>
              <p className="text-[12.5px] text-muted-foreground">
                {canBundle ? `All their mail shows as one row in the ${status === "imbox" ? "Imbox" : "Feed"}, however much they send.` : "Works for senders delivered to the Imbox or Feed."}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-border/70 bg-card p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold">Notes</h2>
            <span className="text-xs text-muted-foreground">Only you see these</span>
            <span className={cn("ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-opacity", saveState === "idle" ? "opacity-0" : "opacity-100")}>
              {saveState === "saving" ? "Saving…" : <><Check size={11} /> Saved</>}
            </span>
          </div>
          <Textarea
            className="mt-2 min-h-[120px] flex-1 bg-muted/40 text-sm"
            placeholder="Anything worth remembering about them"
            value={notes}
            onChange={(e) => autosave(e.target.value)}
          />
        </div>
      </aside>
      </div>
    </div>
  );
}
