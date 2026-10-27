// Reads a request typed in plain words ("unread mail from Harbor Bank about card payments last month") into the words to look for and the
// filters that go with them. No AI here: this is the part that always works, and the shape the AI reader fills in too (see worker/ai/searchplan).
// A plan is written back as an ordinary query ("card payments from:"Harbor Bank" is:unread after:2026-09-01 before:2026-10-01"), so the page shows it as
// chips the reader can take off one at a time.

import { contentWords, filterText, isoDay, parseWhen } from "./searchQuery";

export interface SearchPlan {
  terms: string[];
  from: string;
  to: string;
  /** imbox, feed, paper_trail, screener or trash. */
  place: string;
  unread: boolean | null;
  hasFile: boolean;
  filename: string;
  mailbox: string;
  /** `YYYY-MM-DD`, or empty. `before` is the first day left out. */
  after: string;
  before: string;
}

export const emptyPlan = (): SearchPlan => ({ terms: [], from: "", to: "", place: "", unread: null, hasFile: false, filename: "", mailbox: "", after: "", before: "" });

const DAY = 86_400_000;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const PLACES = new Set(["screener", "imbox", "updates", "feed", "paper_trail", "trash"]);

const monthIndex = (w: string): number => {
  const s = w.toLowerCase();
  const i = MONTHS.indexOf(s);
  return i >= 0 ? i : (SHORT[s] ?? -1);
};
const MONTH_RE = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";

/** Which year a month name means when none is said: the latest one that has begun. */
function yearFor(month: number, now: number, said?: string): number {
  if (said) return Number(said);
  const d = new Date(now);
  return month > d.getUTCMonth() ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}
const monthStart = (y: number, m: number) => Date.UTC(y, m, 1);

export interface DateRange {
  after: number | null;
  before: number | null;
}

/** Finds one date phrase in a request, and what is left of it. Understands today, yesterday, this/last week, month and year, "last 3 weeks",
 *  "since March", "in September 2025", "before May", "after 2026-03-01". Months without a year mean the latest one that has begun. */
export function extractDates(text: string, now: number): { range: DateRange; rest: string; phrase: string } | null {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monday = start - ((d.getUTCDay() + 6) % 7) * DAY;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const take = (re: RegExp, to: (x: RegExpExecArray) => DateRange | null) => {
    const hit = re.exec(text);
    if (!hit) return null;
    const range = to(hit);
    if (!range) return null;
    return { range, phrase: hit[0].trim(), rest: `${text.slice(0, hit.index)} ${text.slice(hit.index + hit[0].length)}`.replace(/\s{2,}/g, " ").trim() };
  };
  const rules: [RegExp, (x: RegExpExecArray) => DateRange | null][] = [
    [/\byesterday\b/i, () => ({ after: start - DAY, before: start })],
    [/\btoday\b/i, () => ({ after: start, before: start + DAY })],
    [/\b(?:this|current) week\b/i, () => ({ after: monday, before: null })],
    [/\blast week\b/i, () => ({ after: monday - 7 * DAY, before: monday })],
    [/\b(?:this|current) month\b/i, () => ({ after: monthStart(y, m), before: null })],
    [/\blast month\b/i, () => ({ after: monthStart(y, m - 1), before: monthStart(y, m) })],
    [/\b(?:this|current) year\b/i, () => ({ after: monthStart(y, 0), before: null })],
    [/\blast year\b/i, () => ({ after: monthStart(y - 1, 0), before: monthStart(y, 0) })],
    [/\b(?:last|past|previous) (\d{1,3}) (day|week|month|year)s?\b/i, (x) => ({ after: start - Number(x[1]) * { day: 1, week: 7, month: 30, year: 365 }[x[2].toLowerCase() as "day"] * DAY, before: null })],
    [new RegExp(`\\b(?:since|from|after) ${MONTH_RE}(?: (\\d{4}))?\\b`, "i"), (x) => ({ after: monthStart(yearFor(monthIndex(x[1]), now, x[2]), monthIndex(x[1])), before: null })],
    [new RegExp(`\\b(?:before|until) ${MONTH_RE}(?: (\\d{4}))?\\b`, "i"), (x) => ({ after: null, before: monthStart(yearFor(monthIndex(x[1]), now, x[2]), monthIndex(x[1])) })],
    [new RegExp(`\\b(?:in|during|on)? ?${MONTH_RE} (\\d{4})\\b`, "i"), (x) => ({ after: monthStart(Number(x[2]), monthIndex(x[1])), before: monthStart(Number(x[2]), monthIndex(x[1]) + 1) })],
    [new RegExp(`\\b(?:in|during) ${MONTH_RE}\\b`, "i"), (x) => {
      const mi = monthIndex(x[1]);
      const yr = yearFor(mi, now);
      return { after: monthStart(yr, mi), before: monthStart(yr, mi + 1) };
    }],
    [/\b(?:in|during) (20\d{2})\b/i, (x) => ({ after: monthStart(Number(x[1]), 0), before: monthStart(Number(x[1]) + 1, 0) })],
    [/\b(?:since|after) (\d{4}-\d{2}(?:-\d{2})?)\b/i, (x) => ({ after: parseWhen(x[1], now), before: null })],
    [/\bbefore (\d{4}-\d{2}(?:-\d{2})?)\b/i, (x) => ({ after: null, before: parseWhen(x[1], now) })],
  ];
  for (const [re, to] of rules) {
    const found = take(re, to);
    if (found) return found;
  }
  return null;
}

