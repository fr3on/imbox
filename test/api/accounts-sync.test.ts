import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, testEnv } from "../api-harness";
import { seedWorld, type World } from "../api-world";

// The sync itself goes to Gmail, IMAP and Outlook, so it is replaced here; what is under test is which mailboxes a request syncs, how many at a time,
// and what it answers.
vi.mock("../../src/api/sync", async (orig) => {
  const actual = await orig<typeof import("../../src/api/sync")>();
  return { ...actual, syncAccount: vi.fn() };
});
import { syncAccount } from "../../src/api/sync";
const sync = syncAccount as unknown as ReturnType<typeof vi.fn>;

let a: World;
let b: World;
const as = (w: World, path: string, body?: unknown) => call("POST", path, { token: w.token, ...(body === undefined ? {} : { body }) });
const synced = () => sync.mock.calls.map((c) => (c[1] as { id: string }).id).sort();

beforeAll(async () => {
  a = await seedWorld("ua");
  b = await seedWorld("ub");
  await testEnv.DB.prepare(`UPDATE accounts SET scopes = 'https://www.googleapis.com/auth/gmail.modify' WHERE id = ?`).bind(a.gmail).run();
});
beforeEach(() => {
  sync.mockReset();
  sync.mockImplementation(async () => ({ added: 2, status: "ok" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/accounts/sync", () => {
  it("syncs every mailbox that is polled, once each, in one request", async () => {
    const res = await as(a, "/api/accounts/sync", {});
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(synced()).toEqual([a.agentAccount, a.gmail, a.imap].sort());
    expect(body.ok).toBe(true);
    expect(body.added).toBe(6);
    expect(body.results.map((r: { id: string }) => r.id).sort()).toEqual(synced());
  });

  it("leaves out domain mailboxes and disconnected ones when no list is given", async () => {
    await testEnv.DB.prepare(`UPDATE accounts SET sync_status = 'disconnected' WHERE id = ?`).bind(a.imap).run();
    await as(a, "/api/accounts/sync", {});
    expect(synced()).toEqual([a.agentAccount, a.gmail].sort());
  });

  it("syncs only the mailboxes named, and never another user's", async () => {
    const res = await as(a, "/api/accounts/sync", { ids: [a.imap, b.imap, "nope", 5] });
    expect(synced()).toEqual([a.imap]);
    expect((await json(res)).results).toHaveLength(1);
  });

  it("answers a domain mailbox, or one connected for the calendar only, as synced without fetching", async () => {
    await testEnv.DB.prepare(`UPDATE accounts SET scopes = 'https://www.googleapis.com/auth/calendar' WHERE id = ?`).bind(a.gmail).run();
    const res = await json(await as(a, "/api/accounts/sync", { ids: [a.domainAccount, a.gmail] }));
    expect(sync).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(res.results.map((r: { ok: boolean; added: number }) => [r.ok, r.added])).toEqual([[true, 0], [true, 0]]);
  });

  it("carries on when one mailbox fails, and says which", async () => {
    sync.mockImplementation(async (_e: unknown, acc: { id: string }) => {
      if (acc.id === a.imap) throw new Error("connection refused");
      if (acc.id === a.agentAccount) return { added: 0, status: "error" };
      return { added: 3, status: "ok" };
    });
    const res = await json(await as(a, "/api/accounts/sync", {}));
    expect(res.ok).toBe(false);
    expect(Object.fromEntries(res.results.map((r: { id: string; ok: boolean; status: string }) => [r.id, [r.ok, r.status]]))).toEqual({
      [a.gmail]: [true, "ok"], [a.imap]: [false, "error"], [a.agentAccount]: [false, "error"],
    });
    expect(res.added).toBe(3);
  });

  it("runs a few at a time, not all together", async () => {
    for (let i = 0; i < 9; i++) {
      await testEnv.DB.prepare(`INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, scopes, initial_sync_done, sync_status, signature, cover_art, avatar_url, created_at) VALUES (?, ?, 'imap', ?, '', '', '', '', 1, 'idle', '', '', '', ?)`).bind(`many-${i}`, a.user, `many${i}@x.test`, Date.now()).run();
    }
    let running = 0;
    let peak = 0;
    sync.mockImplementation(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return { added: 0, status: "ok" };
    });
    await as(a, "/api/accounts/sync", {});
    expect(sync).toHaveBeenCalledTimes(12);
    expect(peak).toBe(6);
  });

  it("answers with nothing to do when there is nothing to sync, and takes no body", async () => {
    const res = await call("POST", "/api/accounts/sync", { token: a.token });
    expect(res.status).toBe(200);
    expect(synced()).toEqual([a.agentAccount, a.gmail, a.imap].sort());
    const none = await json(await as(a, "/api/accounts/sync", { ids: [] }));
    expect(none).toEqual({ ok: true, added: 0, results: [] });
  });

  it("needs a signed-in user", async () => {
    expect((await call("POST", "/api/accounts/sync", { body: {} })).status).toBe(401);
  });
});

describe("POST /api/accounts/:id/sync", () => {
  it("still syncs one mailbox, and refuses one that is not the user's", async () => {
    const res = await json(await as(a, `/api/accounts/${a.imap}/sync`));
    expect(res).toMatchObject({ ok: true, added: 2, status: "ok" });
    expect(synced()).toEqual([a.imap]);
    expect((await as(a, `/api/accounts/${b.imap}/sync`)).status).toBe(404);
  });
});
