// Who is waiting to hear that a person's mail changed. PostgreSQL does the telling: a trigger on `threads` (migration 0027) sends the owner's id on the
// `imbox_changes` channel, this process LISTENs, and every window subscribed for that person is called, once for a burst of changes. Each web process
// has its own bus, so it works with several of them; nothing here needs more than PostgreSQL.

export const CHANNEL = "imbox_changes";
/** What each channel says: mail changed (a trigger on `threads`, migration 0027), or a mailbox did (a trigger on `accounts`, migration 0028). */
export const CHANNELS = { imbox_changes: "change", imbox_accounts: "accounts" };

/**
 * @typedef {"change" | "accounts" | "resync" | "down" | "up"} Reason
 *   change: that person's mail changed. accounts: one of their mailboxes did (added, removed, its sync state or settings). down: the listening connection was lost, so nothing can be said to be live. up: it is listening (for the first time, or
 *   again). resync: it is listening again after an outage, and anything could have changed in the meantime.
 * @param {{
 *   connect: () => Promise<{ query: (sql: string) => Promise<unknown>, on: (event: string, fn: (...args: any[]) => void) => unknown, end: () => Promise<unknown> }>,
 *   debounceMs?: number, pingMs?: number, retryMs?: number[], log?: { warn: (...a: unknown[]) => void }, syncs?: boolean
 * }} options
 */
export function createChangeBus({ connect, debounceMs = 150, pingMs = 30_000, retryMs = [1000, 2000, 5000, 15_000, 30_000], log = console, syncs = false }) {
  /** @type {Map<string, Set<(reason: Reason) => void>>} */
  const subscribers = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const pending = new Map();
  let client = null;
  let connected = false;
  let closed = false;
  let attempt = 0;
  let retryTimer = null;
  let pingTimer = null;
  let everConnected = false;

  const call = (userId, reason) => {
    for (const fn of [...(subscribers.get(userId) ?? [])]) {
      try {
        fn(reason);
      } catch (e) {
        log.warn("change subscriber failed:", e?.message ?? e);
      }
    }
  };
  const callAll = (reason) => {
    for (const userId of subscribers.keys()) call(userId, reason);
  };

  /** Many notices of one kind for one person in a short while are one call. */
  const changed = (userId, reason) => {
    const key = `${reason}\0${userId}`;
    if (!subscribers.has(userId) || pending.has(key)) return;
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        call(userId, reason);
      }, debounceMs)
    );
  };

  const lost = (why) => {
    if (closed) return;
    const old = client;
    client = null;
    clearInterval(pingTimer);
    if (old) void Promise.resolve(old.end()).catch(() => {});
    if (connected) {
      connected = false;
      log.warn(`change notifications: connection lost (${why}); windows fall back to polling until it is back`);
      callAll("down");
    }
    if (retryTimer) return;
    const wait = retryMs[Math.min(attempt++, retryMs.length - 1)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void start();
    }, wait);
    retryTimer.unref?.();
  };

  async function start() {
    if (closed || client) return;
    let c;
    try {
      c = await connect();
      if (closed) return void c.end();
      c.on("error", (e) => c === client && lost(e?.message ?? "error"));
      c.on("end", () => c === client && lost("closed"));
      c.on("notification", (m) => {
        const reason = CHANNELS[m?.channel];
        if (reason && m.payload) changed(String(m.payload), reason);
      });
      for (const channel of Object.keys(CHANNELS)) await c.query(`LISTEN ${channel}`);
    } catch (e) {
      if (c) void Promise.resolve(c.end()).catch(() => {});
      client = null;
      if (!closed) lost(e?.message ?? "connect failed");
      return;
    }
    client = c;
    attempt = 0;
    const was = everConnected; // listening before: changes may have been missed while it was down
    everConnected = true;
    connected = true;
    // A dead connection that nobody told us about is found by asking it something.
    pingTimer = setInterval(() => {
      Promise.race([client?.query("SELECT 1"), new Promise((_, no) => setTimeout(() => no(new Error("no answer")), 10_000))]).catch((e) => lost(e?.message ?? "ping failed"));
    }, pingMs);
    pingTimer.unref?.();
    callAll("up");
    if (was) callAll("resync");
  }

  return {
    /** Begin listening. Never throws: if PostgreSQL cannot be reached it keeps trying, and `connected` says whether it is. */
    start,
    /** @param {string} userId @param {(reason: Reason) => void} fn @returns {() => void} */
    subscribe(userId, fn) {
      const set = subscribers.get(userId) ?? new Set();
      subscribers.set(userId, set);
      set.add(fn);
      return () => {
        set.delete(fn);
        if (!set.size && subscribers.get(userId) === set) {
          subscribers.delete(userId);
          for (const reason of Object.values(CHANNELS)) {
            const key = `${reason}\0${userId}`;
            clearTimeout(pending.get(key));
            pending.delete(key);
          }
        }
      };
    },
    get connected() {
      return connected;
    },
    /** Whether this server syncs the mailboxes by itself every minute, so a window need not ask it to. */
    syncs,
    get subscribers() {
      let n = 0;
      for (const s of subscribers.values()) n += s.size;
      return n;
    },
    async close() {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      subscribers.clear();
      connected = false;
      const c = client;
      client = null;
      if (c) await Promise.resolve(c.end()).catch(() => {});
    },
  };
}
