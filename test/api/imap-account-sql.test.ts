import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { insertImapAccount } from "../../src/api/imapbox";

/**
 * Adding a mailbox on someone else's mail server writes two rows, the account and its server settings. They are one change: a failure between them used to leave
 * an account with no settings that nothing could sync and nobody could add again. And an address can be added once: two requests for it together ended as a
 * server error. The servers are stood in for; nothing is dialled.
 */

vi.mock("../../src/api/imapbox", async (orig) => ({ ...(await orig<Record<string, unknown>>()), verifyBoth: vi.fn(async () => {}) }));
vi.mock("../../src/api/sync", async (orig) => ({ ...(await orig<Record<string, unknown>>()), syncAccount: vi.fn(async () => ({})) }));

const db = () => testEnv.DB;
let token: string;
const add = (email: string, over: Record<string, unknown> = {}) =>
  call("POST", "/api/accounts/imap", { token, body: { email, password: "pw-pw-pw-pw", imap_host: "imap.example.org", smtp_host: "smtp.example.org", ...over } });

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("iau");
});
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("adding a mailbox", () => {
  it("stores the account and its server settings, with the password sealed", async () => {
    const r = await add("one@example.org", { display_name: "One", folder: "Mail" });
    expect(r.status).toBe(200);
    const id = (await json(r)).account.id;
    expect((await db().prepare(`SELECT provider, email, display_name, user_id FROM accounts WHERE id = ?`).bind(id).first())).toEqual({ provider: "imap", email: "one@example.org", display_name: "One", user_id: "iau" });
    const s = await db().prepare(`SELECT imap_host, imap_port, smtp_host, folder, username, password_enc FROM imap_accounts WHERE account_id = ?`).bind(id).first<any>();
    expect(s).toMatchObject({ imap_host: "imap.example.org", imap_port: 993, smtp_host: "smtp.example.org", folder: "Mail", username: "one@example.org" });
    expect(s.password_enc).toBeTruthy();
    expect(s.password_enc).not.toContain("pw-pw-pw-pw");
  });

  it("refuses an address the person already has", async () => {
    await add("two@example.org");
    expect((await add("two@example.org")).status).toBe(409);
  });

  it("says the address exists, and adds it once, when two requests for it arrive together", async () => {
    const answers = await Promise.all([add("race@example.org"), add("race@example.org"), add("race@example.org")]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM accounts WHERE email = 'race@example.org'`).first<{ n: number }>())!.n).toBe(1);
  });

  it("leaves nothing behind when the server settings cannot be stored", async () => {
    const cfg = { email: "half@example.org", display_name: "", imap_host: null as unknown as string, imap_port: 993, imap_security: "tls" as const, smtp_host: "s", smtp_port: 465, smtp_security: "tls" as const, username: "u", folder: "INBOX" };
    await expect(insertImapAccount(testEnv, "iau", cfg, "pw")).rejects.toThrow();
    expect(await db().prepare(`SELECT 1 FROM accounts WHERE email = 'half@example.org'`).first()).toBeNull();
  });
});
