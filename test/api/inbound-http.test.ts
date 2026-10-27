import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { call, json } from "../api-harness";
import { testEnv, seedUser } from "../helpers";

const SECRET = "inbound-test-secret";
const auth = { authorization: `Bearer ${SECRET}` };
const mime = (id: string, to = "maya@chen.test") =>
  `From: Sam Ortiz <sam@example.org>\r\nTo: ${to}\r\nSubject: Quarterly plan\r\nMessage-ID: <${id}@example.org>\r\nDate: Tue, 01 Oct 2026 09:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nHello Maya.\r\n`;
const post = (to: string, raw: string, headers: Record<string, string> = auth) => call("POST", `/inbound/mail?to=${encodeURIComponent(to)}&from=sam@example.org`, { raw, headers: { "content-type": "message/rfc822", ...headers } });
const count = async () => (await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM messages`).first<{ n: number }>())!.n;

beforeEach(async () => {
  (testEnv as any).INBOUND_SECRET = SECRET;
  await seedUser();
  await testEnv.DB.prepare(
    `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, scopes, initial_sync_done, sync_status, signature, cover_art, avatar_url, created_at)
     VALUES ('dom1', 'u1', 'domain', 'maya@chen.test', 'Maya Chen', '', '', '', 1, 'idle', '', '', '', ?)`
  ).bind(Date.now()).run();
});
afterEach(() => {
  delete (testEnv as any).INBOUND_SECRET;
});

describe("POST /inbound/mail", () => {
  it("does not exist until INBOUND_SECRET is set", async () => {
    delete (testEnv as any).INBOUND_SECRET;
    expect((await post("maya@chen.test", mime("a"))).status).toBe(404);
  });

  it("refuses a missing or wrong secret and stores nothing", async () => {
    expect((await post("maya@chen.test", mime("a"), {})).status).toBe(401);
    expect((await post("maya@chen.test", mime("a"), { authorization: "Bearer nope" })).status).toBe(401);
    expect(await count()).toBe(0);
  });

  it("stores a message for a mailbox, once however often it is sent", async () => {
    const first = await post("maya@chen.test", mime("one"));
    expect(first.status).toBe(202);
    expect(await json(first)).toEqual({ ok: true, stored: true });
    expect(await count()).toBe(1);
    const again = await post("maya@chen.test", mime("one"));
    expect(again.status).toBe(202);
    expect((await json(again)).stored).toBe(false);
    expect(await count()).toBe(1);
  });

  it("tells the sender when there is no such mailbox, so it can bounce", async () => {
    expect((await post("nobody@chen.test", mime("b", "nobody@chen.test"))).status).toBe(404);
    expect(await count()).toBe(0);
  });

  it("delivers to the domain's catch-all mailbox", async () => {
    await testEnv.DB.prepare(`INSERT INTO domains (id, user_id, name, catch_all_account_id, created_at, updated_at) VALUES ('d1', 'u1', 'chen.test', 'dom1', ?, ?)`).bind(Date.now(), Date.now()).run();
    expect((await post("anything@chen.test", mime("c", "anything@chen.test"))).status).toBe(202);
    expect(await count()).toBe(1);
  });

  it("needs a recipient", async () => {
    expect((await call("POST", "/inbound/mail", { raw: mime("d"), headers: auth })).status).toBe(400);
  });
});
