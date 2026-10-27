import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";

// "Try it" on the agent form: a sample email in, the answer the agent would give out, and nothing written anywhere.

let token = "";
beforeAll(async () => {
  await migrate();
  (testEnv as unknown as Record<string, string>).AI_MOCK = "1";
});
afterAll(() => {
  delete (testEnv as unknown as Record<string, string>).AI_MOCK;
});
beforeEach(async () => {
  await wipeAll();
  token = await signIn("u1");
});

const count = async (table: string) => (await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe("POST /api/auto-agents/try", () => {
  it("asks for a sample email", async () => {
    const res = await call("POST", "/api/auto-agents/try", { token, body: { instructions: "Be brief.", sample: "  " } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe("missing_sample");
  });

  it("says so when no AI provider is set up", async () => {
    const res = await call("POST", "/api/auto-agents/try", { token, body: { instructions: "Be brief.", sample: "Hello?" } });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toBe("ai_not_configured");
  });

  it("gives back what the agent would do, and saves and sends nothing", async () => {
    expect((await call("PUT", "/api/ai/settings", { token, body: { preset: "mock" } })).status).toBe(200);
    const before = [await count("auto_agents"), await count("drafts"), await count("auto_agent_runs")];
    const res = await call("POST", "/api/auto-agents/try", { token, body: { name: "Support", instructions: "Answer sign-in questions.", sample: "I can't sign in." } });
    expect(res.status).toBe(200);
    const out = await json<{ action: string; text: string }>(res);
    expect(["reply", "leave"]).toContain(out.action);
    expect(out.text.length).toBeGreaterThan(0);
    expect([await count("auto_agents"), await count("drafts"), await count("auto_agent_runs")]).toEqual(before);
  });
});
