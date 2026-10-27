import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { confidenceLevel, jevSuggestForSenders } from "../../src/api/ai/jev";

// A stand-in for api.typesafe.ai: it checks what imbox sends and answers with what the real service answers with.
let server: Server;
let calls: { auth: string | undefined; body: any }[] = [];
let reply: (body: any) => { status: number; json: unknown } = () => ({ status: 200, json: {} });

beforeAll(async () => {
  await migrate();
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ auth: req.headers.authorization, body });
      const out = reply(body);
      res.statusCode = out.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  testEnv.TYPESAFE_API_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.close();
  delete testEnv.TYPESAFE_API_URL;
});
beforeEach(async () => {
  calls = [];
  reply = (body) => ({
    status: 200,
    json: {
      model: "jev-1.13.0",
      answers: {
        ...(body.questions.phishing ? { phishing: { type: "noul", noul: 0.93 }, pressure: { type: "score", score: 1.8, confidence: 0.9, legend: {}, probabilities: {} } } : {}),
        ...(body.questions.bucket ? { bucket: { type: "choice", choice: "feed", confidence: 0.95, probabilities: { feed: 0.97 } }, person: { type: "noul", noul: 0.04 } } : {}),
        ...(body.questions.place
          ? { needs_reply: { type: "noul", noul: 0.85 }, has_deadline: { type: "noul", noul: 0.5 }, person: { type: "noul", noul: 0.1 }, place: { type: "choice", choice: "screened_out", confidence: 0.88, probabilities: {} }, tone: { type: "choice", choice: "pushy", confidence: 0.7, probabilities: {} } }
          : {}),
      },
      usage: { input_tokens: 300, output_tokens: 40 },
    },
  });
});

const KEY = "tsk_test_key_0123456789";
const info = async (token: string) => json<any>(await call("GET", "/api/ai/jev", { token }));

describe("Jev settings", () => {
  it("starts off, takes a key, keeps it hidden, and each decision has its own switch", async () => {
    await wipeAll();
    const token = await signIn("jv");
    expect(await info(token)).toMatchObject({ configured: false, enabled: false });

    expect((await call("PUT", "/api/ai/jev", { token, body: { enabled: true } })).status).toBe(400);
    expect((await call("PUT", "/api/ai/jev", { token, body: { api_key: "short" } })).status).toBe(400);

    const saved = await json<any>(await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true } }));
    expect(saved).toMatchObject({ configured: true, enabled: true, key_hint: "tsk_…6789" });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(saved.capabilities.map((c: any) => [c.id, c.enabled])).toEqual([["phishing", true], ["screener", true], ["checks", true]]);
    // The key is stored encrypted.
    const row = await testEnv.DB.prepare(`SELECT key_enc FROM jev_settings WHERE user_id = 'jv'`).first<{ key_enc: string }>();
    expect(row?.key_enc).toBeTruthy();
    expect(row?.key_enc).not.toContain(KEY);

    const off = await json<any>(await call("PUT", "/api/ai/jev", { token, body: { features: { phishing: false } } }));
    expect(off.capabilities.map((c: any) => [c.id, c.enabled])).toEqual([["phishing", false], ["screener", true], ["checks", true]]);

    const none = await json<any>(await call("PUT", "/api/ai/jev", { token, body: { api_key: null } }));
    expect(none).toMatchObject({ configured: false, enabled: false });
    expect(none.capabilities.every((c: any) => !c.enabled)).toBe(true);
  });

  it("keeps one person's key from another", async () => {
    await wipeAll();
    const a = await signIn("jv2");
    const b = await signIn("jv2-other");
    await call("PUT", "/api/ai/jev", { token: a, body: { api_key: KEY, enabled: true } });
    expect(await info(b)).toMatchObject({ configured: false, enabled: false });
  });
});

