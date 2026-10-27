import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, invalidateMail, sendMail, type SendPayload } from "../api";
import { friendlyError, isTransient, outbox, type OutboxPayload } from "../lib/outbox";
import type { ComposerHandle, ComposerInitial } from "../components/Composer";
import { whenIdle } from "../lib/lazy";
import { useKeys } from "../lib/keys";
import { isMailto, parseMailto } from "../lib/mailto";
import { useIsMobile } from "@/hooks/use-mobile";

// The composer is the heaviest thing that is not a page — editor, recipients, attachments, the
// scheduling picker — and most sessions never open it. Each form factor gets its own chunk,
// fetched in idle time so the first ⌘N still opens instantly.
const loadComposer = () => import("../components/Composer");
const loadMobileComposer = () => import("../mobile/MobileComposer");
const Composer = lazy(() => loadComposer().then((m) => ({ default: m.Composer })));
const MobileComposer = lazy(() => loadMobileComposer().then((m) => ({ default: m.MobileComposer })));

interface Ctx {
  openCompose: (initial?: ComposerInitial) => void;
  closeCompose: () => void;
  queueSend: (payload: SendPayload, undoSeconds: number) => void;
  /** A message in the Outbox: try it now, or open it to change it first. */
  retryUnsent: (id: string) => void;
  editUnsent: (id: string) => void;
}
const C = createContext<Ctx>({ openCompose: () => {}, closeCompose: () => {}, queueSend: () => {}, retryUnsent: () => {}, editUnsent: () => {} });

const asError = (e: unknown) => ({ status: e instanceof ApiError ? e.status : undefined, message: (e as Error)?.message || "Couldn't send" });

interface Pending {
  id: number;
  payload: SendPayload;
  until: number;
  toastId: string | number;
}

/**
 * Where the main area is, so the composer can fill exactly that: below the header and tabs, across the width the page has (less
 * the assistant when it is docked). Measured on open and kept in step with the window and with scrolling.
 */
