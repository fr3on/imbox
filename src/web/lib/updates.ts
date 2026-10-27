// How the Updates page lays out Feeds and Paper Trail mail as one stream. Reading is what is written to be read (newsletters); everything else
// is a receipt or a notice, shown as a compact line. A day's compact lines fold into one when there are enough of them.

import type { Message, ThreadSummary } from "@shared/types";

/** What a Feeds or Paper Trail thread looks like to this file (the page passes the richer FeedThread). */
export type StreamThread = ThreadSummary & { latest_message?: Message | null };

export type Kind = "all" | "reading" | "receipts";

/** Whether a newsletter's own footer offers a way out: the header, or the word in the text (some senders leave the header off). */
const hasUnsubscribe = (m: Message) => !!m.list_unsubscribe || /\bunsubscribe\b/i.test((m.text_body || m.html_body || "").slice(-6000));

/** Mail with no way to unsubscribe is a notice (delivery failures, case updates) rather than something written to be read. */
export const isNotice = (t: StreamThread) => !!t.latest_message && !hasUnsubscribe(t.latest_message);

/** Reading: a newsletter in Feeds. Receipts: Paper Trail, and the notices that Feeds picks up. */
export const kindOf = (t: StreamThread): Exclude<Kind, "all"> => (t.bucket === "feed" && !isNotice(t) ? "reading" : "receipts");

/** What a row is called. Alerts are automated warnings from a service (an error tracker, a monitor), which are neither receipts nor newsletters. */
export type Label = "Newsletter" | "Alert" | "Receipt" | "Notice";

const ALERT_SENDERS = /(?:^|[.@])(?:sentry\.io|getsentry\.com|pagerduty\.com|opsgenie\.com|datadoghq\.com|statuspage\.io|uptimerobot\.com|pingdom\.com|rollbar\.com|bugsnag\.com|honeybadger\.io|newrelic\.com|grafana\.com|logtail\.com)$/i;
const ALERT_SUBJECT = /\b(?:alert(?:ing)?|incident|outage|is down|went down|downtime|exception|error|errors|failed|failure|timeout|critical|degraded|triggered|resolved)\b/i;

/** Whether the mail is an automated alert: from a monitoring service, or worded like one and not a receipt. */
export function isAlert(t: StreamThread): boolean {
  const domain = (t.last_from?.email ?? "").split("@").pop() ?? "";
  if (ALERT_SENDERS.test(domain)) return true;
  return t.bucket === "feed" && !!t.latest_message && !t.latest_message.list_unsubscribe && ALERT_SUBJECT.test(t.subject ?? "");
}

export function labelOf(t: StreamThread): Label {
  if (isAlert(t)) return "Alert";
  if (kindOf(t) === "reading") return "Newsletter";
  return t.bucket === "feed" ? "Notice" : "Receipt";
}

export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date(now)) - start(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

export type Item<T extends StreamThread = StreamThread> =
  | { type: "day"; key: string; label: string }
  | { type: "reading"; key: string; t: T }
  | { type: "receipt"; key: string; t: T }
  | { type: "fold"; key: string; threads: T[]; label: string };

/** A day with this many compact lines in a row folds them into one. */
export const FOLD_AT = 4;

/** Who the folded mail is from, for the summary line: the first few names, then "+N". */
export function foldLabel(threads: StreamThread[]): string {
  const labels = new Set(threads.map(labelOf));
  const what = labels.size === 1 ? `${[...labels][0].toLowerCase()}s` : "updates";
  const names: string[] = [];
  for (const t of threads) {
    const n = t.last_from.name || t.last_from.email;
    if (!names.includes(n)) names.push(n);
  }
  const shown = names.slice(0, 3).join(", ");
  return `${threads.length} ${what} · ${shown}${names.length > 3 ? `, +${names.length - 3}` : ""}`;
}

/** Newest first, grouped under day headings, with runs of compact lines folded. `expanded` holds the folds the person has opened. */
export function buildStream<T extends StreamThread>(threads: T[], expanded: ReadonlySet<string> = new Set(), now = Date.now()): Item<T>[] {
  const out: Item<T>[] = [];
  let day = "";
  let run: T[] = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length >= FOLD_AT && !expanded.has(`fold:${run[0].id}`)) out.push({ type: "fold", key: `fold:${run[0].id}`, threads: run, label: foldLabel(run) });
    else for (const t of run) out.push({ type: "receipt", key: t.id, t });
    run = [];
  };
  for (const t of threads) {
    const label = dayLabel(t.last_message_at, now);
    if (label !== day) {
      flush();
      day = label;
      out.push({ type: "day", key: `day:${label}:${t.id}`, label });
    }
    if (kindOf(t) === "reading") {
      flush();
      out.push({ type: "reading", key: t.id, t });
    } else run.push(t);
  }
  flush();
  return out;
}

/** The threads a chip shows. */
export function ofKind<T extends StreamThread>(threads: T[], kind: Kind): T[] {
  return kind === "all" ? threads : threads.filter((t) => kindOf(t) === kind);
}
