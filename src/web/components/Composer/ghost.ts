import { MIN_COMPLETE_CHARS } from "@shared/aiFeatures";

// Pure parts of the grey "finish my sentence" text in a reply. The DOM side is in completion.ts.

export const GHOST_ATTR = "data-ghost";

/** The suggestion is shown inside the editor, so anything that reads the body for saving or sending drops it first. */
export function stripGhost(html: string): string {
  return html.replace(/<span data-ghost="1"[^>]*>[\s\S]*?<\/span>/g, "");
}

/** A suggestion is worth asking for once there is something to go on, and not right after a line break. */
export function askable(before: string): boolean {
  return before.trim().length >= MIN_COMPLETE_CHARS && !/\n\s*$/.test(before);
}

/** What goes in after what is typed: a space between words, none before punctuation or after one already there. */
export function spaced(before: string, text: string): string {
  const t = text.replace(/^\s+/, "");
  if (!t) return "";
  if (before === "" || /\s$/.test(before)) return t;
  return /^[.,;:!?)\]]/.test(t) ? t : ` ${t}`;
}

/** HTML as plain text, with a line break where a block ends. */
export function plainText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** The email being answered, for the model to read. Its start is the newest message, so that is the part kept. */
export function plainContext(html: string, max = 1500): string {
  return plainText(html).slice(0, max);
}
