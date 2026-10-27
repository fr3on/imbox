import { Hono } from "hono";
import type { AppEnv } from "../env";

// GET /api/events: a stream (Server-Sent Events) that tells a window when the person's mail has changed, so it can ask for it instead of asking every few
// seconds. The listening is the server's (server/changes.mjs, fed by a trigger in PostgreSQL); a host without it answers 404 and the app polls as before.
//
//   event: ready     the stream is open; data says whether the server is listening for changes (`live`) and whether it syncs the mailboxes by itself (`syncs`)
//   event: changed   something in the person's mail changed: refetch
//   event: accounts  one of their mailboxes changed (added, removed, its sync state or settings): refetch the account list
//   event: down      the server stopped listening: poll until `up`
//   event: up        it is listening again (a `changed` follows, since anything could have changed meanwhile)
//   event: ping      every 25 seconds, so that nothing in between closes a quiet connection, and so the window can tell a stream that went silent (a sleeping laptop,
//                    a connection a router dropped without saying so) from one with nothing to report

const events = new Hono<AppEnv>();

const HEARTBEAT_MS = 25_000;
/** A stream is closed after about this long and the browser opens another, which checks the session again. */
const LIFETIME_MS = 10 * 60_000;
/** Windows one person may have open at once. */
const MAX_PER_USER = 12;
const open = new Map<string, number>();

events.get("/", (c) => {
  const bus = c.env.EVENTS;
  if (!bus) return c.json({ error: "not_available" }, 404);
  const userId = c.get("user").id;
  if ((open.get(userId) ?? 0) >= MAX_PER_USER) return c.json({ error: "too_many_streams" }, 429, { "retry-after": "30" });
  open.set(userId, (open.get(userId) ?? 0) + 1);

  const text = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let done = false;
      const send = (chunk: string) => {
        if (done) return;
        try {
          controller.enqueue(text.encode(chunk));
        } catch {
          stop();
        }
      };
      const off = bus.subscribe(userId, (reason) => send(`event: ${reason === "change" || reason === "resync" ? "changed" : reason}\ndata: {}\n\n`));
      const beat = setInterval(() => send("event: ping\ndata: {}\n\n"), HEARTBEAT_MS);
      const life = setTimeout(() => stop(), LIFETIME_MS * (0.9 + Math.random() * 0.2));
      stop = () => {
        if (done) return;
        done = true;
        clearInterval(beat);
        clearTimeout(life);
        off();
        const n = (open.get(userId) ?? 1) - 1;
        if (n > 0) open.set(userId, n);
        else open.delete(userId);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      send(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ live: bus.connected, syncs: bus.syncs === true })}\n\n`);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      // nginx and similar proxies hold back a response they think is a download; this says it is not.
      "x-accel-buffering": "no",
    },
  });
});

export default events;
