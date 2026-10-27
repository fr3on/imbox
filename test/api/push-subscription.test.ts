import { beforeAll, describe, expect, it } from "vitest";
import { call, json, signIn, testEnv } from "../api-harness";

// A browser may swap its push subscription for a new one. The server then forgets the old address and keeps what the person had chosen.

const keys = { p256dh: "p".repeat(60), auth: "a".repeat(20) };
const OLD = "https://push.example.com/send/old-device";
const NEW = "https://push.example.com/send/new-device";
let token: string;
let other: string;
const rows = async () => (await testEnv.DB.prepare(`SELECT endpoint, types_json FROM push_subscriptions ORDER BY endpoint`).all<{ endpoint: string; types_json: string }>()).results;

beforeAll(async () => {
  token = await signIn("psub1");
  other = await signIn("psub2");
});

describe("replacing a push subscription", () => {
  it("moves the person's choices to the new address and forgets the old one", async () => {
    await call("POST", "/api/push/subscribe", { token, body: { endpoint: OLD, keys, types: { mail: false } } });
    const res = await call("POST", "/api/push/subscribe", { token, body: { endpoint: NEW, keys, replaces: OLD } });
    expect(res.status).toBe(200);
    const all = await rows();
    expect(all.map((r) => r.endpoint)).toEqual([NEW]);
    expect(JSON.parse(all[0].types_json).mail).toBe(false);
    expect((await json(await call("POST", "/api/push/status", { token, body: { endpoint: OLD } }))).subscribed).toBe(false);
    expect((await json(await call("POST", "/api/push/status", { token, body: { endpoint: NEW } }))).subscribed).toBe(true);
  });

  it("does not remove someone else's subscription by naming its address", async () => {
    await call("POST", "/api/push/subscribe", { token: other, body: { endpoint: OLD, keys } });
    await call("POST", "/api/push/subscribe", { token, body: { endpoint: "https://push.example.com/send/third", keys, replaces: OLD } });
    expect((await rows()).map((r) => r.endpoint)).toContain(OLD);
  });
});
