import { MAX_LINES } from "./read";

export interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Unfold per RFC 5545 §3.1: a CRLF (or bare LF, which plenty of feeds emit) followed by a space or
 * tab continues the previous line, and the whitespace itself is not content.
 */
export function unfold(text: string): string[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    let j = src.indexOf("\n", i);
    if (j < 0) j = n;
    let end = j;
    if (end > i && src.charCodeAt(end - 1) === 13) end--; // trailing CR
    const chunk = src.slice(i, end);
    if (chunk.length && (chunk[0] === " " || chunk[0] === "\t")) {
      buf += chunk.slice(1);
    } else {
      if (buf) out.push(buf);
      buf = chunk;
    }
    if (out.length > MAX_LINES) break;
    i = j + 1;
  }
  if (buf) out.push(buf);
  return out;
}

/** NAME;PARAM=VAL;PARAM="quoted,val":VALUE — quoted parameter values may hold ':' and ';'. */
export function splitLine(line: string): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segs: string[] = [];
  let buf = "";
  quoted = false;
  for (const c of head) {
    if (c === '"') {
      quoted = !quoted;
      buf += c;
    } else if (c === ";" && !quoted) {
      segs.push(buf);
      buf = "";
    } else buf += c;
  }
  segs.push(buf);

  let name = (segs.shift() ?? "").trim().toUpperCase();
  const dot = name.lastIndexOf("."); // strip an RFC 5545 property group ("cal.SUMMARY")
  if (dot >= 0) name = name.slice(dot + 1);
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const seg of segs) {
    const eq = seg.indexOf("=");
    if (eq < 0) {
      const bare = seg.trim();
      if (bare) params[bare.toUpperCase()] = "";
      continue;
    }
    const k = seg.slice(0, eq).trim().toUpperCase();
    let v = seg.slice(eq + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (k) params[k] = v;
  }
  return { name, params, value };
}

/** TEXT unescaping: \n \N → newline, \, \; \\ → the literal character. */
export function unesc(s: string): string {
  if (s.indexOf("\\") < 0) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const next = s[++i];
    if (next === undefined) out += "\\";
    else if (next === "n" || next === "N") out += "\n";
    else out += next;
  }
  return out;
}

/** The inverse of {@link unesc}; backslashes first or we'd escape our own escapes. */
export function esc(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** ISO 8601 duration → ms. Handles P1DT2H30M, PT15M, P2W and a leading sign. */
export function parseDuration(raw: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw.trim().toUpperCase());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  if (!w && !d && !h && !mi && !s) return 0;
  const ms = (+(w ?? 0) * 604800 + +(d ?? 0) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}
