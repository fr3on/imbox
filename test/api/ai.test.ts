import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, json, wipeAll } from "../api-harness";
import { seedWorld, type World } from "../api-world";

describe("AI settings routes", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  afterEach(async () => {
    await wipeAll();
  });

  it("GET /api/ai/settings returns default unconfigured state", async () => {
    const res = await call("GET", "/api/ai/settings", { token: w.token });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.preset).toBe("anthropic");
    expect(body.provider).toBe("anthropic");
    expect(body.server_ready).toBe(true);
    expect(Array.isArray(body.presets)).toBe(true);
    expect(body.presets.length).toBeGreaterThan(0);
  });

  it("PUT /api/ai/settings validates api_key length", async () => {
    // Key too short (< 8 chars)
    const shortRes = await call("PUT", "/api/ai/settings", { token: w.token, body: { api_key: "short" } });
    expect(shortRes.status).toBe(400);
    expect((await json<any>(shortRes)).error).toBe("invalid_key");

    // Key too long (> 2000 chars)
    const longRes = await call("PUT", "/api/ai/settings", { token: w.token, body: { api_key: "k".repeat(2001) } });
    expect(longRes.status).toBe(400);
    expect((await json<any>(longRes)).error).toBe("invalid_key");
  });

  it("PUT /api/ai/settings validates base_url protocol and length", async () => {
    // Non-http protocol
    const badProto = await call("PUT", "/api/ai/settings", { token: w.token, body: { base_url: "ftp://example.com" } });
    expect(badProto.status).toBe(400);
    expect((await json<any>(badProto)).error).toBe("base_url_must_be_http");

    // Too long
    const tooLong = await call("PUT", "/api/ai/settings", { token: w.token, body: { base_url: "https://" + "a".repeat(500) } });
    expect(tooLong.status).toBe(400);
    expect((await json<any>(tooLong)).error).toBe("base_url_too_long");
  });

  it("PUT /api/ai/settings validates custom preset address change without retyping key", async () => {
    // Save custom with key
    const initial = await call("PUT", "/api/ai/settings", {
      token: w.token,
      body: { preset: "custom", base_url: "https://llm.example.com", api_key: "sk-initial-secret-key" },
    });
    expect(initial.status).toBe(200);

    // Try changing base_url without typing key again
    const changeWithoutKey = await call("PUT", "/api/ai/settings", {
      token: w.token,
      body: { preset: "custom", base_url: "https://new-llm.example.com" },
    });
    expect(changeWithoutKey.status).toBe(400);
    expect((await json<any>(changeWithoutKey)).error).toBe("api_key_required");

    // Changing base_url with typed key succeeds
    const changeWithKey = await call("PUT", "/api/ai/settings", {
      token: w.token,
      body: { preset: "custom", base_url: "https://new-llm.example.com", api_key: "sk-new-secret-key" },
    });
    expect(changeWithKey.status).toBe(200);
  });

  it("PUT /api/ai/settings saves and updates flags and keys properly", async () => {
    const put = await call("PUT", "/api/ai/settings", {
      token: w.token,
      body: {
        preset: "anthropic",
        api_key: "sk-ant-test-long-key-12345",
        model: "claude-3-haiku",
        learn: false,
        auto_send: true,
        screener_suggest: false,
        daily_brief: false,
        suggest_actions: false,
      },
    });
    expect(put.status).toBe(200);
    const putBody = await json<any>(put);
    expect(putBody.ok).toBe(true);
    expect(putBody.model).toBe("claude-3-haiku");
    expect(putBody.learn).toBe(false);
    expect(putBody.auto_send).toBe(true);
    expect(putBody.screener_suggest).toBe(false);
    expect(putBody.daily_brief).toBe(false);
    expect(putBody.suggest_actions).toBe(false);
    expect(putBody.key_hint).toContain("sk-ant");

    // Verify GET roundtrips
    const get = await call("GET", "/api/ai/settings", { token: w.token });
    const getBody = await json<any>(get);
    expect(getBody.configured).toBe(true);
    expect(getBody.learn).toBe(false);
    expect(getBody.auto_send).toBe(true);
    expect(getBody.screener_suggest).toBe(false);
    expect(getBody.daily_brief).toBe(false);
    expect(getBody.suggest_actions).toBe(false);
    expect(getBody.key_hint).toBe(putBody.key_hint);

    // Clearing api_key with null
    const clearKey = await call("PUT", "/api/ai/settings", {
      token: w.token,
      body: { api_key: null },
    });
    expect(clearKey.status).toBe(200);
    const clearBody = await json<any>(clearKey);
    expect(clearBody.key_hint).toBe("");
  });
});

