import * as React from "react";
import { useEffect, useState } from "react";

/** Keeps a fixed element horizontally centered within the <main> column rather than the viewport. */
export function useMainColumn() {
  const [pos, setPos] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const upd = () => {
      // `main` here is the SidebarInset (it renders a <main>); use its content box so a docked assistant's padding counts.
      const r = main.getBoundingClientRect();
      const cs = getComputedStyle(main);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      setPos({ left: r.left + padL, width: Math.max(320, r.width - padL - padR) });
    };
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(main);
    window.addEventListener("resize", upd);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", upd);
    };
  }, []);
  return pos ? { ...pos, compact: false } : pos;
}

/**
 * Once the title has scrolled up under the app's header, the pixel row where that header ends (so a slim bar can sit right beneath it);
 * null while the title is still in view. The header's height differs between layouts and screen sizes, so it is measured, not assumed.
 */
export function useTitleUnderHeader(ref: React.RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const el = ref.current;
      const header = document.querySelector<HTMLElement>("header.sticky");
      if (!el || !header) return;
      const bottom = Math.round(header.getBoundingClientRect().bottom);
      setTop(el.getBoundingClientRect().bottom < bottom ? bottom : null);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [ref, enabled]);
  return top;
}

/** Where the main column sits in the window, once it has been measured. */
export type MainColumn = NonNullable<ReturnType<typeof useMainColumn>>;