function useMainArea(on: boolean) {
  const [area, setArea] = useState<{ top: number; left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!on) return;
    const inset = document.querySelector("main")?.parentElement ?? null;
    const measure = () => {
      const header = document.querySelector("header.sticky");
      const r = inset?.getBoundingClientRect();
      setArea({ top: header ? Math.max(0, header.getBoundingClientRect().bottom) : 0, left: r?.left ?? 0, right: r ? Math.max(0, window.innerWidth - r.right) : 0 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const ro = inset ? new ResizeObserver(measure) : null;
    if (inset) ro?.observe(inset);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro?.disconnect();
    };
  }, [on]);
  return area;
}

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ key: number; initial: ComposerInitial } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<number | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const qc = useQueryClient();

  const fire = useCallback(
    async (p: Pending) => {
      setPending(null);
      toast.dismiss(p.toastId);
      try {
        await sendMail(p.payload);
        toast.success("Sent");
        invalidateMail(qc);
        qc.invalidateQueries({ queryKey: ["drafts"] });
      } catch (e) {
        // Not lost: it goes in the Outbox (the chip in the header), and a failure that can pass is tried again by itself.
        const err = asError(e);
        outbox.add(p.payload as unknown as OutboxPayload, p.payload.client_id ?? String(p.id), err);
        // On a phone it waits behind the chip in the Imbox title row, and the Imbox tab shows a dot.
        const where = window.matchMedia?.("(max-width: 767px)").matches ? "the chip on the Imbox tab" : "the banner at the top";
        toast.error("Couldn't send", {
          description: isTransient(err) ? `Trying again by itself. You can follow it in ${where}.` : `${friendlyError(err.message)} You can follow it in ${where}.`,
          duration: 6000,
        });
      }
    },
    [qc],
  );

  // One try at a message in the Outbox. An automatic try that fails for a reason that can pass schedules the next; anything else waits for the person.
  const inflight = useRef(new Set<string>());
  const attempt = useCallback(
    async (id: string, automatic: boolean) => {
      const it = outbox.get().find((i) => i.id === id);
      if (!it || inflight.current.has(id)) return;
      inflight.current.add(id);
      outbox.update(id, { state: "sending", nextAt: null });
      try {
        await sendMail(it.payload as unknown as SendPayload);
        outbox.remove(id);
        toast.success(`Sent “${it.subject}”`);
        invalidateMail(qc);
        qc.invalidateQueries({ queryKey: ["drafts"] });
      } catch (e) {
        outbox.failed(id, asError(e), automatic);
      } finally {
        inflight.current.delete(id);
      }
    },
    [qc],
  );
  useEffect(() => {
    const tick = window.setInterval(() => {
      const t = Date.now();
      for (const it of outbox.get()) if (it.state === "retrying" && (it.nextAt ?? 0) <= t) void attempt(it.id, true);
    }, 1000);
    return () => window.clearInterval(tick);
  }, [attempt]);
  const retryUnsent = useCallback((id: string) => void attempt(id, false), [attempt]);
  const editUnsent = useCallback((id: string) => {
    const it = outbox.get().find((i) => i.id === id);
    if (!it) return;
    outbox.remove(id);
    const { client_id: _same, ...rest } = it.payload;
    setOpen({ key: Date.now(), initial: { ...(rest as unknown as SendPayload), title: "Unsent message" } });
  }, []);

  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const undo = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    if (timer.current) window.clearTimeout(timer.current);
    setPending(null);
    toast.dismiss(p.toastId);
    setOpen({ key: Date.now(), initial: { ...p.payload, title: "Unsent message" } });
  }, []);

  const queueSend = useCallback<Ctx["queueSend"]>(
    (payload, undoSeconds) => {
      if (timer.current) window.clearTimeout(timer.current);
      // One id for this send, kept on every retry of it, so the server never sends the same message twice.
      payload = { ...payload, client_id: payload.client_id ?? crypto.randomUUID() };
      const secs = Math.max(0, undoSeconds);
      if (secs <= 0) {
        fire({ id: Date.now(), payload, until: Date.now(), toastId: -1 });
        return;
      }
      const toastId = toast("Sending…", {
        description: `Press q to undo within ${secs}s.`,
        duration: secs * 1000,
        action: { label: "Undo", onClick: () => undo() },
      });
      const p: Pending = { id: Date.now(), payload, until: Date.now() + secs * 1000, toastId };
      setPending(p);
      timer.current = window.setTimeout(() => fire(p), secs * 1000);
    },
    [fire, undo],
  );

  // Send pending immediately if the tab is closing.
  useEffect(() => {
    const h = () => {
      const p = pendingRef.current;
      if (p) {
        if (timer.current) window.clearTimeout(timer.current);
        navigator.sendBeacon?.("/api/send", new Blob([JSON.stringify(p.payload)], { type: "application/json" }));
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  useKeys({ q: () => undo() }, !!pending);

  const openRef = useRef(open);
  openRef.current = open;
  const openCompose = useCallback((initial: ComposerInitial = {}) => {
    // Starting another message while one is open keeps the first as a draft rather than throwing it away.
    const c = composer.current;
    if (openRef.current && c && !c.isEmpty()) void c.saveAndClose().then(() => setOpen({ key: Date.now(), initial }));
    else setOpen({ key: Date.now(), initial });
  }, []);
  const closeCompose = useCallback(() => setOpen(null), []);
  // A mailto: link anywhere in the app writes the message here, in the composer, rather than in whatever mail program the system would pick.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = a?.getAttribute("href");
      if (!href || !isMailto(href)) return;
      e.preventDefault();
      openCompose(parseMailto(href));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [openCompose]);
  const requestClose = useCallback(() => {
    if (composer.current) composer.current.saveAndClose();
    else setOpen(null);
  }, []);

  const area = useMainArea(!!open);
  const title = open?.initial.title || (open?.initial.thread_id ? "Reply" : "New message");
  const mobile = useIsMobile();
  useEffect(() => {
    whenIdle(() => void (mobile ? loadMobileComposer() : loadComposer()).catch(() => {}));
  }, [mobile]);

  if (mobile) {
    return (
      <C.Provider value={{ openCompose, closeCompose, queueSend, retryUnsent, editUnsent }}>
        {children}
        <Suspense fallback={null}>
          <MobileComposer open={open} composerRef={composer} title={title} onRequestClose={requestClose} onClose={closeCompose} />
        </Suspense>
      </C.Provider>
    );
  }

  return (
    <C.Provider value={{ openCompose, closeCompose, queueSend, retryUnsent, editUnsent }}>
      {children}
      {open && area && (
        // A message opened on its own fills the main area: a quiet page to write on, under the header and tabs. Replies in a thread stay in the thread.
        <div
          role="dialog"
          aria-modal="false"
          aria-label={title}
          data-composer-page
          className="fixed bottom-0 z-40 bg-background animate-in fade-in-0 duration-150"
          style={{ top: area.top, left: area.left, right: area.right }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            // A menu, date picker or dialog inside the page takes Escape first.
            if (document.querySelector('[role="menu"],[role="listbox"],[role="alertdialog"],[data-slot="popover-content"],[data-slot="select-content"]')) return;
            e.preventDefault();
            e.stopPropagation();
            requestClose();
          }}
        >
          <Suspense fallback={null}>
            <Composer key={open.key} ref={composer} page initial={open.initial} onDone={closeCompose} onCancel={closeCompose} />
          </Suspense>
        </div>
      )}
    </C.Provider>
  );
}

export function useCompose() {
  return useContext(C);
}
