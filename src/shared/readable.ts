// Turning the plain-text body of an email into something a person (or a model) can read at a glance. Most mail that is not from a
// person is padded with link addresses, image placeholders, dividers and footers; this takes those out and keeps the words.

/** Lines that are the furniture around a message, not the message. Some phrases only ever appear in furniture; others are also ordinary words. */
const SURE_FURNITURE = /(view (this )?(email |message )?(in|online in) ?(a |your )?browser|trouble (viewing|reading)|you(?:'| a)re receiving this|sent (to|by) .{0,40}because|all rights reserved|©\s?\d{4}|\(c\)\s?\d{4})/i;
const MAYBE_FURNITURE = /\b(unsubscribe|manage (your )?(email |notification )?(preferences|subscriptions?)|update (your )?(email )?preferences|privacy (policy|notice)|terms (of|&) (service|use))\b/i;
const isFurniture = (l: string) => (l.length < 160 && SURE_FURNITURE.test(l)) || (l.length <= 70 && !/[,;]/.test(l) && MAYBE_FURNITURE.test(l));

/** Where the footer starts when the whole body is one line: the first of these, once there is real text before it. */
const FOOTER_STARTS = /\b(unsubscribe|manage (your )?(email |notification )?(preferences|subscriptions?)|view (this )?(email )?(in|online in) (your )?browser|you(?:'| a)re receiving this|privacy policy|(?:view|open) in [A-Z][\w.]+)\b/i;

export function readableText(raw: string): string {
  let t = (raw || "")
    .replace(/\r/g, "")
    .replace(/[\u200b-\u200f\u2060\u00ad\ufeff]|\u034f/g, "")
    .replace(/ |&nbsp;/g, " ");
  t = t
    // A link written out next to its text: "Jira [https://…]", "(https://…)", "<https://…>".
    .replace(/\[\s*(?:https?:\/\/|mailto:|www\.)[^\]\s]*\s*\]/gi, " ")
    .replace(/[(<]\s*(?:https?:\/\/|mailto:|www\.)[^)>\s]*\s*[)>]/gi, " ")
    // Image and attachment placeholders.
    .replace(/\[(?:image|cid|img)[^\]]*\]/gi, " ")
    // What is left of bare addresses.
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
    // Dividers.
    .replace(/[-=_*~#•·.]{4,}/g, " ");
  const lines = t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(">") && !isFurniture(l));
  let out = lines.join(" ").replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  const f = FOOTER_STARTS.exec(out);
  // A footer that shares a line with the message: keep what came before it (and only if that is more than a stray word or two).
  if (f && f.index >= 60) out = out.slice(0, f.index).replace(/[\s|·•\-–—,;:]+$/, "").trim();
  return out;
}

/** The start of a message as readable text, cut at a word. */
export function readableExcerpt(raw: string, max = 240): string {
  const t = readableText(raw);
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max);
  return `${t.slice(0, cut > max * 0.6 ? cut : max)}…`;
}
