// The colour arithmetic that decides whether a sender's text can be read on the page it is shown on.

/** True when the email paints its own backgrounds; then dark mode must not recolor it. */
export function paintsOwnBackground(html: string): boolean {
  return /background(?:-color)?\s*:\s*(?!transparent|inherit|none)[^;"']+/i.test(html) || /\bbgcolor\s*=/i.test(html);
}

/** `#rrggbb`, `#rgb`, `rgb()` and `rgba()` to channels, compositing any alpha over `over`. */
function parseColor(c: string, over?: [number, number, number]): [number, number, number] | null {
  const hex = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const n = c.match(/-?\d*\.?\d+/g);
  if (!n || n.length < 3) return null;
  const [r, g, b] = n.slice(0, 3).map(Number);
  const a = n.length > 3 ? Number(n[3]) : 1;
  if (a >= 1 || !over) return [r, g, b];
  return [r, g, b].map((v, i) => v * a + over[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio: 1 is invisible, 21 is black on white. */
export function contrastRatio(a: string, b: string): number {
  const back = parseColor(b);
  const front = parseColor(a, back ?? undefined);
  if (!front || !back) return 21;
  const [x, y] = [luminance(front), luminance(back)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The line between "dim" and "gone". Deliberately below AA's 4.5: a sender's blue at 3.9 is
 * still readable and still theirs, while the black that prompted this sits at 1.2. Repainting
 * everything that merely falls short of AA would throw away colour the sender chose.
 */
const READABLE = 3;

/**
 * Senders write for a white page. A message that paints its own background gets a light slab,
 * but one that only sets text colours — `color:#000` on a paragraph, a `<font color>` — lands
 * on our dark page still wearing black, and disappears.
 *
 * Every element that names its own colour (it differs from the one it inherits, whatever the
 * source: inline, a `<style>` block, an attribute) is checked against the page it is being
 * read on. Anything that cannot be read there gives up its colour and takes ours. Colours that
 * are legible — a brand blue, a link, our own muted quote grey — are left alone.
 */
export function relightForDarkPage(doc: Document, pageBackground: string, foreground: string): number {
  let changed = 0;
  const colorOf = (el: Element) => doc.defaultView?.getComputedStyle(el).color ?? "";
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    const own = colorOf(el);
    if (!own) continue;
    const parent = el.parentElement;
    // Inherited text is already ours; only a colour the sender chose is worth second-guessing.
    if (parent && colorOf(parent) === own) continue;
    if (contrastRatio(own, pageBackground) >= READABLE) continue;
    el.style.setProperty("color", foreground, "important");
    changed += 1;
  }
  return changed;
}
