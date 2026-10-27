import { BrandIcon } from "../BrandIcons";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Bold, ChevronDown, Check, Clock, Italic, Link2, List, ListOrdered, Paperclip, Quote, RemoveFormatting, Send, Underline, X } from "lucide-react";
import { toast } from "sonner";
import type { Address } from "@shared/types";
import { cn } from "@/lib/utils";
import { useAccount } from "../../context/AccountContext";
import { sendMail, useDraftMutations, type SendPayload } from "../../api";
import { AddressInput } from "../AddressInput";
import { DateTimePicker } from "../DatePicker";
import { sanitizeEmailHtml } from "../../lib/sanitizeHtml";
import { useCompose } from "../../context/ComposeContext";
import { FromPicker, rememberFrom } from "../FromPicker";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { ComposerHandle, ComposerInitial } from "./types";
import { type Att, AttachmentItem, MAX_ATTACH, readFile } from "./attachments";
import { AUTOSAVE_DELAY, type SaveState, savedLabel } from "./saveState";
import { appendSignature, hasSignature, signatureText } from "./signature";
import { ToolButton } from "./ToolButton";
import { useReplyCompletion } from "./completion";
import { stripGhost } from "./ghost";

export type { ComposerHandle, ComposerInitial } from "./types";
export { fileIcon, MAX_ATTACH, readFile, AttachmentItem, type Att } from "./attachments";
export { savedLabel, AUTOSAVE_DELAY, type SaveState } from "./saveState";
export { SIG_STYLE, appendSignature, signatureText } from "./signature";
export { ToolButton } from "./ToolButton";

