import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChangeBus, CHANNEL, CHANNELS } from "../../server/changes.mjs";

// The listener that tells windows their mail changed, without a database: a fake connection stands in for PostgreSQL.

class FakeClient extends EventEmitter {
  queries: string[] = [];
  ended = false;
  failQuery: string | null = null;
  async query(sql: string) {
    this.queries.push(sql);
    if (this.failQuery && sql.startsWith(this.failQuery)) throw new Error("boom");
    return {};
  }
  async end() {
    this.ended = true;
  }
  notify(payload: string, channel = CHANNEL) {
    this.emit("notification", { channel, payload });
  }
}

let clients: FakeClient[];
let connectFails: number;
const bus = (o: Record<string, unknown> = {}) =>
  createChangeBus({
    connect: async () => {
      if (connectFails-- > 0) throw new Error("no database");
      const c = new FakeClient();
      clients.push(c);
      return c;
    },
    debounceMs: 50, pingMs: 1000, retryMs: [100, 200], log: { warn: () => {} }, ...o,
  });

beforeEach(() => {
  vi.useFakeTimers();
  clients = [];
  connectFails = 0;
});
afterEach(() => vi.useRealTimers());

describe("the change bus", () => {
  it("listens on the channel, and says it is connected", async () => {
    const b = bus();
    expect(b.connected).toBe(false);
    await b.start();
    expect(b.connected).toBe(true);
    expect(clients[0].queries).toEqual(Object.keys(CHANNELS).map((c) => `LISTEN ${c}`));
    await b.close();
  });

  it("calls the people subscribed for the user whose mail changed, and nobody else", async () => {
    const b = bus();
    await b.start();
    const a = vi.fn(), a2 = vi.fn(), other = vi.fn();
    b.subscribe("ua", a);
    b.subscribe("ua", a2);
    b.subscribe("ub", other);
    clients[0].notify("ua");
    await vi.advanceTimersByTimeAsync(60);
    expect(a).toHaveBeenCalledWith("change");
    expect(a2).toHaveBeenCalledWith("change");
    expect(other).not.toHaveBeenCalled();
    expect(b.subscribers).toBe(3);
  });

  it("says which kind of change it was: the mail, or a mailbox", async () => {
    const b = bus();
    await b.start();
    const seen: string[] = [];
    b.subscribe("ua", (r: string) => seen.push(r));
    clients[0].notify("ua", "imbox_accounts");
    await vi.advanceTimersByTimeAsync(60);
    clients[0].notify("ua");
    await vi.advanceTimersByTimeAsync(60);
    expect(seen).toEqual(["accounts", "change"]);
  });

  it("makes one call of each kind for a burst, and not one kind out of the other", async () => {
    const b = bus();
    await b.start();
    const seen: string[] = [];
    b.subscribe("ua", (r: string) => seen.push(r));
    for (let i = 0; i < 5; i++) {
      clients[0].notify("ua");
      clients[0].notify("ua", "imbox_accounts");
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(seen.sort()).toEqual(["accounts", "change"]);
  });

  it("says whether the server syncs by itself", () => {
    expect(bus().syncs).toBe(false);
    expect(bus({ syncs: true }).syncs).toBe(true);
  });

  it("makes one call of a burst of changes", async () => {
    const b = bus();
    await b.start();
    const fn = vi.fn();
    b.subscribe("ua", fn);
    for (let i = 0; i < 20; i++) clients[0].notify("ua");
    await vi.advanceTimersByTimeAsync(40);
    clients[0].notify("ua");
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);
    clients[0].notify("ua");
    await vi.advanceTimersByTimeAsync(60);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ignores another channel, an empty notice, and a user nobody listens for", async () => {
    const b = bus();
    await b.start();
    const fn = vi.fn();
    b.subscribe("ua", fn);
    clients[0].notify("ua", "something_else");
    clients[0].notify("");
    clients[0].notify("nobody");
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("stops calling someone who unsubscribed, including a call that was waiting", async () => {
    const b = bus();
    await b.start();
    const fn = vi.fn();
    const off = b.subscribe("ua", fn);
    clients[0].notify("ua");
    off();
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).not.toHaveBeenCalled();
    expect(b.subscribers).toBe(0);
  });

  it("keeps going when one subscriber throws", async () => {
    const b = bus();
    await b.start();
    const good = vi.fn();
    b.subscribe("ua", () => {
      throw new Error("bad");
    });
    b.subscribe("ua", good);
    clients[0].notify("ua");
    await vi.advanceTimersByTimeAsync(60);
    expect(good).toHaveBeenCalled();
  });

  it("says down when the connection is lost, then up and resync when it is back, and listens again", async () => {
    const b = bus();
    await b.start();
    const seen: string[] = [];
    b.subscribe("ua", (r: string) => seen.push(r));
    clients[0].emit("error", new Error("reset"));
    expect(b.connected).toBe(false);
    expect(seen).toEqual(["down"]);
    expect(clients[0].ended).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(b.connected).toBe(true);
    expect(seen).toEqual(["down", "up", "resync"]);
    clients[1].notify("ua");
    await vi.advanceTimersByTimeAsync(60);
    expect(seen.at(-1)).toBe("change");
  });

  it("retries a database that is not there yet, and says up once it is", async () => {
    connectFails = 2;
    const b = bus();
    const seen: string[] = [];
    b.subscribe("ua", (r: string) => seen.push(r));
    await b.start();
    expect(b.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(b.connected).toBe(true);
    expect(seen).toEqual(["up"]);
  });

  it("does not throw when it cannot connect, and gives up cleanly when closed", async () => {
    connectFails = 99;
    const b = bus();
    await expect(b.start()).resolves.toBeUndefined();
    await b.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(clients).toHaveLength(0);
  });

  it("finds a connection that went quiet by asking it something", async () => {
    const b = bus({ pingMs: 1000 });
    await b.start();
    const seen: string[] = [];
    b.subscribe("ua", (r: string) => seen.push(r));
    clients[0].failQuery = "SELECT 1";
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen).toEqual(["down", "up", "resync"]);
    expect(clients).toHaveLength(2);
    await b.close();
  });

  it("closes its connection, forgets its subscribers, and does not reconnect", async () => {
    const b = bus();
    await b.start();
    b.subscribe("ua", () => {});
    await b.close();
    expect(clients[0].ended).toBe(true);
    expect(b.subscribers).toBe(0);
    clients[0].emit("end");
    await vi.advanceTimersByTimeAsync(500);
    expect(clients).toHaveLength(1);
  });
});
