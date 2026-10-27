import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, wipeAll } from "../api-harness";

beforeAll(migrate);

describe("POST /api/ai/gists", () => {
  it("answers with nothing for no threads, and says so when no AI is set up", async () => {
    await wipeAll();
    const token = await signIn("gs");
    await seedAccount("gs-acc", "gs@example.test", { user: "gs" });
    const { thread } = await seedThread("gs-acc", { bucket: "feed" });
    expect(await json(await call("POST", "/api/ai/gists", { token, body: { thread_ids: [] } }))).toEqual({ gists: {} });
    expect(await json(await call("POST", "/api/ai/gists", { token, body: { thread_ids: "nope" } }))).toEqual({ gists: {} });
    const off = await json(await call("POST", "/api/ai/gists", { token, body: { thread_ids: [thread, thread] } }));
    expect(off).toEqual({ gists: {}, off: true });
  });
});
