import { BrandIcon } from "@/components/BrandIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import { threadNeighbours } from "@/lib/threadNav";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Message } from "@shared/types";
import { assistant } from "@/lib/assistantStore";
import { ImboxHintBanner } from "@/components/ImboxHintBanner";
import { useEventFromThread, useThread, useThreadAction } from "@/api";
import { useAccount } from "@/context/AccountContext";
import { replyInitial, type ReplyMode } from "@/lib/reply";
import { ErrorState } from "@/components/EmptyState";
import { useKeys } from "@/lib/keys";
import { useCardScroll } from "@/lib/cardKeys";
import { overlayOpen } from "@/lib/focusStore";
import { Skeleton } from "@/components/ui/skeleton";
import { AiSummaryPanel, useThreadSummary } from "@/components/AiReply";
import { CatchUpCard } from "@/components/CatchUpCard";
import { ActionsCard } from "@/components/ActionsCard";
import { PhishingBanner } from "@/components/PhishingBanner";
import { ActionBar } from "../thread/ActionBar";
import { ClipsRow } from "../thread/ClipsRow";
import { MessageList } from "../thread/MessageList";
import { NoteBox } from "../thread/NoteBox";
import { ReplyBox } from "../thread/ReplyBox";
import { ThreadDialogs } from "../thread/ThreadDialogs";
import { ThreadHeader } from "../thread/ThreadHeader";
import { SlimHeader } from "../thread/SlimHeader";
import { useMainColumn, useTitleUnderHeader } from "../thread/layout";
// Re-exported for the desktop pages that compose from a list (Reply Later).
export { replyInitial, type ReplyMode };