describe("AI usage route", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  it("GET /api/ai/usage returns usage breakdown and respects days param", async () => {
    const res = await call("GET", "/api/ai/usage?days=7", { token: w.token });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(body.days).toBe(7);
    expect(body.overview).toBeDefined();
    expect(body.totals).toBeDefined();
    expect(Array.isArray(body.series)).toBe(true);
    expect(Array.isArray(body.by_feature)).toBe(true);
    expect(Array.isArray(body.activity)).toBe(true);

    // Fallback to 30 for invalid days
    const fallback = await call("GET", "/api/ai/usage?days=42", { token: w.token });
    expect((await json<any>(fallback)).days).toBe(30);
  });
});

describe("AI memory routes", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  it("performs full memory CRUD", async () => {
    // 1. Initial list has memory from world seeding
    const initial = await call("GET", "/api/ai/memory", { token: w.token });
    expect(initial.status).toBe(200);
    expect(Array.isArray(await json<any>(initial))).toBe(true);

    // 2. POST without content fails
    const failPost = await call("POST", "/api/ai/memory", { token: w.token, body: { content: "  " } });
    expect(failPost.status).toBe(400);
    expect((await json<any>(failPost)).error).toBe("content_required");

    // 3. POST valid memory
    const postRes = await call("POST", "/api/ai/memory", { token: w.token, body: { content: "Prefers concise emails", kind: "preference" } });
    expect(postRes.status).toBe(200);
    const memory = await json<any>(postRes);
    expect(memory.id).toBeDefined();
    expect(memory.content).toBe("Prefers concise emails");

    // 4. PATCH memory
    const patchRes = await call("PATCH", `/api/ai/memory/${memory.id}`, { token: w.token, body: { content: "Prefers very concise emails" } });
    expect(patchRes.status).toBe(200);
    const patched = await json<any>(patchRes);
    expect(patched.content).toBe("Prefers very concise emails");

    // 5. DELETE specific memory
    const delRes = await call("DELETE", `/api/ai/memory/${memory.id}`, { token: w.token });
    expect(delRes.status).toBe(200);
    expect((await json<any>(delRes)).ok).toBe(true);

    // 6. DELETE /api/ai/memory clears all memory
    await call("POST", "/api/ai/memory", { token: w.token, body: { content: "Fact 1" } });
    await call("POST", "/api/ai/memory", { token: w.token, body: { content: "Fact 2" } });
    const clearRes = await call("DELETE", "/api/ai/memory", { token: w.token });
    expect(clearRes.status).toBe(200);
    expect((await json<any>(clearRes)).ok).toBe(true);
    const afterClear = await json<any[]>(await call("GET", "/api/ai/memory", { token: w.token }));
    expect(afterClear).toHaveLength(0);
  });
});

describe("AI conversation routes", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  it("creates, lists, retrieves, updates, and deletes conversations", async () => {
    // 1. Create conversation
    const createRes = await call("POST", "/api/ai/conversations", { token: w.token, body: {} });
    expect(createRes.status).toBe(200);
    const conv = await json<any>(createRes);
    expect(conv.id).toBeDefined();
    expect(conv.title).toBe("");

    // 2. List conversations
    const listRes = await call("GET", "/api/ai/conversations", { token: w.token });
    expect(listRes.status).toBe(200);
    const list = await json<any[]>(listRes);
    expect(list.some((c) => c.id === conv.id)).toBe(true);

    // 3. Get single conversation
    const getRes = await call("GET", `/api/ai/conversations/${conv.id}`, { token: w.token });
    expect(getRes.status).toBe(200);
    const single = await json<any>(getRes);
    expect(single.conversation.id).toBe(conv.id);
    expect(Array.isArray(single.messages)).toBe(true);

    // 4. Update conversation title
    const patchRes = await call("PATCH", `/api/ai/conversations/${conv.id}`, { token: w.token, body: { title: "New title" } });
    expect(patchRes.status).toBe(200);
    expect((await json<any>(patchRes)).ok).toBe(true);

    // 5. Delete conversation
    const delRes = await call("DELETE", `/api/ai/conversations/${conv.id}`, { token: w.token });
    expect(delRes.status).toBe(200);
    expect((await json<any>(delRes)).ok).toBe(true);

    // 6. Get non-existent conversation returns 404
    const notFound = await call("GET", `/api/ai/conversations/${conv.id}`, { token: w.token });
    expect(notFound.status).toBe(404);
  });
});