describe("the phishing check", () => {
  const seed = async (user: string, o: { from?: string; bucket?: string } = {}) => {
    const token = await signIn(user);
    await seedAccount(`${user}-acc`, `${user}@example.test`, { user });
    const { thread, message } = await seedThread(`${user}-acc`, { subject: "Password Expiry Notice", from: o.from ?? "dana@elsewhere.example", bucket: o.bucket ?? "screener" });
    return { token, thread, message };
  };

  it("does nothing, and sends nothing, while Jev is off", async () => {
    await wipeAll();
    const { token, thread } = await seed("jp1");
    expect(await json(await call("POST", "/api/ai/jev/phishing", { token, body: { thread_id: thread } }))).toEqual({ enabled: false });
    expect(calls).toHaveLength(0);
  });

  it("asks once with the right request, keeps the answer, and says so in the log and the usage record", async () => {
    await wipeAll();
    const { token, thread } = await seed("jp2");
    await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true } });

    const first = await json<any>(await call("POST", "/api/ai/jev/phishing", { token, body: { thread_id: thread } }));
    expect(first).toMatchObject({ enabled: true, probability: 0.93 });
    expect(first.pressure).toBeCloseTo(0.9, 5);
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe(`Bearer ${KEY}`);
    expect(calls[0].body.model).toBe("jev-latest");
    expect(Object.keys(calls[0].body.questions)).toEqual(["phishing", "pressure"]);
    expect(calls[0].body.state).toMatchObject({ subject: "Password Expiry Notice", from: { email: "dana@elsewhere.example" } });

    const again = await json<any>(await call("POST", "/api/ai/jev/phishing", { token, body: { thread_id: thread } }));
    expect(again).toMatchObject({ probability: 0.93, cached: true });
    expect(calls).toHaveLength(1);

    const log = await json<any>(await call("GET", "/api/activity?actor=ai", { token }));
    expect(log.events.some((e: any) => e.kind === "phishing_check" && /93% likely phishing/.test(e.summary) && e.level === "warn")).toBe(true);
    const used = await testEnv.DB.prepare(`SELECT feature, input_tokens, output_tokens, model FROM ai_calls WHERE user_id = 'jp2'`).first<any>();
    expect(used).toMatchObject({ feature: "jev_phishing", input_tokens: 300, output_tokens: 40, model: "jev-1.13.0" });
    expect((await info(token)).capabilities.find((c: any) => c.id === "phishing").calls_30d).toBe(1);
  });

  it("leaves mail from people already let in alone, and does not make a switched-off decision", async () => {
    await wipeAll();
    const { token, thread } = await seed("jp3", { from: "friend@example.com", bucket: "imbox" });
    await testEnv.DB.prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at, message_count, notes) VALUES ('jp3-c', 'jp3-acc', 'friend@example.com', 'Friend', 'imbox', 1, 1, 1, '')`).run();
    await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true } });
    expect(await json(await call("POST", "/api/ai/jev/phishing", { token, body: { thread_id: thread } }))).toMatchObject({ enabled: true, skipped: "known" });
    await call("PUT", "/api/ai/jev", { token, body: { features: { phishing: false } } });
    expect(await json(await call("POST", "/api/ai/jev/phishing", { token, body: { thread_id: thread } }))).toEqual({ enabled: false });
    expect(calls).toHaveLength(0);
  });

  it("refuses a thread that is not yours", async () => {
    await wipeAll();
    const { thread } = await seed("jp4");
    const other = await signIn("jp4-other");
    await call("PUT", "/api/ai/jev", { token: other, body: { api_key: KEY, enabled: true } });
    expect((await call("POST", "/api/ai/jev/phishing", { token: other, body: { thread_id: thread } })).status).toBe(404);
  });

  it("says what went wrong when TypeSafe refuses, and does not keep a failure", async () => {
    await wipeAll();
    const { token, thread } = await seed("jp5");
    await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true } });
    reply = () => ({ status: 401, json: { error: "unauthorized" } });
    const out = await json<any>(await call("POST", "/api/ai/jev/phishing", { token, body: { thread_id: thread } }));
    expect(out).toMatchObject({ enabled: true });
    expect(out.error).toMatch(/did not accept that key/);
    expect((await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM jev_checks`).first<{ n: number }>())?.n).toBe(0);
    expect((await testEnv.DB.prepare(`SELECT ok FROM ai_calls WHERE user_id = 'jp5'`).first<{ ok: number }>())?.ok).toBe(0);
  });
});

