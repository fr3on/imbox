import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, testEnv } from "../helpers";
import { hourlyCleanup, resetCron, runCron } from "../../src/api/cron";
import { seedWorld } from "../api-world";

beforeEach(async () => {
  await migrate();
  resetCron();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the once-a-minute job", () => {
  it("runs on an empty server", async () => {
    await expect(runCron(testEnv)).resolves.toBeUndefined();
  });

  it("runs with a user, mailboxes and mail present, and keeps the mail", async () => {
    await seedWorld("uc");
    const count = async () => (await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM threads`).first<{ n: number }>())!.n;
    const before = await count();
    await runCron(testEnv);
    expect(await count()).toBe(before);
  });

  it("forgets old login attempts in the hourly cleanup, keeps a lockout still running, and does it once an hour", async () => {
    const t = Date.now();
    const day = 86_400_000;
    await testEnv.DB.prepare(`INSERT INTO login_attempts (key, attempts, last_attempt_at, locked_until) VALUES ('old', 1, ?, NULL), ('locked', 5, ?, ?), ('recent', 1, ?, NULL)`).bind(t - 5 * day, t - 5 * day, t + 1000, t).run();
    expect(await hourlyCleanup(testEnv, t)).toBe(true);
    const keys = (await testEnv.DB.prepare(`SELECT key FROM login_attempts ORDER BY key`).all<{ key: string }>()).results.map((r) => r.key);
    expect(keys).toEqual(["locked", "recent"]);
    expect(await hourlyCleanup(testEnv, t + 1000)).toBe(false);
  });

  it("puts right a contact's message count that does not match the mail stored", async () => {
    await seedWorld("ucc");
    const row = async () => (await testEnv.DB.prepare(`SELECT c.message_count AS n, (SELECT COUNT(*) FROM messages m WHERE m.account_id = c.account_id AND lower(m.from_email) = c.email AND m.is_from_me = 0) AS real FROM contacts c WHERE c.email = 'sender@example.com'`).first<{ n: number; real: number }>())!;
    await testEnv.DB.prepare(`UPDATE contacts SET message_count = 0 WHERE email = 'sender@example.com'`).run();
    const before = await row();
    expect(before.real).toBeGreaterThan(0);
    expect(before.n).toBe(0);
    await hourlyCleanup(testEnv, Date.now());
    expect((await row()).n).toBe(before.real);
  });
});
