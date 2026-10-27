import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/api/index";
import { migrate, signIn, testEnv } from "../api-harness";

// GET /api/events with a stand-in for the server's listener: what the stream says, to whom, and how it ends.

type Fn = (reason: "change" | "accounts" | "resync" | "down" | "up") => void;
let subs: Map<string, Set<Fn>>;
let connected: boolean;
let syncs = false;
const env = testEnv as unknown as { EVENTS?: unknown };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** The harness's call() waits for the whole body, which a stream never has; this hands the response back as soon as it starts. */
async function call(method: string, path: string, opts: { token?: string } = {}) {
  await migrate();
  return worker.fetch(new Request(`http://localhost${path}`, { method, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {} }), testEnv, ctx);
}

const fakeBus = () => ({
  subscribe: (user: string, fn: Fn) => {
    if (!subs.has(user)) subs.set(user, new Set());
    subs.get(user)!.add(fn);
    return () => subs.get(user)?.delete(fn);
  },
  get connected() {
    return connected;
  },
  get syncs() {
    return syncs;
  },
});
const tell = (user: string, reason: Parameters<Fn>[0]) => subs.get(user)?.forEach((f) => f(reason));

/** Read what the stream has written so far, without waiting for it to end. */
async function read(res: Response, n = 1) {
  const reader = res.body!.getReader();
  let text = "";
  for (let i = 0; i < n; i++) text += new TextDecoder().decode((await reader.read()).value);
  reader.releaseLock();
  return text;
}

beforeEach(() => {
  subs = new Map();
  connected = true;
  syncs = false;
  env.EVENTS = fakeBus();
});
afterEach(() => {
  delete env.EVENTS;
  vi.useRealTimers();
});

describe("GET /api/events", () => {
  it("opens an event stream that says it is ready, and whether the server is listening", async () => {
    const token = await signIn("ue1");
    const res = await call("GET", "/api/events", { token });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(await read(res)).toBe('retry: 3000\nevent: ready\ndata: {"live":true,"syncs":false}\n\n');
    syncs = true;
    expect(await read(await call("GET", "/api/events", { token }))).toContain('"syncs":true');
    connected = false;
    expect(await read(await call("GET", "/api/events", { token }))).toContain('"live":false');
  });

  it("tells a window when that person's mail changed, and not when someone else's did", async () => {
    const a = await signIn("ue2");
    await signIn("ue3");
    const res = await call("GET", "/api/events", { token: a });
    const reader = res.body!.getReader();
    await reader.read(); // ready
    tell("ue3", "change");
    tell("ue2", "change");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: changed\ndata: {}\n\n");
    tell("ue2", "down");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: down\ndata: {}\n\n");
    tell("ue2", "accounts");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: accounts\ndata: {}\n\n");
    tell("ue2", "up");
    tell("ue2", "resync");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: up\ndata: {}\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: changed\ndata: {}\n\n");
    await reader.cancel();
    expect(subs.get("ue2")?.size).toBe(0);
  });

  it("sends a ping now and then, so a quiet connection is not closed and the window can hear that it is alive", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const token = await signIn("ue4");
    const res = await call("GET", "/api/events", { token });
    const reader = res.body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("event: ping\ndata: {}\n\n");
    await reader.cancel();
  });

  it("ends after about ten minutes, so the browser asks again and the session is checked again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const token = await signIn("ue5");
    const res = await call("GET", "/api/events", { token });
    const reader = res.body!.getReader();
    await reader.read();
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    let ended = false;
    for (let i = 0; i < 40 && !ended; i++) ended = (await reader.read()).done;
    expect(ended).toBe(true);
    expect(subs.get("ue5")?.size).toBe(0);
  });

  it("lets one person have a dozen windows open, and asks the next to wait", async () => {
    const token = await signIn("ue6");
    const open = [];
    for (let i = 0; i < 12; i++) {
      const r = await call("GET", "/api/events", { token });
      expect(r.status).toBe(200);
      open.push(r);
    }
    const extra = await call("GET", "/api/events", { token });
    expect(extra.status).toBe(429);
    expect(extra.headers.get("retry-after")).toBe("30");
    await open[0].body!.cancel();
    expect((await call("GET", "/api/events", { token })).status).toBe(200);
    await Promise.all(open.slice(1).map((r) => r.body!.cancel()));
  });

  it("answers 404 where the server cannot listen, and 401 to someone not signed in", async () => {
    const token = await signIn("ue7");
    delete env.EVENTS;
    expect((await call("GET", "/api/events", { token })).status).toBe(404);
    env.EVENTS = fakeBus();
    expect((await call("GET", "/api/events")).status).toBe(401);
  });
});
