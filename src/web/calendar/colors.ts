/**
 * A calendar's colour is the one place colour enters this otherwise monochrome UI. Events wear it
 * the way Apple Calendar draws them: a solid, near-opaque wash of the colour with white or near-
 * black title text, whichever the fill's own luminance calls for — not tinted by the app's own
 * light/dark theme, since the block's colour dominates either way. Only a tentative event stays a
 * light, hollow-feeling wash, so "unconfirmed" reads differently from "on the calendar."
 */
import { useSyncExternalStore } from "react";
import type { CalEvent } from "@shared/types";

/** What a calendar gets when it has no colour of its own. */
export const DEFAULT_COLOR = "#6b6b6b";

export function normalizeHex(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const v = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return null;
}

function rgb(hex: string | null | undefined): [number, number, number] {
  const h = normalizeHex(hex) ?? DEFAULT_COLOR;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** The colour at near-full alpha — a confirmed event's block/pill background, solid the way Apple Calendar draws it. */
export function eventFill(hex: string | null | undefined, alpha = 0.92): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A tentative event's fill: a light wash rather than solid, so "unconfirmed" reads differently from "on the calendar." */
export function eventTentativeFill(hex: string | null | undefined, alpha = 0.16): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The colour itself — the bar down the left edge, the dot in the month grid. */
export function eventBar(hex: string | null | undefined): string {
  return normalizeHex(hex) ?? DEFAULT_COLOR;
}

/** Relative luminance (WCAG), 0 (black) to 1 (white) — what decides whether a fill needs light or dark text. */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** White reads better than near-black once a fill gets this dark (the point where the two contrast ratios cross). */
const INK_SWITCH_L = 0.179;

/**
 * White or near-black, whichever a confirmed event's solid fill calls for — a solid orange block
 * wants dark text, a solid navy one wants white, regardless of whether the app itself is in light
 * or dark mode; the fill's own colour is what the text sits on, not the app's background.
 */
export function eventInk(hex: string | null | undefined): string {
  const [r, g, b] = rgb(hex);
  return luminance(r, g, b) > INK_SWITCH_L ? "#131313" : "#fbfbfa";
}

/** The colour mixed toward white (dark mode) or black (light mode) — text for a tentative event's light wash. */
export function eventTentativeInk(hex: string | null | undefined, dark: boolean): string {
  const [r, g, b] = rgb(hex);
  const mix = (c: number) => (dark ? c + (255 - c) * 0.25 : c * 0.75);
  return toHex(mix(r), mix(g), mix(b));
}

/** The colour of the first "Circle this day" event on a day, or null if it has none. */
export function circledColor(items: { allDay: CalEvent[]; timed: CalEvent[] }): string | null {
  const e = [...items.allDay, ...items.timed].find((e) => e.circled);
  return e ? eventBar(e.calendar_color) : null;
}

// ---------- Dark mode ----------

/** The app's theme is the `dark` class on <html>; one observer serves every subscriber. */
const listeners = new Set<() => void>();
let observing = false;
function subscribe(l: () => void) {
  listeners.add(l);
  if (!observing && typeof MutationObserver !== "undefined") {
    observing = true;
    new MutationObserver(() => listeners.forEach((f) => f())).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  return () => {
    listeners.delete(l);
  };
}
function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

/** True while the app is in dark mode. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
