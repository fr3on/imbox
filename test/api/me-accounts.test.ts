import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount, seedAgent } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * What a page load asks the server about the person and their mailboxes: who they are, which mailboxes they have and which of them an outside agent
 * owns, how far a long re-sync has got, and the state of the two-factor and passkey settings. Pinned before the reads behind them were joined.
 */

const db = () => testEnv.DB;
let token: string;
let other: string;
const get = (path: string, t = token) => call("GET", path, { token: t });

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("mau");
  other = await signIn("mav");
  await seedAccount("ma-1", "one@test.local", { user: "mau" });
  await seedAccount("ma-2", "two@test.local", { user: "mau" });
  await seedAccount("ma-agent", "agent@test.local", { user: "mau" });
  await seedAccount("ma-o", "o@test.local", { user: "mav" });
  await db().prepare(`UPDATE accounts SET created_at = ? WHERE id = ?`).bind(1, "ma-1").run();
  await db().prepare(`UPDATE accounts SET created_at = ? WHERE id = ?`).bind(2, "ma-2").run();
  await db().prepare(`UPDATE accounts SET created_at = ? WHERE id = ?`).bind(3, "ma-agent").run();
  await seedAgent("ma-agent");
  await db().prepare(`INSERT INTO imap_accounts (account_id, imap_host, smtp_host, username, backlog, import_total, updated_at) VALUES ('ma-2', 'h', 'h', 'u', 40, 100, 1)`).run();
});

describe("GET /api/me", () => {
  it("says who the person is and lists their mailboxes oldest first, marking an agent's", async () => {
    const r = await json(await get("/api/me"));
    expect(r.user).toMatchObject({ email: "mau@test.local" });
    expect(r.accounts.map((a: any) => a.id)).toEqual(["ma-1", "ma-2", "ma-agent"]);
    expect(r.accounts.map((a: any) => !!a.is_agent)).toEqual([false, false, true]);
    expect(r).toMatchObject({ setup_required: false });
  });

  it("does not list another person's mailboxes", async () => {
    const r = await json(await get("/api/me", other));
    expect(r.accounts.map((a: any) => a.id)).toEqual(["ma-o"]);
  });

  it("answers someone who is not signed in with no user, and says whether the first account is still to be made", async () => {
    const r = await json(await call("GET", "/api/me"));
    expect(r).toMatchObject({ user: null, accounts: [], setup_required: false });
  });

  it("asks the database for a few things, and the session once", async () => {
    await get("/api/me"); // a session made before tokens were hashed is rewritten by its first use; this is the ones after it
    resetStatements();
    await get("/api/me");
    const sessionReads = sent.sql.filter((s) => /FROM sessions s JOIN users u/.test(s)).length;
    expect(sessionReads).toBe(1);
    expect(sent.statements).toBeLessThanOrEqual(3);
  });
});

describe("GET /api/accounts", () => {
  it("lists the mailboxes with the agent's marked and a running re-sync's progress", async () => {
    const r = await json(await get("/api/accounts"));
    expect(r.map((a: any) => a.id)).toEqual(["ma-1", "ma-2", "ma-agent"]);
    expect(r.map((a: any) => !!a.is_agent)).toEqual([false, false, true]);
    const two = r.find((a: any) => a.id === "ma-2");
    expect(two.import_remaining).toBe(40);
    expect(two.import_total).toBe(100);
    expect(r.find((a: any) => a.id === "ma-1").import_remaining).toBeUndefined();
  });

  it("is a few statements", async () => {
    await get("/api/accounts");
    resetStatements();
    await get("/api/accounts");
    expect(sent.statements).toBeLessThanOrEqual(3);
  });
});

describe("two-factor and passkey settings", () => {
  it("say whether two-factor is on and how many recovery codes are left", async () => {
    expect(await json(await get("/api/me/2fa"))).toEqual({ enabled: false, recovery_left: 0 });
    await db().prepare(`UPDATE users SET totp_enabled = 1, totp_secret = 'x', recovery_codes_json = '["a","b","c"]' WHERE id = 'mau'`).run();
    expect(await json(await get("/api/me/2fa"))).toEqual({ enabled: true, recovery_left: 3 });
    await db().prepare(`UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes_json = '[]' WHERE id = 'mau'`).run();
  });

  it("list the person's passkeys and nobody else's", async () => {
    await db().prepare(`INSERT INTO passkeys (id, user_id, name, public_key, counter, device_type, backed_up, transports_json, created_at) VALUES ('pk1', 'mau', 'Laptop', 'k', 0, 'singleDevice', 0, '[]', 5), ('pk2', 'mav', 'Theirs', 'k', 0, 'singleDevice', 0, '[]', 6)`).run();
    const r = await json(await get("/api/me/passkeys"));
    expect(r.passkeys.map((p: any) => p.id)).toEqual(["pk1"]);
    await get("/api/me/passkeys");
    resetStatements();
    await get("/api/me/passkeys");
    expect(sent.statements).toBeLessThanOrEqual(2);
  });
});