describe("quick checks on a message", () => {
  const seed = async (user: string, bucket = "trash") => {
    const token = await signIn(user);
    await seedAccount(`${user}-acc`, `${user}@example.test`, { user });
    const { thread } = await seedThread(`${user}-acc`, { subject: "Password Expiry Notice", from: "dana@elsewhere.example", bucket });
    return { token, thread };
  };

  it("answers the questions as readable rows, for a thread anywhere, and says it was used", async () => {
    await wipeAll();
    const { token, thread } = await seed("jc1");
    await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true } });
    const out = await json<any>(await call("POST", "/api/ai/jev/checks", { token, body: { thread_id: thread } }));
    expect(out.enabled).toBe(true);
    expect(Object.keys(calls[0].body.questions)).toEqual(["phishing", "pressure", "needs_reply", "has_deadline", "person", "place", "tone"]);
    const by = Object.fromEntries(out.checks.map((c: any) => [c.id, c]));
    expect(by.phishing).toMatchObject({ text: "Likely", pct: 93, flag: true });
    expect(by.pressure).toMatchObject({ text: "Strong", pct: 90, flag: true });
    expect(by.needs_reply).toMatchObject({ text: "Yes", pct: 85, flag: false });
    expect(by.has_deadline).toMatchObject({ text: "Maybe", pct: 50 });
    expect(by.person).toMatchObject({ text: "No", pct: 10 });
    expect(by.place).toMatchObject({ text: "Screened out", pct: 88, flag: true });
    expect(by.tone).toMatchObject({ text: "Pushy", pct: 70, flag: true });
    expect(out.tokens).toBe(340);
    expect((await testEnv.DB.prepare(`SELECT feature FROM ai_calls WHERE user_id = 'jc1'`).first<{ feature: string }>())?.feature).toBe("jev_checks");
    expect((await json<any>(await call("GET", "/api/activity", { token }))).events.some((e: any) => e.kind === "jev_checks")).toBe(true);
    expect((await info(token)).capabilities.find((c: any) => c.id === "checks").calls_30d).toBe(1);
  });

  it("is off until Jev is set up, and when its own switch is off", async () => {
    await wipeAll();
    const { token, thread } = await seed("jc2");
    expect(await json(await call("POST", "/api/ai/jev/checks", { token, body: { thread_id: thread } }))).toEqual({ enabled: false, configured: false });
    await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true, features: { checks: false } } });
    expect(await json(await call("POST", "/api/ai/jev/checks", { token, body: { thread_id: thread } }))).toEqual({ enabled: false, configured: true });
    expect(calls).toHaveLength(0);
  });

  it("refuses a thread that is not yours, and says what went wrong when TypeSafe refuses", async () => {
    await wipeAll();
    const { token, thread } = await seed("jc3");
    const other = await signIn("jc3-other");
    await call("PUT", "/api/ai/jev", { token: other, body: { api_key: KEY, enabled: true } });
    expect((await call("POST", "/api/ai/jev/checks", { token: other, body: { thread_id: thread } })).status).toBe(404);
    await call("PUT", "/api/ai/jev", { token, body: { api_key: KEY, enabled: true } });
    reply = () => ({ status: 429, json: {} });
    const out = await json<any>(await call("POST", "/api/ai/jev/checks", { token, body: { thread_id: thread } }));
    expect(out.error).toMatch(/too many requests/);
  });
});

describe("the sample run and the Screener", () => {
  it("shows what Jev answers for made-up examples, using a typed key or the saved one", async () => {
    await wipeAll();
    const token = await signIn("js1");
    expect((await call("POST", "/api/ai/jev/test", { token, body: {} })).status).toBe(400);
    const out = await json<any>(await call("POST", "/api/ai/jev/test", { token, body: { api_key: KEY } }));
    expect(out.ok).toBe(true);
    expect(out.samples.map((s: any) => s.id)).toEqual(["phishing", "screener"]);
    expect(out.samples[0].output).toMatch(/93% likely phishing/);
    expect(out.samples[1].output).toMatch(/newsletter or an update \(95% sure\)/);
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    // A test is not counted as use.
    expect((await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = 'js1'`).first<{ n: number }>())?.n).toBe(0);
  });

  it("turns Jev's answer into the suggestion the Screener keeps, and counts each call", async () => {
    await wipeAll();
    await signIn("js2");
    const senders = ["a@news.example", "b@shop.example", "c@bank.example"].map((email) => ({ email, name: "", subjects: ["Hello"], snippet: "Hi", unsubscribe: false, messages: 1, rule_guess: "imbox" as const }));
    const found = await jevSuggestForSenders(testEnv as any, "js2", KEY, senders, () => []);
    expect([...found.keys()].sort()).toEqual(["a@news.example", "b@shop.example", "c@bank.example"]);
    expect(found.get("a@news.example")).toEqual({ bucket: "feed", confidence: "high", reason: "Looks like a newsletter or an update (95% sure)", person: false });
    expect((await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = 'js2' AND feature = 'jev_screener'`).first<{ n: number }>())?.n).toBe(3);
  });

  it("throws when every call fails, so the usual model can answer instead", async () => {
    await wipeAll();
    await signIn("js3");
    reply = () => ({ status: 429, json: {} });
    await expect(jevSuggestForSenders(testEnv as any, "js3", KEY, [{ email: "a@x.example", name: "", subjects: [], snippet: "", unsubscribe: false, messages: 1, rule_guess: "imbox" }], () => [])).rejects.toThrow(/too many requests/);
  });
});

describe("confidence", () => {
  it("is high above 0.9, medium from 0.5, and low below", () => {
    expect([0.95, 0.9, 0.7, 0.5, 0.49, 0].map(confidenceLevel)).toEqual(["high", "high", "medium", "medium", "low", "low"]);
  });
});