export const Composer = forwardRef<ComposerHandle, { initial?: ComposerInitial; inline?: boolean; /** The quiet full-page layout, for a message opened on its own. */ page?: boolean; onDone?: () => void; onCancel?: () => void; autoFocusBody?: boolean }>(function Composer(
  { initial = {}, inline, page, onDone, onCancel, autoFocusBody },
  ref,
) {
  const { accounts, defaultAccount, user } = useAccount();
  const { queueSend } = useCompose();
  const drafts = useDraftMutations();
  const [fromId, setFromId] = useState<string>(() => initial.account_id ?? defaultAccount?.id ?? "");
  const account = useMemo(() => accounts.find((a) => a.id === fromId) ?? defaultAccount ?? null, [accounts, fromId, defaultAccount]);
  const [to, setTo] = useState<Address[]>(initial.to ?? []);
  const [cc, setCc] = useState<Address[]>(initial.cc ?? []);
  const [bcc, setBcc] = useState<Address[]>(() => {
    if (initial.bcc && initial.bcc.length > 0) return initial.bcc;
    if (!initial.draft_id && user?.settings?.autoBcc) return [{ email: user.settings.autoBcc, name: "" }];
    return [];
  });
  const [showCc, setShowCc] = useState((initial.cc?.length ?? 0) > 0);
  const [showBcc, setShowBcc] = useState(() => (initial.bcc?.length ?? 0) > 0 || (!initial.draft_id && !!user?.settings?.autoBcc));
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [atts, setAtts] = useState<Att[]>([]);
  const [includeQuote, setIncludeQuote] = useState(true);
  const [showQuote, setShowQuote] = useState(false);
  const [draftId, setDraftId] = useState(initial.draft_id);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | "discard" | "subject">(null);
  const [dragging, setDragging] = useState(false);
  const [bodyVersion, setBodyVersion] = useState(0);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [now, setNow] = useState(Date.now());
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpenState] = useState(false);
  const setLinkOpen = (o: boolean) => {
    linkOpenRef.current = o;
    setLinkOpenState(o);
  };
  const [laterOpen, setLaterOpen] = useState(false);
  // The full-page layout shows its formatting only while text is selected; this is where the selection is.
  const [selBar, setSelBar] = useState<{ x: number; y: number } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const linkOpenRef = useRef(false);
  const dirty = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isReply = !!initial.thread_id;
  // Only in a reply: the email being answered is what the words are drawn from. Off until switched on in Settings, Writing.
  const completion = useReplyCompletion(bodyRef, { enabled: isReply && user?.settings?.aiComplete === true, subject, to: to.map((a) => a.name || a.email).join(", "), quotedHtml: initial.quoted_html ?? "" });

  // The default account can arrive after mount (fresh page load).
  useEffect(() => {
    if (!fromId && defaultAccount) setFromId(defaultAccount.id);
  }, [fromId, defaultAccount]);

  const sig = account?.signature || user?.settings?.defaultSignature || "";

  useEffect(() => {
    if (!bodyRef.current) return;
    let html = initial.body_html ?? "";
    if (!initial.draft_id) html = appendSignature(html, sig);
    // A draft can hold a stranger's HTML (a forward, whoever wrote the draft), so what goes into the editor is made safe first.
    bodyRef.current.innerHTML = sanitizeEmailHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the account (and its signature) arrives after mount, drop the signature into a still-empty body.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || initial.draft_id || !sig) return;
    if (el.innerText.trim() === "" && !hasSignature(el.innerHTML)) el.innerHTML = appendSignature("", sig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    if (isReply || autoFocusBody) {
      const t = setTimeout(() => {
        const el = bodyRef.current;
        if (!el) return;
        el.focus();
        const r = document.createRange();
        r.setStart(el, 0);
        r.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }, 60);
      return () => clearTimeout(t);
    }
  }, [isReply, autoFocusBody]);

  useEffect(() => {
    if (save.kind !== "saved") return;
    const i = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(i);
  }, [save.kind]);

  useEffect(() => {
    if (!page) return;
    const onSel = () => {
      const sel = window.getSelection();
      const el = bodyRef.current;
      if (!sel || !el || sel.isCollapsed || sel.rangeCount === 0 || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) {
        // Keep the bar while the link field is open: using it moves focus, and with it the selection.
        setSelBar((cur) => (linkOpenRef.current ? cur : null));
        return;
      }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      setSelBar({ x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [page]);

  const exec = (cmd: string, val?: string) => {
    bodyRef.current?.focus();
    document.execCommand(cmd, false, val);
    markDirty();
  };

  // Shown in the app's own page, so made safe again here whatever put it there, and without anything that would be fetched from another server.
  const quotedPreview = useMemo(() => sanitizeEmailHtml(initial.quoted_html ?? "", { noRemoteImages: true }), [initial.quoted_html]);

  const bodyHtml = useCallback(() => {
    let html = stripGhost(bodyRef.current?.innerHTML ?? "");
    if (includeQuote && initial.quoted_html) html += `<br><br><div class="imbox-quote"><blockquote style="border-left:2px solid #d3d1cb;margin:0;padding-left:1em;color:#787774">${initial.quoted_html}</blockquote></div>`;
    return html;
  }, [includeQuote, initial.quoted_html]);
  const isEmpty = useCallback(() => {
    const txt = (bodyRef.current?.innerText ?? "").trim();
    const sigText = signatureText(sig);
    const bodyEmpty = !txt || txt === sigText;
    return bodyEmpty && !subject.trim() && !to.length && !cc.length && !bcc.length && !atts.length;
  }, [sig, subject, to, cc, bcc, atts]);

  const draftBody = useCallback(
    () => ({ account_id: account?.id, thread_id: initial.thread_id ?? null, reply_to_message_id: initial.reply_to_message_id ?? null, to, cc, bcc, subject, body_html: bodyHtml() }),
    [account?.id, initial.thread_id, initial.reply_to_message_id, to, cc, bcc, subject, bodyHtml],
  );

  const saveDraft = useCallback(
    async (quiet = true) => {
      if (isEmpty()) return null;
      setSave({ kind: "saving" });
      try {
        let id = draftId;
        if (id) await drafts.update.mutateAsync({ id, ...draftBody() });
        else {
          const d = await drafts.create.mutateAsync(draftBody());
          id = d.id;
          setDraftId(id);
        }
        dirty.current = false;
        setSave({ kind: "saved", at: Date.now() });
        setNow(Date.now());
        if (!quiet) toast.success("Draft saved");
        return id;
      } catch (e) {
        setSave({ kind: "error", message: (e as Error).message });
        if (!quiet) toast.error((e as Error).message);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftId, draftBody, isEmpty],
  );

  const markDirty = () => {
    dirty.current = true;
    setBodyVersion((v) => v + 1);
  };
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => {
      if (dirty.current && !busy) saveDraft(true);
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, cc, bcc, subject, bodyVersion, fromId]);

  const payload = (send_at?: number): SendPayload => ({
    draft_id: draftId,
    account_id: account?.id,
    thread_id: initial.thread_id ?? null,
    reply_to_message_id: initial.reply_to_message_id ?? null,
    to,
    cc,
    bcc,
    subject,
    body_html: bodyHtml(),
    send_at: send_at ?? null,
    attachments: atts.map(({ filename, mime_type, data_base64 }) => ({ filename, mime_type, data_base64 })),
  });

  const validate = () => {
    if (!to.length && !cc.length && !bcc.length) {
      toast.error("Add at least one recipient.");
      return false;
    }
    if (!account) {
      toast.error("Connect an account first.");
      return false;
    }
    return true;
  };

  const doSend = (skipSubjectCheck = false) => {
    if (fromId) rememberFrom(fromId);
    if (!validate()) return;
    // The app's webview blocks window.confirm(), so ask with a real dialog instead.
    if (!skipSubjectCheck && !subject.trim() && !isReply) {
      setAsk("subject");
      return;
    }
    const undo = user?.settings?.undoSendSeconds ?? 10;
    dirty.current = false;
    queueSend(payload(), undo);
    onDone?.();
  };
  const doSendLater = async (at: number) => {
    if (!validate()) return;
    setBusy(true);
    try {
      await sendMail(payload(at));
      dirty.current = false;
      toast.success(`Scheduled for ${new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reallyDiscard = () => {
    dirty.current = false;
    if (draftId) drafts.remove.mutate(draftId);
    onCancel?.();
  };
  const discard = () => {
    if (isEmpty()) {
      reallyDiscard();
      return;
    }
    setAsk("discard");
  };
  const saveAndClose = async () => {
    if (isEmpty()) {
      if (draftId) drafts.remove.mutate(draftId);
    } else if (dirty.current || !draftId) {
      const id = await saveDraft(true);
      if (id) toast("Saved as a draft", { duration: 3000 });
    }
    onCancel?.();
  };
  useImperativeHandle(ref, () => ({
    send: () => doSend(),
    saveAndClose,
    isEmpty,
  }));

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const next = [...atts];
    for (const f of Array.from(files)) {
      if (next.reduce((s, a) => s + a.size, 0) + f.size > MAX_ATTACH) {
        toast.error("Attachments are capped at 20 MB total.");
        break;
      }
      next.push(await readFile(f));
    }
    setAtts(next);
    markDirty();
  };

  const openLink = () => {
    const s = window.getSelection();
    savedRange.current = s?.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    setLinkUrl("");
    setLinkOpen(true);
  };
  const insertLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^[a-z]+:/i.test(url)) url = "https://" + url;
    bodyRef.current?.focus();
    const s = window.getSelection();
    if (savedRange.current && s) {
      s.removeAllRanges();
      s.addRange(savedRange.current);
    }
    if (s?.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url}</a>`);
    else document.execCommand("createLink", false, url);
    markDirty();
    setLinkOpen(false);
  };

  const rowLabel = (t: string) => <span className="w-14 shrink-0 text-[13px] text-muted-foreground select-none">{t}</span>;
  const status = savedLabel(save, now);
  // Pieces shared by the popup layout and the full-page one.
  const fromControl = (
    <>
      {accounts.length === 0 ? (
        <span className="text-[13px] text-muted-foreground">No account connected</span>
      ) : (
        <FromPicker
          accounts={accounts}
          value={fromId}
          onChange={(v) => { setFromId(v); markDirty(); }}
          suggestedId={isReply ? initial.account_id : null}
          userName={user?.name}
        />
      )}
    </>
  );
  const linkPopover = (
    <Popover open={linkOpen} onOpenChange={setLinkOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={openLink} className={cn("text-muted-foreground hover:text-foreground", linkOpen && "bg-muted text-foreground")}>
          <Link2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-1.5">
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); insertLink(); }}>
          <Input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" className="h-7 text-[13px]" />
          <Button type="submit" size="sm" disabled={!linkUrl.trim()}><Check /> Add</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
  const quoteBlock = (
    <>
      {initial.quoted_html && (
        <div className="mt-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setShowQuote((s) => !s)}>
              <ChevronDown className={cn("transition-transform", showQuote && "rotate-180")} />
              {showQuote ? "Hide" : "Show"} quoted text
            </Button>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground select-none">
              <Switch size="sm" checked={includeQuote} onCheckedChange={(v) => { setIncludeQuote(v); markDirty(); }} />
              Include when sending
            </label>
          </div>
          {showQuote && (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: quotedPreview comes from sanitizeEmailHtml
            <div className="mt-2 border-l-2 border-border pl-3 text-muted-foreground text-[13px] max-h-64 overflow-y-auto [&_img]:max-w-full" dangerouslySetInnerHTML={{ __html: quotedPreview }} />
          )}
        </div>
      )}
    </>
  );
  const attBlock = (
    <>
      {atts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-4">
          {atts.map((a, i) => (
            <AttachmentItem key={i} a={a} onRemove={() => { setAtts(atts.filter((_, j) => j !== i)); markDirty(); }} />
          ))}
        </div>
      )}
    </>
  );
  const askDialog = (
    <AlertDialog open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask === "discard" ? "Discard this message?" : "Send without a subject?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {ask === "discard" ? "The draft is deleted and the text is gone." : "The recipient will see “(no subject)”."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{ask === "discard" ? "Keep writing" : "Add a subject"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const which = ask;
              setAsk(null);
              if (which === "discard") reallyDiscard();
              else doSend(true);
            }}
          >
            {ask === "discard" ? "Discard" : "Send"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const bodyEl = (extra: string) => (
    <div
      ref={bodyRef}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={isReply ? "Write your reply…" : "Write something…"}
      className={cn("prose-mail outline-none text-[15px] leading-[1.6] text-foreground empty:before:content-[attr(data-placeholder)] empty:before:text-tertiary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5", inline ? "min-h-24" : "min-h-48", extra)}
      onInput={(e) => {
        markDirty();
        completion.onInput(e);
      }}
      onKeyDown={completion.onKeyDown}
      onMouseDown={completion.clear}
      onBlur={completion.clear}
      onPaste={(e) => {
        if (e.clipboardData.files?.length) {
          e.preventDefault();
          addFiles(e.clipboardData.files);
        }
      }}
    />
  );

  // The full page: one line for who it is from and to, the subject as a title, a wide column to write in. Formatting waits until
  // text is selected. Sending, scheduling, attaching and discarding are in the bar along the top.
  if (page) {
    const emptyNow = isEmpty();
    return (
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy && account) {
            e.preventDefault();
            e.stopPropagation();
            doSend();
          }
        }}
        className="relative flex h-full flex-col bg-background"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files?.length) {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border border-dashed border-ring bg-background/90 text-sm text-muted-foreground">
            <Paperclip size={14} className="mr-2" /> Drop to attach
          </div>
        )}
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close and keep as a draft" className="text-muted-foreground hover:text-foreground" onClick={() => void saveAndClose()}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Close <Kbd className="ml-1">esc</Kbd>
            </TooltipContent>
          </Tooltip>
          <span className="ml-1 text-[13px] text-muted-foreground">{initial.title || (isReply ? "Reply" : "New message")}</span>
          {status && (
            <span className="ml-2 hidden text-xs tnum text-tertiary sm:inline" aria-live="polite">
              · {status}
            </span>
          )}
          <span className="flex-1" />
          <ToolButton label="Attach files" onClick={() => fileRef.current?.click()}>
            <Paperclip />
          </ToolButton>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          {!emptyNow && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Discard" className="text-muted-foreground hover:text-foreground" onClick={discard}>
                  <BrandIcon name="trash" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Discard</TooltipContent>
            </Tooltip>
          )}
          <Popover open={laterOpen} onOpenChange={setLaterOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" disabled={busy || !account} className="text-muted-foreground hover:text-foreground">
                <Clock /> Later
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-1">
              <div className="flex h-7 items-center px-2 text-xs font-medium text-muted-foreground">Send later</div>
              <DateTimePicker embedded verb="Schedule" onPick={(at) => { setLaterOpen(false); doSendLater(at); }} />
            </PopoverContent>
          </Popover>
          <Button size="sm" onClick={() => doSend()} disabled={busy || !account} title="Send (⌘↵)">
            <Send /> Send
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[680px] px-6 pb-32 pt-8">
            <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
              <span className="w-8 shrink-0">From</span>
              {fromControl}
            </div>
            <div className="mt-1">
              <AddressInput
                quiet
                label="To"
                value={to}
                onChange={(v) => { setTo(v); dirty.current = true; }}
                autoFocus={!isReply && !to.length}
                trailing={
                  (!showCc || !showBcc) && (
                    <>
                      {!showCc && <Button variant="ghost" size="xs" className="h-6 text-muted-foreground" onClick={() => setShowCc(true)}>Cc</Button>}
                      {!showBcc && <Button variant="ghost" size="xs" className="h-6 text-muted-foreground" onClick={() => setShowBcc(true)}>Bcc</Button>}
                    </>
                  )
                }
              />
              {showCc && <AddressInput quiet label="Cc" value={cc} onChange={(v) => { setCc(v); dirty.current = true; }} autoFocus={!cc.length} />}
              {showBcc && <AddressInput quiet label="Bcc" value={bcc} onChange={(v) => { setBcc(v); dirty.current = true; }} autoFocus={!bcc.length} />}
            </div>
            <input
              className="mt-7 w-full min-w-0 bg-transparent text-[32px] font-semibold leading-[1.15] tracking-[-0.035em] text-foreground outline-none placeholder:text-tertiary"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); dirty.current = true; }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); } }}
              placeholder={isReply ? "" : "Subject"}
              aria-label="Subject"
            />
            <div className="mt-5">
              {bodyEl("text-[16px] leading-[1.75]")}
              {quoteBlock}
              {attBlock}
            </div>
            <p className="mt-10 text-xs text-tertiary select-none">Select text to format it.</p>
          </div>
        </div>

        {selBar && (
          <div
            role="toolbar"
            aria-label="Format the selected text"
            className="fixed z-[60] flex items-center gap-0.5 rounded-lg bg-foreground p-1 text-background shadow-lg"
            style={{ left: selBar.x, top: Math.max(8, selBar.y - 46), transform: "translateX(-50%)" }}
            onMouseDown={(e) => {
              // Keep the selection while a button is pressed, but let the link field take focus.
              if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
            }}
          >
            {[
              { label: "Bold", icon: <Bold />, run: () => exec("bold") },
              { label: "Italic", icon: <Italic />, run: () => exec("italic") },
              { label: "Underline", icon: <Underline />, run: () => exec("underline") },
            ].map((b) => (
              <Button key={b.label} variant="ghost" size="icon-sm" aria-label={b.label} title={b.label} onClick={b.run} className="text-background hover:bg-background/15 hover:text-background">
                {b.icon}
              </Button>
            ))}
            <span className="[&_button]:text-background [&_button:hover]:bg-background/15 [&_button:hover]:text-background">{linkPopover}</span>
            {[
              { label: "Bulleted list", icon: <List />, run: () => exec("insertUnorderedList") },
              { label: "Numbered list", icon: <ListOrdered />, run: () => exec("insertOrderedList") },
              { label: "Quote", icon: <Quote />, run: () => exec("formatBlock", "blockquote") },
              { label: "Clear formatting", icon: <RemoveFormatting />, run: () => exec("removeFormat") },
            ].map((b) => (
              <Button key={b.label} variant="ghost" size="icon-sm" aria-label={b.label} title={b.label} onClick={b.run} className="text-background hover:bg-background/15 hover:text-background">
                {b.icon}
              </Button>
            ))}
          </div>
        )}
        {askDialog}
      </div>
    );
  }

  return (
    <div
      onKeyDown={(e) => {
        // ⌘/Ctrl + Enter sends from anywhere in the composer.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy && account) {
          e.preventDefault();
          e.stopPropagation();
          doSend();
        }
      }}
      className={cn("flex flex-col relative", !inline && "min-h-full")}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files?.length) {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragging && (
        <div className="absolute inset-1 z-20 rounded-lg border border-dashed border-ring bg-background/90 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
          <Paperclip size={14} className="mr-2" /> Drop to attach
        </div>
      )}
      <div className={cn("px-4", inline ? "pt-0.5" : "pt-1")}>
        {/* From */}
        <div className="flex items-center gap-3 py-1.5 border-b border-border">
          {rowLabel("From")}
          {fromControl}
        </div>
        <AddressInput
          label="To"
          value={to}
          onChange={(v) => { setTo(v); dirty.current = true; }}
          autoFocus={!isReply && !to.length}
          trailing={
            (!showCc || !showBcc) && (
              <>
                {!showCc && <Button variant="ghost" size="xs" className="text-muted-foreground h-6" onClick={() => setShowCc(true)}>Cc</Button>}
                {!showBcc && <Button variant="ghost" size="xs" className="text-muted-foreground h-6" onClick={() => setShowBcc(true)}>Bcc</Button>}
              </>
            )
          }
        />
        {showCc && <AddressInput label="Cc" value={cc} onChange={(v) => { setCc(v); dirty.current = true; }} autoFocus={!cc.length} />}
        {showBcc && <AddressInput label="Bcc" value={bcc} onChange={(v) => { setBcc(v); dirty.current = true; }} autoFocus={!bcc.length} />}
        <div className="flex items-center gap-3 py-1.5 border-b border-border">
          {rowLabel("Subject")}
          <input
            className={cn("flex-1 min-w-0 bg-transparent outline-none text-foreground placeholder:text-tertiary py-0.5", isReply || inline ? "text-[14px]" : "text-[16px] font-semibold tracking-[-0.01em]")}
            value={subject}
            onChange={(e) => { setSubject(e.target.value); dirty.current = true; }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); bodyRef.current?.focus(); } }}
            placeholder={isReply ? "" : "Subject"}
          />
        </div>
      </div>

      <div className={cn("px-4 py-3", inline ? "" : "flex-1")}>
        {bodyEl("")}
        {quoteBlock}
        {attBlock}
      </div>

      <div className={cn("flex items-center gap-1 px-2 py-2 border-t border-border", !inline && "sticky bottom-0 z-10 bg-background")}>
        <div className="flex items-center gap-0.5 min-w-0">
          <ToolButton label="Bold" kbd="⌘B" onClick={() => exec("bold")}><Bold /></ToolButton>
          <ToolButton label="Italic" kbd="⌘I" onClick={() => exec("italic")}><Italic /></ToolButton>
          <ToolButton label="Underline" kbd="⌘U" onClick={() => exec("underline")}><Underline /></ToolButton>
          {linkPopover}
          <span className="hidden sm:flex items-center gap-0.5">
            <ToolButton label="Bulleted list" onClick={() => exec("insertUnorderedList")}><List /></ToolButton>
            <ToolButton label="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered /></ToolButton>
            <ToolButton label="Quote" onClick={() => exec("formatBlock", "blockquote")}><Quote /></ToolButton>
            <span className="hidden md:inline-flex"><ToolButton label="Clear formatting" onClick={() => exec("removeFormat")}><RemoveFormatting /></ToolButton></span>
          </span>
          <ToolButton label="Attach files" onClick={() => fileRef.current?.click()}><Paperclip /></ToolButton>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        <span className="flex-1" />
        {status && (
          <span className="text-xs tnum mr-1 hidden sm:inline text-tertiary" aria-live="polite">
            {status}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={isEmpty() ? "Close" : "Discard"} className="text-muted-foreground hover:text-foreground" onClick={discard}>
              <BrandIcon name="trash" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isEmpty() ? "Close" : "Discard"}</TooltipContent>
        </Tooltip>
        <ButtonGroup className="ml-1">
          <Button onClick={() => doSend()} disabled={busy || !account} title="Send (⌘↵)">
            <Send /> Send
          </Button>
          <Popover open={laterOpen} onOpenChange={setLaterOpen}>
            <PopoverTrigger asChild>
              <Button size="icon" aria-label="Send later" disabled={busy || !account} className="w-7">
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-auto p-1">
              <div className="px-2 h-7 flex items-center text-xs font-medium text-muted-foreground">Send later</div>
              <DateTimePicker embedded verb="Schedule" onPick={(at) => { setLaterOpen(false); doSendLater(at); }} />
            </PopoverContent>
          </Popover>
        </ButtonGroup>
      </div>
      {askDialog}
    </div>
  );
});
