import { useEffect } from "react";

/** Highlights query matches inside `root` using the CSS Custom Highlight API (no DOM edits). */
export function useTextHighlight(root: React.RefObject<HTMLElement | null>, words: string[], dep: unknown) {
  const key = words.join("\u0000");
  useEffect(() => {
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!H || !reg || !root.current || !words.length) return;
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      // Headings, tabs and buttons are the page, not the mail: "Mail & Messages" must not light up for a search about mail.
      if (node.parentElement?.closest("h1,h2,h3,button,[data-no-highlight]")) continue;
      const text = node.textContent?.toLowerCase() ?? "";
      for (const w of words) {
        let i = text.indexOf(w);
        while (i >= 0) {
          const r = new Range();
          r.setStart(node, i);
          r.setEnd(node, i + w.length);
          ranges.push(r);
          i = text.indexOf(w, i + w.length);
        }
      }
    }
    reg.set("imbox-search", new H(...ranges));
    return () => {
      reg.delete("imbox-search");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, key, dep]);
}
