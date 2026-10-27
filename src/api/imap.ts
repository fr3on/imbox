import { connect } from "../node/sockets";

/**
 * A minimal IMAP4rev1 client — enough to poll a folder for new mail.
 *
 * It reads bytes rather than text throughout: IMAP literals (`{1234}`) are counted in *octets*, and
 * a message body is arbitrary binary, so decoding early would corrupt both the framing and the mail.
 * Raw messages come back as bytes and go straight to postal-mime.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export type ImapSecurity = "tls" | "starttls";

export interface ImapConfig {
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
}

export class ImapError extends Error {
  /** True when the server rejected the credentials, which retrying cannot fix. */
  auth: boolean;
  constructor(message: string, opts: { auth?: boolean } = {}) {
    super(message);
    this.auth = opts.auth ?? false;
  }
}

const READ_TIMEOUT_MS = 20_000;

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  // Cancel the timer once the read settles: left running, every read holds one for `ms`, and a long-lived host hits the runtime's 10,000-timer limit.
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new ImapError(`imap_timeout: ${what}`)), ms);
  });
  return Promise.race([p, timedOut]).finally(() => clearTimeout(timer));
}

/**
 * A byte buffer over the socket that can hand back either a CRLF line or an exact octet count.
 *
 * It grows by doubling and never copies what it already holds for each chunk that arrives: an earlier version allocated a new array per chunk, which
 * costs time in proportion to the square of the message size. A 30 MB attachment arriving in 16 KB pieces meant tens of gigabytes of copying, long
 * enough to freeze the whole process (and so to make every other request, and the read itself, time out).
 */
export class ByteReader {
  private buf = new Uint8Array(64 * 1024);
  private start = 0;
  private end = 0;
  /** How far into the unread bytes a line search has already looked, so a long line is scanned once, not once per chunk. */
  private scanned = 0;
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private append(chunk: Uint8Array) {
    const live = this.end - this.start;
    if (this.end + chunk.length > this.buf.length) {
      const need = live + chunk.length;
      let cap = this.buf.length;
      while (cap < need) cap *= 2;
      if (cap === this.buf.length) this.buf.copyWithin(0, this.start, this.end);
      else {
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(this.start, this.end), 0);
        this.buf = next;
      }
      this.start = 0;
      this.end = live;
    }
    this.buf.set(chunk, this.end);
    this.end += chunk.length;
  }

  private async read(what: string): Promise<Uint8Array> {
    const { value, done } = await timeout(this.reader.read(), READ_TIMEOUT_MS, what);
    if (done || !value) throw new ImapError(`imap_closed: ${what}`);
    return value;
  }

  private consume(n: number) {
    this.start += n;
    this.scanned = 0;
    if (this.start === this.end) this.start = this.end = 0;
  }

  /** One CRLF-terminated line, decoded as text, without the CRLF. */
  async line(what = "line"): Promise<string> {
    for (;;) {
      for (let i = this.start + this.scanned; i + 1 < this.end; i++) {
        if (this.buf[i] === 0x0d && this.buf[i + 1] === 0x0a) {
          const line = dec.decode(this.buf.subarray(this.start, i));
          this.consume(i + 2 - this.start);
          return line;
        }
      }
      // Everything but the last byte has been checked (it may be the CR of a CRLF split across chunks).
      this.scanned = Math.max(0, this.end - this.start - 1);
      this.append(await this.read(what));
    }
  }

  /** Exactly `n` octets — the payload of an IMAP literal. Read straight into an array of the final size, so a big message is held once. */
  async bytes(n: number, what = "literal"): Promise<Uint8Array> {
    const out = new Uint8Array(n);
    const have = Math.min(this.end - this.start, n);
    out.set(this.buf.subarray(this.start, this.start + have), 0);
    this.consume(have);
    let filled = have;
    while (filled < n) {
      const chunk = await this.read(what);
      const take = Math.min(chunk.length, n - filled);
      out.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take < chunk.length) this.append(chunk.subarray(take));
    }
    return out;
  }
}

/** A server line, with the literal that followed it (if any) already read. */
export interface ImapLine {
  text: string;
  literal?: Uint8Array;
}