/** A request in plain words, read as far as words alone allow. */
export function planRequest(raw: string, now = Date.now()): SearchPlan {
  const plan = emptyPlan();
  let text = raw.trim();
  const dates = extractDates(text, now);
  if (dates) {
    const { range } = dates;
    if (range.after !== null) plan.after = isoDay(range.after);
    if (range.before !== null) plan.before = isoDay(range.before);
    text = dates.rest;
  }
  // "from Harbor Bank", "from priya@acme.com": a name that starts with a capital, up to three words, or an address.
  const from = /\b[Ff]rom\s+((?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,})|(?:[A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,2}))/.exec(text);
  if (from) {
    plan.from = from[1].trim();
    text = `${text.slice(0, from.index)} ${text.slice(from.index + from[0].length)}`;
  }
  const strip = (re: RegExp) => {
    const had = re.test(text);
    if (had) text = text.replace(re, " ");
    return had;
  };
  if (strip(/\bunread\b/i)) plan.unread = true;
  if (strip(/\b(?:with|has|have|having|including)\s+(?:an?\s+)?(?:attachments?|files?|attached)\b/i) || strip(/\b(?:attachments?|attached files?)\b/i)) plan.hasFile = true;
  const place = /\bin (?:the )?(?:my )?(screener|imbox|updates|feed|paper trail|paper_trail|trash)\b/i.exec(text);
  if (place) {
    plan.place = place[1].toLowerCase().replace(" ", "_");
    text = text.replace(place[0], " ");
  }
  plan.terms = (contentWords(text.replace(/\s{2,}/g, " ")) || "")
    .split(/\s+/)
    .filter(Boolean);
  return plan;
}

/** A plan as query text. Words that hold a space are quoted, and every value is put through the same filter writer the page uses. */
export function queryFromPlan(plan: SearchPlan): string {
  const parts: string[] = plan.terms.map((t) => (/\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t));
  if (plan.from) parts.push(filterText("from", plan.from));
  if (plan.to) parts.push(filterText("to", plan.to));
  if (plan.place && PLACES.has(plan.place)) parts.push(`in:${plan.place === "updates" || plan.place === "paper_trail" ? "feed" : plan.place}`);
  if (plan.unread !== null) parts.push(`is:${plan.unread ? "unread" : "read"}`);
  if (plan.hasFile) parts.push("has:file");
  if (plan.filename) parts.push(filterText("filename", plan.filename));
  if (plan.mailbox) parts.push(filterText("mailbox", plan.mailbox));
  if (plan.after) parts.push(`after:${plan.after}`);
  if (plan.before) parts.push(`before:${plan.before}`);
  return parts.join(" ");
}

const str = (v: unknown, max = 80) => (typeof v === "string" ? v.replace(/["\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const day = (v: unknown, now: number) => {
  const s = str(v, 10);
  return /^\d{4}-\d{2}(-\d{2})?$/.test(s) && parseWhen(s, now) !== null ? s : "";
};

/** Whatever a model sent back, cut down to a plan: only the fields we know, short plain strings, real dates. Null when it is not an object. */
export function cleanPlan(value: unknown, now = Date.now()): SearchPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const plan = emptyPlan();
  plan.terms = (Array.isArray(v.terms) ? v.terms : typeof v.terms === "string" ? v.terms.split(/\s+/) : [])
    .map((t) => str(t, 60))
    .filter(Boolean)
    .slice(0, 6);
  plan.from = str(v.from);
  plan.to = str(v.to);
  const place = str(v.place, 20).toLowerCase().replace(" ", "_");
  plan.place = PLACES.has(place) ? place : "";
  plan.unread = v.unread === true ? true : v.unread === false ? false : null;
  plan.hasFile = v.has_file === true || v.hasFile === true;
  plan.filename = str(v.filename);
  plan.after = day(v.after, now);
  plan.before = day(v.before, now);
  if (plan.after && plan.before && plan.after >= plan.before) plan.before = "";
  return plan;
}