export default function Thread() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const peek = sp.get("peek") === "1";
  const nav = useNavigate();
  const { user, accountFor } = useAccount();
  const q = useThread(id, peek);
  const act = useThreadAction(id);
  const toEvent = useEventFromThread();
  const t = q.data;
  const col = useMainColumn();
  const titleRef = useRef<HTMLDivElement>(null);
  const slimTop = useTitleUnderHeader(titleRef, !!t);
  const account = accountFor(t?.account_id);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showTimeline, setShowTimeline] = useState(false);
  const [msgCursor, setMsgCursor] = useState(-1);
  const [reply, setReply] = useState<{ mode: ReplyMode; m: Message; key: number; body_html?: string } | null>(null);
  const summ = useThreadSummary(id ?? "");
  const [renaming, setRenaming] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  // In the side rail, "…" turns the rail itself into one labelled list of every action.
  const [railOpen, setRailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!t) return;
    setExpanded((prev) => {
      if (prev.size) return prev;
      const s = new Set<string>();
      const last = t.messages[t.messages.length - 1];
      if (last) s.add(last.id);
      for (const m of t.messages) if (m.unread) s.add(m.id);
      return s;
    });
    setNoteDraft(t.note);
  }, [t]);

  useEffect(() => {
    if (noteOpen) setTimeout(() => noteRef.current?.focus(), 30);
  }, [noteOpen]);

  // Nothing is focused until the first arrow press; a new thread starts over.
  useEffect(() => {
    setMsgCursor(-1);
    setShowTimeline(false);
  }, [id]);

  const lastIncoming = useMemo(() => (t ? [...t.messages].reverse().find((m) => !m.is_from_me) ?? t.messages[t.messages.length - 1] : undefined), [t]);
  const openReply = (mode: ReplyMode, m?: Message) => {
    const msg = m ?? lastIncoming;
    if (!msg) return;
    setReply({ mode, m: msg, key: Date.now() });
    setTimeout(() => document.getElementById("reply-box")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };

  // "Nudge" from the Sent page lands here with the reply already open.
  const autoReplied = useRef(false);
  useEffect(() => {
    if (sp.get("reply") !== "1" || autoReplied.current || !t || !lastIncoming) return;
    autoReplied.current = true;
    openReply("reply");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, lastIncoming]);

  const run = (a: Parameters<typeof act.mutate>[0], msg?: string) =>
    act.mutate(a, {
      onSuccess: () => msg && toast(msg),
      onError: (e) => toast.error((e as Error).message),
    });

  const toggleReplyLater = () => t && run({ action: "reply_later", on: !t.reply_later }, t.reply_later ? "Removed from Reply Later" : "Added to Reply Later");
  const toggleSetAside = () => t && run({ action: "set_aside", on: !t.set_aside }, t.set_aside ? "Removed from Set Aside" : "Set aside");

  useCardScroll(true, { arrows: false });

  const msgCount = t?.messages.length ?? 0;
  const moveMsg = (delta: number) => {
    if (overlayOpen() || msgCount === 0) return;
    setMsgCursor((c) => {
      const next = c < 0 ? (delta > 0 ? 0 : msgCount - 1) : Math.min(Math.max(c + delta, 0), msgCount - 1);
      requestAnimationFrame(() => document.querySelector(`[data-msg-index="${next}"]`)?.scrollIntoView({ block: "nearest" }));
      return next;
    });
  };
  const toggleFocusedMsg = () => {
    if (overlayOpen() || msgCursor < 0 || !t) return;
    const m = t.messages[msgCursor];
    if (!m) return;
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(m.id)) n.delete(m.id);
      else n.add(m.id);
      return n;
    });
  };

  useKeys(
    {
      ArrowDown: () => moveMsg(1),
      ArrowUp: () => moveMsg(-1),
      j: () => moveMsg(1),
      k: () => moveMsg(-1),
      Enter: toggleFocusedMsg,
      o: toggleFocusedMsg,
      r: () => openReply("reply"),
      f: () => openReply("forward"),
      l: toggleReplyLater,
      a: toggleSetAside,
      z: () => setBubbleOpen(true),
      u: () => run({ action: "mark_unread" }, "Marked unread"),
      n: () => setNoteOpen(true),
      "#": () => {
        run({ action: "move", bucket: "trash" }, "Moved to trash");
        nav(-1);
      },
      Escape: () => {
        // An open assistant folds away on Escape; the thread stays.
        if (assistant.get().open) return;
        // Let open menus/popovers/dialogs consume Escape first.
        if (document.querySelector('[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"],[data-slot="popover-content"]')) return;
        if (railOpen) return setRailOpen(false);
        if (reply) setReply(null);
        else nav(-1);
      },
    },
    !renaming && !noteOpen && !mergeOpen && !confirmDelete,
  );

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!t) {
    return (
      <div className="max-w-5xl mx-auto w-full px-2">
        <Skeleton className="h-6 w-16 mb-6" />
        <Skeleton className="h-7 w-3/4 mb-3" />
        <Skeleton className="h-3.5 w-1/3 mb-8" />
        <Skeleton className="h-24 w-full mb-3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const renamed = !!t.subject && t.subject !== t.original_subject;
  const neighbours = threadNeighbours(t.id);
  const others = t.participants.filter((p) => p.email.toLowerCase() !== (account?.email ?? "").toLowerCase());
  const names = (others.length ? others : t.participants).map((p) => p.name?.trim() || p.email);
  const replyTarget = lastIncoming ? (lastIncoming.is_from_me ? lastIncoming.to[0]?.name || lastIncoming.to[0]?.email : lastIncoming.from.name || lastIncoming.from.email) : "";
  const allExpanded = expanded.size >= t.messages.length;

  const saveRename = () => {
    const s = subjectDraft.trim();
    run({ action: "rename", subject: s && s !== t.original_subject ? s : null }, s ? "Renamed" : "Name restored");
    setRenaming(false);
  };
  const saveNote = () => {
    run({ action: "note", note: noteDraft }, "Note saved");
    setNoteOpen(false);
  };


  return (
    <div className="max-w-5xl mx-auto w-full px-2 pb-24">
      {slimTop !== null && (
        <SlimHeader
          top={slimTop}
          col={col}
          subject={t.subject}
          names={names}
          neighbours={neighbours}
          onBack={() => nav(-1)}
          onGo={(id) => nav(`/t/${id}`, { replace: true })}
          onReply={() => openReply("reply")}
          onReplyLater={toggleReplyLater}
          replyLaterOn={t.reply_later}
          onSetAside={toggleSetAside}
          setAsideOn={t.set_aside}
          hideReply={!!reply}
        />
      )}

      <ThreadHeader t={t} neighbours={neighbours} names={names} account={account} renamed={renamed} renaming={renaming} setRenaming={setRenaming} subjectDraft={subjectDraft} setSubjectDraft={setSubjectDraft} saveRename={saveRename} titleRef={titleRef} run={run} />

      <PhishingBanner thread={t} className="mt-4" />

      <ImboxHintBanner thread={t} className="mt-4" />

      <NoteBox t={t} noteOpen={noteOpen} setNoteOpen={setNoteOpen} noteDraft={noteDraft} setNoteDraft={setNoteDraft} noteRef={noteRef} saveNote={saveNote} run={run} />

      <ClipsRow t={t} />

      {t && <CatchUpCard thread={t} className="mt-4" />}
      {t && <ActionsCard thread={t} className="mt-4" />}
      {summ.summary && <AiSummaryPanel summary={summ.summary} onClose={summ.clear} onRefresh={() => summ.run(true)} onRemove={summ.remove} stale={summ.stale} pending={summ.pending} savedAt={summ.savedAt} className="mt-4" />}
      {summ.pending && !summ.summary && <div className="mt-4 flex items-center gap-2 text-[13px] text-muted-foreground"><BrandIcon name="assistant" className="size-3.5" /> Summarising…</div>}

      <MessageList t={t} names={names} expanded={expanded} setExpanded={setExpanded} showTimeline={showTimeline} setShowTimeline={setShowTimeline} msgCursor={msgCursor} allExpanded={allExpanded} openReply={openReply} run={run} />

      <ReplyBox t={t} reply={reply} setReply={setReply} openReply={openReply} account={account} user={user} replyTarget={replyTarget} />

      <ActionBar t={t} col={col} reply={reply} railOpen={railOpen} setRailOpen={setRailOpen} bubbleOpen={bubbleOpen} setBubbleOpen={setBubbleOpen} openReply={openReply} toggleReplyLater={toggleReplyLater} toggleSetAside={toggleSetAside} run={run} summ={summ} toEvent={toEvent} setNoteOpen={setNoteOpen} setSubjectDraft={setSubjectDraft} setRenaming={setRenaming} setMergeOpen={setMergeOpen} setConfirmDelete={setConfirmDelete} />

      <ThreadDialogs t={t} account={account} mergeOpen={mergeOpen} setMergeOpen={setMergeOpen} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} run={run} />
    </div>
  );
}
