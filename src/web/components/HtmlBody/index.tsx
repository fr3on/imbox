import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeEmailHtml } from "../../lib/sanitizeHtml";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { textToHtml } from "../../lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { openExternalUrl } from "../../lib/native";
import { findRemoteImages } from "../../lib/remoteImages";
import { useAccount } from "../../context/AccountContext";
import { useMeMutations } from "../../api";
import { useCompose } from "../../context/ComposeContext";
import { isMailto, parseMailto } from "../../lib/mailto";
import { BrandIcon } from "../BrandIcons";
import { enhanceCautionBanners, enhanceSensitivityLabels } from "./banners";
import { paintsOwnBackground, relightForDarkPage } from "./color";
import { enhanceMeetingInvites } from "./meeting";
import { ImageNotice, TrackerNotice } from "./notices";
import { enhanceGmailQuotes, QUOTE_SELECTOR, wrapOutlookQuotes } from "./quotes";
import { baseStyle } from "./style";
import { useTheme } from "./theme";

export { sanitizeEmailHtml };
// The pieces below are public so the tests reach them through the file's old path.
export { enhanceCautionBanners, enhanceSensitivityLabels } from "./banners";
export { contrastRatio, paintsOwnBackground, relightForDarkPage } from "./color";
export { enhanceMeetingInvites } from "./meeting";
export { trackerLabel } from "./notices";
export { enhanceGmailQuotes, wrapOutlookQuotes } from "./quotes";
export { baseStyle } from "./style";

