// Timestamps from the API are treated as ms; values that look like seconds are upscaled.
export function toMs(n: number): number {
  return n < 1e12 ? n * 1000 : n;
}

const DAY = 86_400_000;

export function fmtTime(n: number): string {
  const d = new Date(toMs(n));
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const diff = now.getTime() - d.getTime();
  if (diff > 0 && diff < 6 * DAY) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function fmtFull(n: number): string {
  const d = new Date(toMs(n));
  return d.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDate(n: number): string {
  return new Date(toMs(n)).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function fmtRelative(n: number): string {
  const diff = toMs(n) - Date.now();
  const abs = Math.abs(diff);
  const future = diff > 0;
  const units: [number, string][] = [
    [60_000, "minute"],
    [3_600_000, "hour"],
    [DAY, "day"],
    [7 * DAY, "week"],
    [30 * DAY, "month"],
  ];
  if (abs < 60_000) return future ? "in a moment" : "just now";
  let value = 0;
  let unit = "minute";
  for (let i = units.length - 1; i >= 0; i--) {
    if (abs >= units[i][0]) {
      value = Math.round(abs / units[i][0]);
      unit = units[i][1];
      break;
    }
  }
  const label = `${value} ${unit}${value === 1 ? "" : "s"}`;
  return future ? `in ${label}` : `${label} ago`;
}

/** The heading for a day in a list: Today, Yesterday, the weekday for the rest of the week, then the date. */
export function dayLabel(n: number, now = new Date()): string {
  const d = new Date(toMs(n));
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: "long", day: "numeric" } : { month: "long", day: "numeric", year: "numeric" });
}

export function monthKey(n: number): string {
  return new Date(toMs(n)).toLocaleDateString([], { month: "long", year: "numeric" });
}

export function fmtSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// A machine's address says nothing about who it is ("no-reply", "notifications"); the company after the @ does.
const AUTOMATED_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer[-_.]?daemon|postmaster|bounces?|alerts?|newsletter|info|hello|support|team|admin|billing|mail|news|updates?)$/i;

/** The company's own name from an address's domain: "support@info.digitalocean.com" -> "digitalocean". */
function brandOf(email: string): string {
  const host = (email.split("@")[1] ?? "").toLowerCase().split(".");
  const generic = new Set(["com", "net", "org", "io", "co", "sa", "uk", "info", "mail", "email", "app", "www", "support", "mg", "em"]);
  return host.filter((p) => p && !generic.has(p)).pop() ?? host[0] ?? "";
}

export function initials(name: string, email: string): string {
  const local = email.split("@")[0] ?? "";
  const src = (name || "").trim() || (AUTOMATED_LOCAL.test(local) ? brandOf(email) : local) || "?";
  const parts = src.replace(/[^a-zA-Z0-9 ._-]/g, "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return src.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PALETTE = ["#0f766e", "#7c3aed", "#db2777", "#ea580c", "#2563eb", "#059669", "#b45309", "#4f46e5", "#be123c", "#0891b2"];

/** The person's own soft tint for their initials: the same address always gets the same one, faint enough to sit in a monochrome page. */
export function avatarTint(email: string): { background: string; color: string } {
  const c = avatarColor((email || "?").toLowerCase());
  return {
    background: `color-mix(in srgb, ${c} 15%, transparent)`,
    color: `color-mix(in srgb, ${c} 72%, var(--foreground))`,
  };
}

export function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Trailing characters that belong to the sentence around a link, not to the link. */
const LINK_TAIL = /(?:&gt;|&lt;|&quot;|&#39;|[.,;:!?)\]}])$/;

/**
 * Turn the web addresses in already-escaped text into links. Plain-text mail has no markup, so an address in it is
 * only clickable if we make it so. Punctuation that ends a sentence or closes a bracket around a link is left outside it,
 * except a closing bracket that matches one inside the address (Wikipedia-style URLs).
 */
export function linkify(escaped: string): string {
  return escaped.replace(/\b(?:https?:\/\/|www\.)[^\s<>"]+/gi, (raw) => {
    let url = raw;
    let tail = "";
    for (;;) {
      const m = LINK_TAIL.exec(url);
      if (!m) break;
      if (m[0] === ")" && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
      tail = m[0] + tail;
      url = url.slice(0, -m[0].length);
    }
    if (!/^(?:https?:\/\/)?[^\s/]+\.[^\s/]+|^https?:\/\/[^\s/]+/i.test(url) || /^(?:https?:\/\/|www\.)$/i.test(url)) return raw;
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    return `<a href="${href}">${url}</a>${tail}`;
  });
}

export function textToHtml(s: string): string {
  return linkify(escapeHtml(s)).replace(/\r?\n/g, "<br>");
}

export function unsubscribeTarget(header: string): { url?: string; mailto?: string } {
  const out: { url?: string; mailto?: string } = {};
  const m = header.match(/<?(https?:\/\/[^>,\s]+)>?/i);
  if (m) out.url = m[1];
  const mm = header.match(/<?mailto:([^>,\s?]+)/i);
  if (mm) out.mailto = mm[1];
  return out;
}
