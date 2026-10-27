import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, testEnv } from "../api-harness";
import { seedWorld, type World } from "../api-world";
import { cleanContinuation } from "../../src/api/ai/complete";

/** Grey words that finish a sentence in a reply: off until switched on, quiet about every reason there is none, and clean when there is one. */

let w: World;
const as = (method: string, path: string, body?: unknown) => call(method, path, { token: w.token, ...(body === undefined ? {} : { body }) });
const ask = async (before: string) => (await (await as("POST", "/api/ai/complete", { before, context: "Can you send the signed copy by Friday?", subject: "Contract", to: "Maya Chen" })).json()) as { text: string };
const SO_FAR = "Thanks for sending this over, I will";

beforeAll(async () => {
  w = await seedWorld("ucp");
  (testEnv as unknown as Record<string, string>).AI_MOCK = "1"; // the mock AI provider, so a provider counts as set up
});
afterAll(() => {
  delete (testEnv as unknown as Record<string, string>).AI_MOCK;
});

describe("asking for the next words", () => {
  const setUp = async (switchOn: boolean) => {
    expect((await as("PUT", "/api/ai/settings", { preset: "mock" })).status).toBe(200);
    if (switchOn) expect((await as("PATCH", "/api/me", { settings: { aiComplete: true } })).status).toBe(200);
  };

  it("says nothing until the switch is on, though an AI is set up", async () => {
    await setUp(false);
    expect((await ask(SO_FAR)).text).toBe("");
  });

  it("with the switch on but no AI set up, says nothing rather than failing", async () => {
    expect((await as("PATCH", "/api/me", { settings: { aiComplete: true } })).status).toBe(200);
    const res = await as("POST", "/api/ai/complete", { before: SO_FAR });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("");
  });

  it("answers when the switch is on and an AI is set up", async () => {
    await setUp(true);
    expect((await ask(SO_FAR)).text).not.toBe("");
  });

  it("says nothing for text too short to go on", async () => {
    await setUp(true);
    expect((await ask("Hi")).text).toBe("");
  });

  it("turns bad input into nothing, not a failure", async () => {
    const res = await as("POST", "/api/ai/complete", { before: 42 });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("");
  });

  it("needs a signed-in user", async () => {
    expect((await call("POST", "/api/ai/complete", { body: { before: SO_FAR } })).status).toBe(401);
  });
});

describe("cleaning what the model said", () => {
  it("keeps one plain line", () => {
    expect(cleanContinuation('  "get\nit  to you by Friday."  ', "I will")).toBe("get it to you by Friday.");
  });

  it("drops an answer that only starts over from the last words", () => {
    expect(cleanContinuation("send it to you by Friday", "Thanks, I will send it to you by Friday")).toBe("");
    expect(cleanContinuation("Thanks for sending this over, I will do it", SO_FAR)).toBe("");
  });

  it("gives nothing for nothing", () => {
    expect(cleanContinuation("   ", SO_FAR)).toBe("");
    expect(cleanContinuation("...", SO_FAR)).toBe("");
  });

  it("cuts a long answer at a word", () => {
    const out = cleanContinuation("word ".repeat(100), SO_FAR);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("word")).toBe(true);
  });
});