/** `* 1 FETCH (UID 5 BODY[] {1234}` -> 1234. Only a trailing literal counts. */
export function literalSize(line: string): number | null {
  const m = line.match(/\{(\d+)\}$/);
  return m ? parseInt(m[1], 10) : null;
}

/** IMAP quoted-string: backslash and double-quote must be escaped. */
export function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Pull UIDs out of an untagged SEARCH response. */
export function parseSearchUids(lines: string[]): number[] {
  const out: number[] = [];
  for (const l of lines) {
    const m = l.match(/^\*\s+SEARCH\b(.*)$/i);
    if (!m) continue;
    for (const tok of m[1].trim().split(/\s+/)) {
      const n = parseInt(tok, 10);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

/** UIDVALIDITY and UIDNEXT out of the untagged responses to SELECT. */
export function parseSelect(lines: string[]): { uidValidity: number; uidNext: number; exists: number } {
  let uidValidity = 0;
  let uidNext = 0;
  let exists = 0;
  for (const l of lines) {
    const v = l.match(/\[UIDVALIDITY\s+(\d+)\]/i);
    if (v) uidValidity = parseInt(v[1], 10);
    const n = l.match(/\[UIDNEXT\s+(\d+)\]/i);
    if (n) uidNext = parseInt(n[1], 10);
    const e = l.match(/^\*\s+(\d+)\s+EXISTS/i);
    if (e) exists = parseInt(e[1], 10);
  }
  return { uidValidity, uidNext, exists };
}

/** The UID from a FETCH response line, which servers may order differently. */
export function parseFetchUid(line: string): number | null {
  const m = line.match(/\bUID\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

class ImapSession {
  private tag = 0;
  constructor(
    private reader: ByteReader,
    private writer: WritableStreamDefaultWriter<Uint8Array>
  ) {}

  /** Send a command and collect untagged lines until its tagged completion. */
  async run(command: string, what = command.split(" ")[0]): Promise<ImapLine[]> {
    const tag = `a${(++this.tag).toString().padStart(4, "0")}`;
    await this.writer.write(enc.encode(`${tag} ${command}\r\n`));
    const lines: ImapLine[] = [];
    for (;;) {
      const text = await this.reader.line(what);
      const size = literalSize(text);
      if (size !== null) {
        const literal = await this.reader.bytes(size, what);
        lines.push({ text, literal });
        continue;
      }
      if (text.startsWith(`${tag} `)) {
        const status = text.slice(tag.length + 1).trim();
        if (!/^OK\b/i.test(status)) throw new ImapError(`imap_${what}_failed: ${status.slice(0, 200)}`);
        return lines;
      }
      lines.push({ text });
    }
  }
}

/**
 * Where the cursor starts on a first sync. With no backfill it is the end of the folder (nothing old is
 * imported). With one, it is placed just *before* the n-th newest message, so the ordinary incremental
 * pass picks those up over the next few ticks, oldest first, without a special heavy first run.
 */
export function baselineCursor(allUids: number[], uidNext: number, backfill: number): number {
  const n = Number.isFinite(backfill) ? Math.max(0, Math.floor(backfill)) : 0;
  if (n === 0 || allUids.length === 0) return Math.max(0, uidNext - 1);
  const sorted = [...allUids].sort((a, b) => a - b);
  const first = sorted[Math.max(0, sorted.length - n)];
  return Math.max(0, first - 1);
}

export interface ImapCursor {
  /** Resets to 0 whenever the server renumbers the folder; that invalidates every stored UID. */
  uidValidity: number;
  lastUid: number;
}

export interface ImapFetchResult extends ImapCursor {
  messages: { uid: number; raw: Uint8Array }[];
  /** True when the folder was renumbered and the caller must not treat `messages` as incremental. */
  reset: boolean;
  /** Messages passed over because they are too large to hold in memory; the cursor moves past them. */
  skipped?: { uid: number; size: number }[];
  /** Messages still waiting after this batch (a backlog being worked through), or, on a first sync with a backfill, how many are queued. */
  remaining?: number;
}

/** What one pass may spend. A pass stops when any of these is reached, and the cursor records exactly how far it got. */
export interface ImapLimits {
  /** Most messages fetched in one pass. */
  maxMessages: number;
  /** Most bytes of message text held at once. At least one message is always taken. */
  maxBytes: number;
  /** A message larger than this is skipped, not loaded. */
  maxMessageBytes: number;
  /** Milliseconds after which no further message is started. */
  deadlineMs: number;
}

export const DEFAULT_LIMITS: ImapLimits = { maxMessages: 25, maxBytes: 20 * 1024 * 1024, maxMessageBytes: 30 * 1024 * 1024, deadlineMs: 25_000 };

/** `* 3 FETCH (UID 5 RFC822.SIZE 1234)` lines into sizes by UID. Lines that lack either number are left out. */
export function parseSizes(lines: string[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const l of lines) {
    const uid = parseFetchUid(l);
    const size = l.match(/\bRFC822\.SIZE\s+(\d+)/i);
    if (uid !== null && size) out.set(uid, parseInt(size[1], 10));
  }
  return out;
}

/**
 * Whether a login failure means the server refused these credentials, as opposed to being slow, dropping the connection or
 * having a bad moment. Only a refusal is worth retiring the mailbox for; the rest passes, so the next poll should try again.
 */
export function isLoginRejection(message: string): boolean {
  if (!/^imap_login_failed/i.test(message)) return false;
  return !/\b(UNAVAILABLE|TEMPFAIL|OVERQUOTA|LIMIT|THROTTL|RATE|BUSY|TRY AGAIN|TEMPORAR)/i.test(message);
}

async function open(cfg: ImapConfig) {
  let socket = connect(
    { hostname: cfg.host, port: cfg.port },
    { secureTransport: cfg.security === "tls" ? "on" : "starttls", allowHalfOpen: false }
  );
  let reader = new ByteReader(socket.readable.getReader());
  let writer = socket.writable.getWriter();

  const greeting = await reader.line("greeting");
  if (!/^\*\s+(OK|PREAUTH)/i.test(greeting)) throw new ImapError(`imap_greeting_failed: ${greeting.slice(0, 200)}`);

  if (cfg.security === "starttls") {
    const pre = new ImapSession(reader, writer);
    await pre.run("STARTTLS", "starttls");
    // The pre-upgrade socket is finished; everything continues on the one startTls() returns.
    socket.readable.cancel().catch(() => {});
    writer.releaseLock();
    socket = socket.startTls();
    reader = new ByteReader(socket.readable.getReader());
    writer = socket.writable.getWriter();
  }

  const session = new ImapSession(reader, writer);
  try {
    await session.run(`LOGIN ${quote(cfg.username)} ${quote(cfg.password)}`, "login");
  } catch (e) {
    // Leaving the socket open here would leak a connection on every failed poll.
    try {
      await socket.close();
    } catch {
      /* already gone */
    }
    if (e instanceof ImapError && isLoginRejection(e.message)) throw new ImapError(e.message, { auth: true });
    throw e;
  }
  return { socket, session };
}

/** Connect and log in, then hang up — the "Test connection" button. */
export async function imapVerify(cfg: ImapConfig): Promise<void> {
  const { socket, session } = await open(cfg);
  try {
    await session.run("LOGOUT", "logout");
  } finally {
    try {
      await socket.close();
    } catch {
      /* the server usually closes first after LOGOUT */
    }
  }
}

/** The part of a session a batch needs: send a command, get its lines. Lets the batch be tested without a socket. */
export interface ImapRunner {
  run(command: string, what?: string): Promise<ImapLine[]>;
}

/**
 * Fetch `uids` (ascending) until the time or memory budget is used. Sizes are asked for first, in one round trip, so a huge attachment is noticed
 * before it is downloaded: one over `maxMessageBytes` is skipped and the cursor moves past it. The pass always takes at least one message, and
 * `lastUid` is the last one handled, so the next pass starts right after it.
 */
export async function fetchBatch(
  session: ImapRunner,
  uids: number[],
  startUid: number,
  lim: ImapLimits,
  clock: () => number = Date.now
): Promise<{ messages: { uid: number; raw: Uint8Array }[]; skipped: { uid: number; size: number }[]; lastUid: number; handled: number }> {
  const sizes = parseSizes((await session.run(`UID FETCH ${uids.join(",")} (UID RFC822.SIZE)`, "fetch")).map((l) => l.text));
  const messages: { uid: number; raw: Uint8Array }[] = [];
  const skipped: { uid: number; size: number }[] = [];
  const deadline = clock() + lim.deadlineMs;
  let held = 0;
  let lastUid = startUid;
  let handled = 0;
  for (const uid of uids) {
    const size = sizes.get(uid) ?? 0;
    if (size > lim.maxMessageBytes) {
      skipped.push({ uid, size });
    } else {
      // Stop here when the pass has used its time or memory; the next pass carries on from this UID.
      if (messages.length && (held + size > lim.maxBytes || clock() > deadline)) break;
      // BODY.PEEK leaves \Seen alone: reading here must not mark the mail read in the real mailbox.
      const lines = await session.run(`UID FETCH ${uid} (UID BODY.PEEK[])`, "fetch");
      const withBody = lines.find((l) => l.literal);
      if (withBody?.literal) {
        messages.push({ uid: parseFetchUid(withBody.text) ?? uid, raw: withBody.literal });
        held += withBody.literal.length;
      }
    }
    lastUid = uid;
    handled += 1;
  }
  return { messages, skipped, lastUid, handled };
}

/**
 * Fetch messages newer than `cursor.lastUid` from `folder`.
 *
 * When the server reports a different UIDVALIDITY every previously stored UID is meaningless, so the
 * result is flagged `reset` and the caller re-baselines rather than treating the batch as new mail.
 */
export async function imapFetchNew(
  cfg: ImapConfig,
  folder: string,
  cursor: ImapCursor,
  max = 25,
  backfill = 0,
  limits: Partial<ImapLimits> = {}
): Promise<ImapFetchResult> {
  const lim: ImapLimits = { ...DEFAULT_LIMITS, maxMessages: max, ...limits };
  const { socket, session } = await open(cfg);
  try {
    const selected = parseSelect((await session.run(`SELECT ${quote(folder)}`, "select")).map((l) => l.text));
    // RFC 3501 requires UIDVALIDITY on SELECT. Without it every UID we store is meaningless — and
    // since 0 is also the "never baselined" marker, accepting it would re-baseline on every run and
    // the mailbox would stay silent forever instead of reporting a problem.
    if (!selected.uidValidity) {
      throw new ImapError(`imap_select_failed: ${folder} returned no UIDVALIDITY`);
    }
    const reset = cursor.uidValidity !== 0 && selected.uidValidity !== cursor.uidValidity;

    // A fresh mailbox, or one that was renumbered, only records where things stand — importing the
    // entire history into the Screener is never what anyone wants.
    if (cursor.uidValidity === 0 || reset) {
      // A renumbered folder never backfills: its old UIDs are gone, and re-importing is what we avoid.
      const want = reset ? 0 : backfill;
      const all = want > 0 ? parseSearchUids((await session.run("UID SEARCH ALL", "search")).map((l) => l.text)) : [];
      return { uidValidity: selected.uidValidity, lastUid: baselineCursor(all, selected.uidNext, want), messages: [], reset, remaining: Math.min(all.length, want) };
    }

    const from = cursor.lastUid + 1;
    const found = parseSearchUids((await session.run(`UID SEARCH UID ${from}:*`, "search")).map((l) => l.text));
    // `UID SEARCH n:*` always returns at least the highest UID even when nothing is that new.
    const pending = found.filter((u) => u >= from).sort((a, b) => a - b);
    const uids = pending.slice(0, lim.maxMessages);
    if (!uids.length) return { uidValidity: selected.uidValidity, lastUid: cursor.lastUid, messages: [], reset: false, remaining: 0 };

    const { messages, skipped, lastUid, handled } = await fetchBatch(session, uids, cursor.lastUid, lim);

    await session.run("LOGOUT", "logout").catch(() => {});
    return { uidValidity: selected.uidValidity, lastUid, messages, reset: false, skipped, remaining: pending.length - handled };
  } finally {
    try {
      await socket.close();
    } catch {
      /* ignore */
    }
  }
}
