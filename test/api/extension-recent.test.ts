import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { extensionMayCall, hashToken, newToken } from "../../src/api/extensionTokens";

// The extension's side panel lists the latest Imbox threads. A token may read that list and nothing else about mail.

let token = "";
beforeAll(migrate);
beforeEach(async () => {
  await wipeAll();
  await signIn("u1");
  const acc = "a1";
  await seedAccount(acc, "maya@chen.test");
  await seedThread(acc, { subject: "Quarterly numbers", from: "sara@example.org" });
  await seedThread(acc, { subject: "From the door", bucket: "screener", from: "new@example.org" });
  token = newToken();
  await testEnv.DB.prepare(`INSERT INTO extension_tokens (id, user_id, name, created_at) VALUES (?, 'u1', 'test', ?)`).bind(await hashToken(token), Date.now()).run();
});

describe("GET /api/imbox/recent", () => {
  it("is on the list of what a token may call, and the thread list is not", () => {
    expect(extensionMayCall("GET", "/api/imbox/recent")).toBe(true);
    expect(extensionMayCall("GET", "/api/imbox")).toBe(false);
    expect(extensionMayCall("GET", "/api/threads/x")).toBe(false);
  });

  it("gives a token the latest Imbox threads, without the Screener's", async () => {
    const res = await call("GET", "/api/imbox/recent?limit=5", { token });
    expect(res.status).toBe(200);
    const { threads } = await json<{ threads: { subject: string; email: string; unread: boolean }[] }>(res);
    expect(threads.map((t) => t.subject)).toEqual(["Quarterly numbers"]);
    expect(threads[0]).toMatchObject({ email: "sara@example.org", unread: true });
  });

  it("still refuses a token everything else about mail", async () => {
    expect((await call("GET", "/api/imbox", { token })).status).toBe(403);
    expect((await call("GET", "/api/feed", { token })).status).toBe(403);
  });
});
