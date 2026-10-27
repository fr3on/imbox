import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, seedAccount, signIn, testEnv, wipeAll } from "../api-harness";
import type { AccountRow } from "../../src/api/db";

// A check that finds nothing still counts as a check: "Synced 2 minutes ago" says when the mailbox was last looked at.
vi.mock("../../src/api/imapbox", async (orig) => ({ ...(await orig<typeof import("../../src/api/imapbox")>()), syncImapAccount: vi.fn(async () => ({ added: 0 })) }));
import { syncAccount } from "../../src/api/sync";

beforeAll(migrate);

describe("a sync that finds nothing", () => {
  it("still stamps the time it looked, on every check", async () => {
    await wipeAll();
    await signIn("qs");
    await seedAccount("qs-imap", "qs@imap.test", { user: "qs", provider: "imap" });
    const read = async () => (await testEnv.DB.prepare(`SELECT * FROM accounts WHERE id = 'qs-imap'`).first<AccountRow>())!;
    const recent = Date.now() - 60_000;
    await testEnv.DB.prepare(`UPDATE accounts SET last_synced_at = ?, sync_status = 'idle', initial_sync_done = 1 WHERE id = 'qs-imap'`).bind(recent).run();

    const r = await syncAccount(testEnv, await read());
    expect(r).toEqual({ added: 0, status: "ok" });
    expect((await read()).last_synced_at).toBeGreaterThan(recent + 30_000);
  });
});
