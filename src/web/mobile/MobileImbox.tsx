import { BrandIcon } from "../components/BrandIcons";
import { useState } from "react";
import { AwayBanner } from "../components/AwayBanner";
import { NotificationsMenu } from "../components/NotificationsMenu";
import { OutboxChip } from "../components/OutboxChip";
import { useMenuPreset, type MobileTab } from "../lib/menuPresets";
import { BriefCard } from "../components/BriefCard";
import { DeckSkeleton, ImboxDeck, readToday } from "../components/ImboxDeck";
import { Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import type { ThreadSummary } from "@shared/types";
import { ALL, useAccount } from "../context/AccountContext";
import { useBulkAction, useImbox } from "../api";
import { Avatar } from "../components/Avatar";
import { SyncChip } from "../components/SyncPill";
import { fmtTime } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Wordmark } from "../components/Logo";
import { Screen } from "./Screen";
import { MobileList } from "./MobileList";
import { ScopeSheet, useScopeLabel } from "./MobileShell";

/** Before a mailbox is connected, hand off to the guided setup (same page as desktop). */
export function MobileConnectCard() {
  return <Navigate to="/welcome" replace />;
}

function PileChip({ threads, label, icon, link, linkLabel, onDone }: { threads: ThreadSummary[]; label: string; icon: React.ReactNode; link: string; linkLabel: string; onDone: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  if (threads.length === 0) return null;
  const first = threads[0];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="grid min-w-0 gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left active:bg-muted/60" aria-label={`${label}, ${threads.length}`}>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          {icon}
          <span>{label}</span>
          <span className="ml-auto min-w-[20px] rounded-md bg-muted px-1.5 py-0.5 text-center text-[12px] font-medium tnum">{threads.length}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <Avatar email={first.last_from.email} name={first.last_from.name} src={first.last_from.avatar_url} size={22} />
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{first.subject || "(no subject)"}</span>
        </span>
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="pb-safe">
          <DrawerHeader className="pb-1 flex-row items-center justify-between text-left">
            <div>
              <DrawerTitle className="text-[15px]">{label}</DrawerTitle>
              <DrawerDescription className="sr-only">Threads in {label}</DrawerDescription>
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setOpen(false); nav(link); }}>
              {linkLabel} <ArrowRight />
            </Button>
          </DrawerHeader>
          <div className="max-h-[60vh] overflow-y-auto pb-2">
            {threads.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 h-14">
                <Avatar email={t.last_from.email} name={t.last_from.name} src={t.last_from.avatar_url} size={32} />
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => { setOpen(false); nav(`/t/${t.id}`); }}>
                  <div className="text-[15px] truncate">{t.subject || "(no subject)"}</div>
                  <div className="text-[13px] text-muted-foreground truncate">{t.last_from.name || t.last_from.email} · {fmtTime(t.last_message_at)}</div>
                </button>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onDone(t.id)}>
                  <Check /> Done
                </Button>
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

export function MobilePiles({ replyLater, setAside }: { replyLater: ThreadSummary[]; setAside: ThreadSummary[] }) {
  const bulk = useBulkAction();
  if (replyLater.length === 0 && setAside.length === 0) return null;
  return (
    <div className="mx-4 mb-4 mt-1 grid grid-cols-2 gap-2">
      <PileChip threads={replyLater} label="Reply later" icon={<BrandIcon name="reply-later" size={14} />} link="/reply-later" linkLabel="Focus & Reply" onDone={(id) => bulk.mutate({ thread_ids: [id], action: "reply_later", on: false })} />
      <PileChip threads={setAside} label="Set aside" icon={<BrandIcon name="set-aside" size={14} />} link="/set-aside" linkLabel="Board" onDone={(id) => bulk.mutate({ thread_ids: [id], action: "set_aside", on: false })} />
    </div>
  );
}

export default function MobileImbox() {
  const { accounts, scope } = useAccount();
  const nav = useNavigate();
  const imbox = useImbox(accounts.length > 0);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const scopeLabel = useScopeLabel();
  const preset = useMenuPreset();
  const inBar = (t: MobileTab) => preset.mobile.includes(t);
  const d = imbox.data;
  const newCount = (d?.new_threads.length ?? 0) + (d?.bundles ?? []).filter((b) => b.status === "open").length;
  const deck = imbox.isLoading ? <div className="px-4"><DeckSkeleton /></div> : imbox.error ? null : (
    <div className="px-4">
      <ImboxDeck threads={d?.new_threads ?? []} read={readToday(d?.seen_threads)} />
    </div>
  );
  return (
    <Screen
      title={
        <span className="inline-flex items-center gap-1">
          <Wordmark size={26} /> {accounts.length > 0 && <ChevronDown size={18} className="text-muted-foreground" />}
        </span>
      }
      largeTitle
      subtitle={
        accounts.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {scopeLabel}
              {scope === ALL && accounts.length > 1 && <span className="text-tertiary"> · {accounts.filter((a) => !a.is_agent).length} mailboxes</span>}
            </span>
            <SyncChip onClick={() => setScopeOpen(true)} />
          </span>
        ) : undefined
      }
      onTitleTap={accounts.length > 0 ? () => setScopeOpen(true) : undefined}
      titleRight={
        <div className="flex items-center">
          {accounts.length > 0 && !inBar("assistant") && (
            <button type="button" onClick={() => nav("/assistant")} aria-label="Ask the assistant" className="size-11 rounded-full flex items-center justify-center text-foreground active:bg-muted">
              <BrandIcon name="assistant" size={21} />
            </button>
          )}
          {accounts.length > 0 ? <NotificationsMenu sheet /> : <OutboxChip sheet />}
          <button type="button" onClick={() => nav("/search")} aria-label="Search" className="size-11 rounded-full flex items-center justify-center text-foreground active:bg-muted">
            <BrandIcon name="search" size={22} />
          </button>
        </div>
      }
      fab={accounts.length > 0 && !selecting}
      bottomInset={64}
    >
      {accounts.length === 0 ? (
        <MobileConnectCard />
      ) : (
        <>
          <AwayBanner away={d?.away} className="mx-4 mb-3" />
          {/* "Nothing new" and the new mail come first; the brief follows. */}
          {deck}
          <BriefCard compact />
          <MobileList
            loading={imbox.isLoading}
            error={imbox.error}
            onRetry={() => imbox.refetch()}
            onRefresh={() => imbox.refetch()}
            onSelectionModeChange={setSelecting}
            sections={[
              ...((d?.bundles ?? []).some((b) => b.status === "open") ? [{ title: "Bundles", threads: [], bundles: (d?.bundles ?? []).filter((b) => b.status === "open") }] : []),
              ...(d?.held_threads?.length ? [{ title: "Back to work", threads: d.held_threads }] : []),
              { title: "Previously seen", threads: d?.seen_threads ?? [], bundles: (d?.bundles ?? []).filter((b) => b.status === "seen"), emptyTitle: "Nothing here yet.", emptyBody: "Once you open something, it settles down here." },
            ]}
          />
          {!selecting && <MobilePiles replyLater={d?.reply_later ?? []} setAside={d?.set_aside ?? []} />}
        </>
      )}
      <ScopeSheet open={scopeOpen} onOpenChange={setScopeOpen} />
    </Screen>
  );
}

