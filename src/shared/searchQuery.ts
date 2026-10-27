// Turns what is typed in the search box into words and filters. Shared by the server (to find mail) and the page (to show filters as chips
// and to mark the words in the results), so the two always read a query the same way.

export interface ParsedSearch {
  /** Every word or "quoted phrase" that must appear. Each one may be in a different place in the message. */
  terms: string[];
  /** Words after a minus sign: mail containing them is left out. */
  excluded: string[];
  from: string;
  to: string;
  bucket: string;
  unread: boolean | null;
  hasAttachment: boolean;
  filename: string;
  /** Part of the address of the mailbox the mail arrived in. */
  mailbox: string;
  /** Milliseconds. */
  before: number | null;
  after: number | null;
}

/** One piece of the query the page can show as a chip and take back out: the exact text it came from, and how to say it. */
export interface QueryPiece {
  text: string;
  kind: "filter" | "exclude";
  label: string;
}

const DAY = 86_400_000;
const BUCKETS = new Set(["screener", "imbox", "updates", "feed", "paper_trail", "trash"]);

/** A date as typed: 2026-09-01, 2026-09, a word (today, yesterday, last-week, last-month, last-year), or an amount ago (7d, 2w, 3m, 1y). */
export function parseWhen(v: string, now: number): number | null {
  const s = v.toLowerCase();
  const day = new Date(now);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  if (s === "today") return start;
  if (s === "yesterday") return start - DAY;
  if (s === "this-week" || s === "thisweek") return start - ((day.getUTCDay() + 6) % 7) * DAY;
  if (s === "this-month" || s === "thismonth") return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1);
  if (s === "this-year" || s === "thisyear") return Date.UTC(day.getUTCFullYear(), 0, 1);
  if (s === "last-week" || s === "lastweek") return start - 7 * DAY;
  if (s === "last-month" || s === "lastmonth") return start - 30 * DAY;
  if (s === "last-year" || s === "lastyear") return start - 365 * DAY;
  const rel = /^(\d{1,3})([dwmy])$/.exec(s);
  if (rel) return start - Number(rel[1]) * { d: 1, w: 7, m: 30, y: 365 }[rel[2] as "d" | "w" | "m" | "y"] * DAY;
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (iso) {
    const t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3] ?? 1));
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

const TOKEN = /(-?)(?:([a-z]+):)?(?:"([^"]*)"|(\S+))/gi;

export function parseSearch(raw: string, now = Date.now()): { parsed: ParsedSearch; pieces: QueryPiece[] } {
  const p: ParsedSearch = { terms: [], excluded: [], from: "", to: "", bucket: "", unread: null, hasAttachment: false, filename: "", mailbox: "", before: null, after: null };
  const pieces: QueryPiece[] = [];
  for (const m of raw.matchAll(TOKEN)) {
    const [text, minus, op, quoted, bare] = m;
    const value = (quoted ?? bare ?? "").trim();
    const key = (op ?? "").toLowerCase();
    if (!value) continue;
    const piece = (label: string, kind: QueryPiece["kind"] = "filter") => pieces.push({ text, kind, label });
    if (!minus && key === "from") {
      p.from = value;
      piece(`from: ${value}`);
    } else if (!minus && key === "to") {
      p.to = value;
      piece(`to: ${value}`);
    } else if (!minus && key === "in" && BUCKETS.has(value.toLowerCase())) {
      p.bucket = value.toLowerCase();
      piece(`in: ${/^(updates|paper_trail)$/i.test(value) ? "feed" : value.toLowerCase()}`);
    } else if (!minus && key === "is" && (value === "unread" || value === "read")) {
      p.unread = value === "unread";
      piece(`is: ${value}`);
    } else if (!minus && key === "has" && (value === "attachment" || value === "file")) {
      p.hasAttachment = true;
      piece("has: file");
    } else if (!minus && key === "mailbox") {
      p.mailbox = value;
      piece(`mailbox: ${value}`);
    } else if (!minus && key === "filename") {
      p.filename = value;
      piece(`filename: ${value}`);
    } else if (!minus && (key === "before" || key === "after")) {
      const t = parseWhen(value, now);
      if (t === null) {
        // Not a date we know: treat the whole thing as ordinary words so nothing is silently dropped.
        p.terms.push(text);
        continue;
      }
      if (key === "before") p.before = t;
      else p.after = t;
      piece(`${key}: ${value}`);
    } else {
      // A word, a "quoted phrase", or something with a colon that is not an operator (a link, a time): kept whole.
      const word = key && !quoted ? `${key}:${value}` : value;
      if (minus) {
        p.excluded.push(word);
        piece(`not ${word}`, "exclude");
      } else p.terms.push(word);
    }
  }
  return { parsed: p, pieces };
}