/** Renders email HTML in a sandboxed iframe that auto-sizes to its content. */
export function HtmlBody({
  html,
  text,
  trackers = [],
  onClip,
  plain,
  sender,
  collapseQuotes = true,
  className,
}: {
  html: string;
  text?: string;
  trackers?: string[];
  onClip?: (text: string) => void;
  plain?: boolean;
  /** Who sent the message. Lets the reader always show images from this sender. */
  sender?: string;
  /** Hide the quoted history of the thread behind a "Show quoted text" toggle. */
  collapseQuotes?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(48);
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const selRef = useRef<{ text: string; x: number; y: number } | null>(null);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;
  const isInteractingWithClipRef = useRef(false);
  const [quoted, setQuoted] = useState<{ count: number; shown: boolean; hasInline?: boolean }>({ count: 0, shown: false });
  const theme = useTheme();
  const { user } = useAccount();
  const { update } = useMeMutations();
  // The click handler is set up once for the frame, so it reads the current opener through a ref.
  const { openCompose } = useCompose();
  const openComposeRef = useRef(openCompose);
  openComposeRef.current = openCompose;

  useEffect(() => {
    if (!sel) return;
    const onWindowPointerDown = (e: MouseEvent | PointerEvent) => {
      if (isInteractingWithClipRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".save-clip-btn")) return;
      setSel(null);
      selRef.current = null;
    };
    window.addEventListener("pointerdown", onWindowPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown);
    };
  }, [sel]);
  const [shown, setShown] = useState(false);
  const senderKey = (sender ?? "").trim().toLowerCase();
  const savedSenders = user?.settings?.imageSenders ?? [];
  const trusted = !!senderKey && savedSenders.some((x) => x.toLowerCase() === senderKey);
  // Images from other servers tell the sender the mail was opened, so they stay blocked until the reader asks.
  const loadImages = shown || trusted;
  const saveSenders = (next: string[]) => update.mutate({ settings: { ...(user?.settings ?? {}), imageSenders: next } });

  const usePlain = plain || !html;
  const remote = useMemo(() => (usePlain ? { count: 0, hosts: [] as string[] } : findRemoteImages(html)), [html, usePlain]);
  const ownBg = !usePlain && paintsOwnBackground(html);
  // Painted emails get a light slab only in dark mode; everything else sits directly on the page.
  const slab = ownBg && theme.dark;

  const srcdoc = useMemo(() => {
    const body = usePlain ? `<div style="white-space:pre-wrap">${sanitizeEmailHtml(textToHtml(text || ""))}</div>` : sanitizeEmailHtml(html);
    // The frame may show nothing from another server unless images are allowed. This holds even for images the detector above misses.
    const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; img-src ${loadImages ? "* data: blob:" : "data: blob: 'self'"}`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width"><style>${baseStyle(theme, ownBg)}</style></head><body>${body}</body></html>`;
  }, [html, text, usePlain, ownBg, theme, loadImages]);

  const resize = useCallback(() => {
    const frame = ref.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;
    // Mail written for a full window (min-height:100vh, content centred) grows with the frame. Measuring while the frame is full height would see its own last size and add 2px each time, so the message crept downward. Measure at zero height, then put the height back before anything paints.
    const prev = frame.style.height;
    frame.style.height = "0px";
    const h = Math.max(doc.body.getBoundingClientRect().height, doc.body.offsetHeight, doc.body.scrollHeight);
    frame.style.height = prev;
    if (h > 0) setHeight(Math.min(Math.ceil(h) + 2, 20000));
  }, []);

  const applyQuotes = useCallback((show: boolean) => {
    const doc = ref.current?.contentDocument;
    if (!doc) return 0;
    const nodes = Array.from(doc.querySelectorAll<HTMLElement>(QUOTE_SELECTOR));
    const top = nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));
    for (const n of top) n.classList.toggle("imbox-quoted-hidden", !show);
    doc.querySelectorAll<HTMLElement>(".inline-fold-btn").forEach((btn) => {
      btn.classList.toggle("is-open", show);
      btn.setAttribute("aria-expanded", show ? "true" : "false");
      const title = btn.querySelector(".fold-title");
      const s = btn.getAttribute("data-sender") || "";
      const action = btn.getAttribute("data-action") || "Quoted";
      if (title) {
        title.textContent = show ? `Hide ${action.toLowerCase()} message${s ? ` from ${s}` : ""}` : `${action} message${s ? ` from ${s}` : ""}`;
      }
    });
    return top.length;
  }, []);

  const onLoad = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    // Only for messages sitting on our dark page; painted ones already have their light slab.
    if (theme.dark && !ownBg && !usePlain) relightForDarkPage(doc, theme.bg, theme.fg);

    // Enhance content before quote collapsing
    wrapOutlookQuotes(doc);
    enhanceGmailQuotes(doc);
    if (!usePlain) {
      enhanceMeetingInvites(doc);
    }
    if (!usePlain) {
      enhanceCautionBanners(doc);
      enhanceSensitivityLabels(doc);
    }

    if (collapseQuotes) {
      // Start collapsed: pass the *current* state, not its inverse (that left the quotes visible
      // while the button still said "Show quoted text", so the first click appeared to do nothing).
      const count = applyQuotes(quoted.shown);
      const hasInline = !!doc.querySelector(".inline-fold-bar");
      setQuoted((q) => ({ count, shown: q.shown, hasInline }));
    }

    resize();
    setReady(true);
    try {
      const ro = new ResizeObserver(() => resize());
      if (doc.body) ro.observe(doc.body);
    } catch {
      /* ignore */
    }
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", resize));
    setTimeout(resize, 300);
    setTimeout(resize, 1500);

    doc.addEventListener("toggle", (e) => {
      if ((e.target as HTMLElement)?.tagName === "DETAILS") {
        setTimeout(resize, 30);
      }
    }, true);

    const handleSelection = () => {
      if (isInteractingWithClipRef.current) return;
      if (!onClipRef.current) {
        setSel(null);
        selRef.current = null;
        return;
      }
      const s = doc.getSelection();
      const t = s?.toString().trim() ?? "";
      if (!t || !s || s.rangeCount === 0) {
        setSel(null);
        selRef.current = null;
        return;
      }
      const range = s.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setSel(null);
        selRef.current = null;
        return;
      }
      const iframeRect = ref.current?.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!iframeRect || !containerRect) return;

      const x = iframeRect.left + rect.left + rect.width / 2 - containerRect.left;
      const y = iframeRect.top + rect.top - containerRect.top;
      const next = { text: t, x, y };
      selRef.current = next;
      setSel(next);
    };
    doc.addEventListener("selectionchange", handleSelection);
    doc.addEventListener("mouseup", handleSelection);

    // Links inside the sandbox can't navigate the top frame, and the Mac webview swallows
    // window.open — so intercept the click and hand the URL to the system browser.
    doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
    doc.addEventListener("click", (ev) => {
      // Option A: Inline quote fold toggle
      const foldBtn = (ev.target as HTMLElement | null)?.closest?.(".inline-fold-btn") as HTMLElement | null;
      if (foldBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const foldBar = foldBtn.closest(".inline-fold-bar");
        const quoteTarget = foldBar?.nextElementSibling as HTMLElement | null;
        if (quoteTarget) {
          const isHidden = quoteTarget.classList.contains("imbox-quoted-hidden");
          quoteTarget.classList.toggle("imbox-quoted-hidden", !isHidden);
          foldBtn.classList.toggle("is-open", isHidden);
          foldBtn.setAttribute("aria-expanded", isHidden ? "true" : "false");
          const title = foldBtn.querySelector(".fold-title");
          const s = foldBtn.getAttribute("data-sender") || "";
          const action = foldBtn.getAttribute("data-action") || "Quoted";
          if (title) {
            title.textContent = isHidden ? `Hide ${action.toLowerCase()} message${s ? ` from ${s}` : ""}` : `${action} message${s ? ` from ${s}` : ""}`;
          }
          setQuoted((q) => ({ ...q, shown: isHidden }));
          setTimeout(resize, 30);
        }
        return;
      }


      const copyBtn = (ev.target as HTMLElement | null)?.closest?.(".strip-copy-btn") as HTMLElement | null;
      if (copyBtn) {
        ev.preventDefault();
        ev.stopPropagation();
        const val = copyBtn.getAttribute("data-copy") || "";
        navigator.clipboard?.writeText(val);
        const orig = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = orig; }, 1200);
        return;
      }

      const target = ev.target as HTMLElement | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const raw = (a.getAttribute("href") ?? "").trim();
      if (!raw || raw.startsWith("#") || /^(javascript|data|cid|blob):/i.test(raw)) {
        ev.preventDefault();
        return;
      }
      let href: string;
      if (isMailto(raw)) {
        // An address in the message: write to it here, not in the system's mail program.
        ev.preventDefault();
        openComposeRef.current(parseMailto(raw));
        return;
      }
      if (/^tel:/i.test(raw)) {
        href = raw;
      } else {
        try {
          href = new URL(raw, location.href).toString();
        } catch {
          ev.preventDefault();
          return;
        }
      }
      ev.preventDefault();
      openExternalUrl(href);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize, onClip, collapseQuotes, usePlain, applyQuotes, theme, ownBg]);

  useEffect(() => {
    const onWin = () => resize();
    window.addEventListener("resize", onWin);
    return () => window.removeEventListener("resize", onWin);
  }, [resize]);

  const toggleQuotes = () => {
    const show = !quoted.shown;
    applyQuotes(show);
    setQuoted((q) => ({ ...q, shown: show }));
    setTimeout(resize, 30);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {trackers.length > 0 && <TrackerNotice trackers={trackers} />}
      {remote.count > 0 && <ImageNotice remote={remote} loadImages={loadImages} trusted={trusted} senderKey={senderKey} savedSenders={savedSenders} setShown={setShown} saveSenders={saveSenders} />}
      <div className={cn("relative overflow-hidden", slab && "rounded-md bg-white px-3 py-2", !ready && "opacity-0")} style={{ minHeight: ready ? undefined : 48 }}>
        <iframe
          ref={ref}
          title="message"
          className="email-body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcdoc}
          onLoad={onLoad}
          style={{ height, colorScheme: slab ? "light" : "normal" }}
        />
      </div>
      {!ready && (
        <div className="absolute inset-x-0 top-0 space-y-2 pt-1">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      )}
      {quoted.count > 0 && !quoted.hasInline && (
        <Button variant="ghost" size="xs" className="mt-2 text-muted-foreground" onClick={toggleQuotes}>
          <ChevronDown className={cn("transition-transform", quoted.shown && "rotate-180")} />
          {quoted.shown ? "Hide quoted text" : "Show quoted text"}
        </Button>
      )}
      {sel && onClip && (
        <Button
          size="xs"
          className="save-clip-btn absolute z-10 -translate-x-1/2 -translate-y-full shadow-md"
          style={{ left: sel.x, top: Math.max(sel.y - 6, 0) }}
          onPointerDown={() => {
            isInteractingWithClipRef.current = true;
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            isInteractingWithClipRef.current = true;
          }}
          onPointerLeave={() => {
            isInteractingWithClipRef.current = false;
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const textToSave = selRef.current?.text || sel?.text;
            if (textToSave && onClipRef.current) {
              onClipRef.current(textToSave);
            }
            setSel(null);
            selRef.current = null;
            isInteractingWithClipRef.current = false;
            try {
              ref.current?.contentDocument?.getSelection()?.removeAllRanges();
            } catch {}
          }}
        >
          <BrandIcon name="clips" /> Save clip
        </Button>
      )}
    </div>
  );
}
