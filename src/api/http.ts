// Outbound requests with a deadline. A fetch with no timeout waits for as long as the other side cares to stay silent, and in the
// once-a-minute job that means every job behind it waits too (the tick is serialised), so every call to a third party goes through here.

/** How long each kind of call may take. Generous for the work, short enough that a dead server costs a minute at most, not for ever. */
export const TIMEOUT = {
  /** A token exchange or refresh. */
  token: 15_000,
  /** An ordinary API call: a history page, a message, a calendar page. */
  api: 30_000,
  /** The Gmail batch endpoint returns up to 100 whole messages in one answer. */
  batch: 60_000,
  /** Sending a message or downloading an attachment: tens of megabytes may be moving, and someone is waiting. */
  transfer: 120_000,
  /** A raw message body from Graph, which can be megabytes. */
  raw: 60_000,
  /** A DNS-over-HTTPS lookup. */
  dns: 5_000,
  /** A subscribed calendar file. */
  feed: 30_000,
  /** A model call. A reply is streamed, so this is the whole of it, with a long answer in mind; it is there for the server that goes quiet. */
  ai: 300_000,
  /** A request to a server somebody configured (a CalDAV host). */
  remote: 20_000,
} as const;

export class FetchTimeout extends Error {
  constructor(url: string, ms: number) {
    let host = "the server";
    try {
      host = new URL(url).host;
    } catch {
      /* not a URL */
    }
    super(`timeout: ${host} did not answer within ${Math.round(ms / 1000)} s`);
  }
}

/**
 * `fetch` that gives up after `ms` (the headers and the body both count: the signal stays armed until the body has been read). A caller's own
 * `signal` still works. Timers are cleared when the call settles, so nothing is left running.
 */
export async function fetchTimeout(input: string | URL, init: RequestInit = {}, ms: number = TIMEOUT.api): Promise<Response> {
  const controller = new AbortController();
  const url = String(input);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const outer = init.signal;
  const onOuter = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Keep the deadline armed while the body is read; release it once the body is done or discarded.
    if (!res.body) {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
      return res;
    }
    return wrapBody(
      res,
      () => {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuter);
      },
      (e) => (timedOut ? new FetchTimeout(url, ms) : e)
    );
  } catch (e) {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
    if (timedOut) throw new FetchTimeout(url, ms);
    throw e;
  }
}

/** The same Response, whose body reports when it has been read to the end or cancelled. */
function wrapBody(res: Response, done: () => void, mapError: (e: unknown) => unknown): Response {
  const reader = res.body!.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { value, done: end } = await reader.read();
        if (end) {
          done();
          ctrl.close();
        } else ctrl.enqueue(value);
      } catch (e) {
        done();
        ctrl.error(mapError(e));
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
