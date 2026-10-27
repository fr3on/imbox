import { type KeyboardEvent, type FormEvent, type RefObject, useCallback, useEffect, useRef } from "react";
import { request } from "../../api/client";
import { askable, GHOST_ATTR, plainContext, plainText, spaced } from "./ghost";

// Grey words after the caret that finish the sentence being typed in a reply. Tab (or a tap on them) takes them; anything else clears them.
// They are a span inside the editor, so whatever reads the body for saving or sending strips them first (stripGhost).

const PAUSE_MS = 700;
const BLOCK = /^(BR|DIV|P|UL|OL|LI|BLOCKQUOTE)$/;

/** Only offer words when the caret is at the end of its line: a suggestion in the middle of a sentence would push text along. */
function atLineEnd(r: Range): boolean {
  const n = r.endContainer;
  if (n.nodeType === Node.TEXT_NODE && (n as Text).length > r.endOffset) return false;
  let next: ChildNode | null = n.nodeType === Node.TEXT_NODE ? n.nextSibling : n.childNodes[r.endOffset] ?? null;
  // Splitting text to put the grey words in leaves empty pieces behind; they are not more text.
  while (next && next.nodeType === Node.TEXT_NODE && (next as Text).length === 0) next = next.nextSibling;
  return !next || (next.nodeType === Node.ELEMENT_NODE && BLOCK.test((next as Element).tagName));
}

export function useReplyCompletion(bodyRef: RefObject<HTMLDivElement | null>, opts: { enabled: boolean; subject: string; to: string; quotedHtml: string }) {
  const latest = useRef(opts);
  latest.current = opts;
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const taken = useRef(false);

  const ghost = useCallback(() => bodyRef.current?.querySelector<HTMLElement>(`[${GHOST_ATTR}]`) ?? null, [bodyRef]);

  // Bumping seq also drops any answer still on its way.
  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    seq.current++;
    const g = ghost();
    if (!g) return;
    g.remove();
    bodyRef.current?.normalize();
  }, [bodyRef, ghost]);

  const accept = useCallback(() => {
    const g = ghost();
    if (!g) return;
    const text = document.createTextNode(g.textContent ?? "");
    g.replaceWith(text);
    const r = document.createRange();
    r.setStart(text, text.length);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    bodyRef.current?.normalize();
    // Taking words is typing as far as saving the draft goes, but it should not start another suggestion.
    taken.current = true;
    bodyRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [bodyRef, ghost]);

  const show = useCallback((words: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    const span = document.createElement("span");
    span.setAttribute(GHOST_ATTR, "1");
    span.contentEditable = "false";
    span.className = "text-tertiary cursor-pointer select-none";
    span.title = "Tab to add";
    span.textContent = words;
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      accept();
    });
    r.insertNode(span);
    const back = document.createRange();
    back.setStartBefore(span);
    back.collapse(true);
    sel.removeAllRanges();
    sel.addRange(back);
  }, [accept]);

  const ask = useCallback(async () => {
    const el = bodyRef.current;
    const sel = window.getSelection();
    if (!el || !sel?.isCollapsed || sel.rangeCount === 0 || document.activeElement !== el || !el.contains(sel.anchorNode) || ghost()) return;
    const caret = sel.getRangeAt(0);
    if (!atLineEnd(caret)) return;
    const upTo = document.createRange();
    upTo.selectNodeContents(el);
    upTo.setEnd(caret.endContainer, caret.endOffset);
    const holder = document.createElement("div");
    holder.appendChild(upTo.cloneContents());
    // Text trims its ends; whether a space was just typed is what decides the spacing of what comes next.
    const before = plainText(holder.innerHTML) + (/[  ]$/.test(upTo.toString()) ? " " : "");
    if (!askable(before)) return;
    const mine = ++seq.current;
    const o = latest.current;
    try {
      const r = await request<{ text: string }>("POST", "/api/ai/complete", { before: before.slice(-1500), context: plainContext(o.quotedHtml), subject: o.subject, to: o.to });
      if (mine !== seq.current || !r.text) return;
      const words = spaced(before, r.text);
      if (words) show(words);
    } catch {
      /* a missing suggestion is not worth a message */
    }
  }, [bodyRef, ghost, show]);

  useEffect(() => {
    if (!opts.enabled) clear();
  }, [opts.enabled, clear]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    clear,
    onInput: (e: FormEvent<HTMLDivElement>) => {
      if (!latest.current.enabled) return;
      clear();
      if (taken.current) {
        taken.current = false;
        return;
      }
      const ev = e.nativeEvent as InputEvent;
      // Deleting means they are changing their mind; composing (accents, Chinese, Japanese) is not finished text yet.
      if (ev.isComposing || ev.inputType?.startsWith("delete")) return;
      timer.current = window.setTimeout(ask, PAUSE_MS);
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (!ghost()) return;
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        accept();
        return;
      }
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      clear();
    },
  };
}