/** The words worth marking in results: the terms, longest first, with nothing shorter than two letters. */
export function highlightTerms(parsed: ParsedSearch): string[] {
  return [...new Set(parsed.terms.map((t) => t.toLowerCase()).filter((t) => t.length > 1))].sort((a, b) => b.length - a.length);
}

/** The query with one piece taken out, ready to put back in the box. */
export function withoutPiece(raw: string, piece: QueryPiece): string {
  return raw.replace(piece.text, " ").replace(/\s{2,}/g, " ").trim();
}

/** Whether a search is a sentence rather than a few words to find: it has a question mark, or four or more plain words. Filler is then dropped from it. */
export function isNaturalLanguage(q: string): boolean {
  const plain = q.replace(/(^|\s)-?[a-z]+:\S+/gi, " ").trim();
  if (!plain) return false;
  return plain.includes("?") || plain.split(/\s+/).length >= 4;
}

const QUESTION_WORDS = new Set("who what when where which why how did do does is are was were has have had can could will would should".split(" "));

/** Whether a search asks something that an answer could be written for: "did Priya approve the plan?", not "help me find the Rajhi mail". */
export function looksLikeQuestion(q: string): boolean {
  const plain = q.replace(/(^|\s)-?[a-z]+:\S+/gi, " ").trim();
  if (!plain) return false;
  const words = plain.split(/\s+/);
  return plain.includes("?") || (words.length >= 3 && QUESTION_WORDS.has(words[0].toLowerCase()));
}

// Filler, and the words people use to ask a mail program for something. In a mail search "mail" and "help" say nothing about which mail.
const STOP = new Set(
  ("a an and are as at be by did do does for from get got had has have how i if in is it its me my of on or our so than that the their them then there these they this to us was we were what when where which who why will with would you your about any can could should " +
    "all every some please help find show search look looking give list tell want need mail mails email emails message messages latest recent").split(" ")
);

/** The words of a question worth looking for: no filler, no punctuation. Filters and "quoted phrases" stay as typed. */
export function contentWords(question: string): string {
  const out: string[] = [];
  for (const m of question.matchAll(TOKEN)) {
    const [text, minus, op, quoted, bare] = m;
    if (op || quoted !== undefined) {
      out.push(text);
      continue;
    }
    const w = (bare ?? "").replace(/[?!.,;:()]+/g, "");
    if (w && (minus || !STOP.has(w.toLowerCase()))) out.push(`${minus}${w}`);
  }
  return out.join(" ");
}

/** For a question, the sets of words to try in turn: all of them, then every smaller set (longest words first), as many as MAX_TRIES allows. */
const MAX_TRIES = 12;
export function relaxedTerms(terms: string[]): string[][] {
  const out: string[][] = [terms];
  for (let k = terms.length - 1; k >= 1 && out.length < MAX_TRIES; k--) {
    const combos: string[][] = [];
    const walk = (from: number, acc: string[]) => {
      if (acc.length === k) return void combos.push(acc);
      for (let i = from; i < terms.length; i++) walk(i + 1, [...acc, terms[i]]);
    };
    walk(0, []);
    combos.sort((a, b) => b.join("").length - a.join("").length);
    for (const c of combos) if (out.length < MAX_TRIES) out.push(c);
  }
  return out;
}

// ---- Editing the query from the filter buttons ----

/** The text of a filter piece: `from:priya`, or `from:"Harbor Bank"` when the value has a space. */
export function filterText(key: string, value: string): string {
  const v = value.replace(/"/g, "").trim();
  return /\s/.test(v) ? `${key}:"${v}"` : `${key}:${v}`;
}

const FILTER_KEYS = new Set(["from", "to", "in", "is", "has", "filename", "mailbox", "before", "after"]);

/** The query with every `key:` filter taken out (and the leftover spaces). `is:` and `has:` have one value each, so they are taken out whole. */
export function withoutFilter(raw: string, ...keys: string[]): string {
  const drop = new Set(keys);
  const { pieces } = parseSearch(raw);
  let out = raw;
  for (const pc of pieces) {
    const key = /^-?([a-z]+):/i.exec(pc.text)?.[1]?.toLowerCase();
    if (pc.kind === "filter" && key && FILTER_KEYS.has(key) && drop.has(key)) out = out.replace(pc.text, " ");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/** The query with `key:value` set, replacing any `key:` already there. A null value just clears it. */
export function withFilter(raw: string, key: string, value: string | null): string {
  const base = withoutFilter(raw, key);
  return value ? `${base} ${filterText(key, value)}`.trim() : base;
}

/** `YYYY-MM-DD` for a time in UTC. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