describe("AI actions and contact review state routes", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  it("POST /api/ai/actions/state validates inputs", async () => {
    // Missing required fields
    const missing = await call("POST", "/api/ai/actions/state", { token: w.token, body: {} });
    expect(missing.status).toBe(400);

    // Invalid state
    const badState = await call("POST", "/api/ai/actions/state", { token: w.token, body: { thread_id: w.thread, action_id: "act1", state: "invalid" } });
    expect(badState.status).toBe(400);

    // Valid state
    const okDone = await call("POST", "/api/ai/actions/state", { token: w.token, body: { thread_id: w.thread, action_id: "act1", state: "done" } });
    expect(okDone.status).toBe(200);
    expect((await json<any>(okDone)).ok).toBe(true);
  });

  it("POST /api/ai/contact-review/state validates inputs", async () => {
    // Missing email
    const missing = await call("POST", "/api/ai/contact-review/state", { token: w.token, body: { state: "dismissed" } });
    expect(missing.status).toBe(400);

    // Invalid state
    const badState = await call("POST", "/api/ai/contact-review/state", { token: w.token, body: { email: "sender@example.com", state: "pending" } });
    expect(badState.status).toBe(400);

    // Valid dismissed state
    const okDismissed = await call("POST", "/api/ai/contact-review/state", { token: w.token, body: { email: "sender@example.com", state: "dismissed" } });
    expect(okDismissed.status).toBe(200);
    expect((await json<any>(okDismissed)).ok).toBe(true);
  });

  it("GET /api/ai/contact-review returns status and suggestions", async () => {
    const res = await call("GET", "/api/ai/contact-review", { token: w.token });
    expect(res.status).toBe(200);
    const body = await json<any>(res);
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(typeof body.pending).toBe("boolean");
    expect(typeof body.enabled).toBe("boolean");
  });
});

describe("AI summary routes", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  it("GET and DELETE /api/ai/summary/:threadId handles owned and non-owned threads", async () => {
    // Non-owned thread
    const notFoundGet = await call("GET", "/api/ai/summary/non-existent-thread", { token: w.token });
    expect(notFoundGet.status).toBe(404);

    const notFoundDel = await call("DELETE", "/api/ai/summary/non-existent-thread", { token: w.token });
    expect(notFoundDel.status).toBe(404);

    // Owned thread
    const ownedGet = await call("GET", `/api/ai/summary/${w.thread}`, { token: w.token });
    expect(ownedGet.status).toBe(200);
    const summaryBody = await json<any>(ownedGet);
    expect(summaryBody.summary).toBeNull();

    const ownedDel = await call("DELETE", `/api/ai/summary/${w.thread}`, { token: w.token });
    expect(ownedDel.status).toBe(200);
    expect((await json<any>(ownedDel)).ok).toBe(true);
  });
});

describe("AI models endpoint", () => {
  let w: World;

  beforeEach(async () => {
    await wipeAll();
    w = await seedWorld("ai");
  });

  it("POST /api/ai/models returns empty array when unconfigured or invalid URL", async () => {
    const res = await call("POST", "/api/ai/models", { token: w.token, body: { preset: "custom", base_url: "invalid" } });
    expect(res.status).toBe(200);
    expect((await json<any>(res)).models).toEqual([]);
  });

  it("lists models from /v1/models when /openai/v1/models is not there (Bedrock Mantle)", async () => {
    const asked: string[] = [];
    const srv = createServer((req, res) => {
      asked.push(req.url ?? "");
      if (req.url === "/v1/models") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "google.gemma-4-31b" }, { id: "openai.gpt-oss-120b" }] }));
      } else {
        res.statusCode = 404;
        res.end("");
      }
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    try {
      const port = (srv.address() as { port: number }).port;
      const res = await call("POST", "/api/ai/models", { token: w.token, body: { preset: "custom", base_url: `http://127.0.0.1:${port}/openai/v1`, api_key: "test-key-123" } });
      expect(await json<any>(res)).toEqual({ models: ["google.gemma-4-31b", "openai.gpt-oss-120b"] });
      expect(asked).toEqual(["/openai/v1/models", "/v1/models"]);
    } finally {
      srv.close();
    }
  });

  it("a preset with a changeable address starts at its usual one, and keeps the one you give", async () => {
    const usual = await call("PUT", "/api/ai/settings", { token: w.token, body: { preset: "ollama" } });
    expect(usual.status).toBe(200);
    const got = await json<any>(await call("GET", "/api/ai/settings", { token: w.token }));
    expect(got.preset).toBe("ollama");
    expect(got.base_url).toBe("http://localhost:11434/v1");
    expect(got.configured).toBe(true);
    expect(got.presets.map((x: any) => x.id)).toEqual(expect.arrayContaining(["groq", "mistral", "deepseek", "bedrock", "ollama", "lmstudio", "custom"]));

    await call("PUT", "/api/ai/settings", { token: w.token, body: { preset: "bedrock", base_url: "https://bedrock-mantle.eu-west-1.api.aws/v1/" } });
    const bedrock = await json<any>(await call("GET", "/api/ai/settings", { token: w.token }));
    expect(bedrock.base_url).toBe("https://bedrock-mantle.eu-west-1.api.aws/v1");

    // A fixed provider ignores any address sent with it.
    await call("PUT", "/api/ai/settings", { token: w.token, body: { preset: "groq", base_url: "https://evil.example/v1" } });
    expect((await json<any>(await call("GET", "/api/ai/settings", { token: w.token }))).base_url).toBe("https://api.groq.com/openai/v1");
  });
});
