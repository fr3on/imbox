import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { dropClosedWaiting, gatherCandidates, rulesBrief } from "../../src/api/ai/brief";

beforeAll(migrate);

describe("marking a thread Not waiting", () => {
  it("takes it out of what the brief is waiting on, and out of a brief already saved", async () => {
    await wipeAll();
    const token = await signIn("nw");
    await seedAccount("nw-acc", "nw@example.test", { user: "nw" });
    const { thread } = await seedThread("nw-acc", { subject: "Your inquiry", from: "nw@example.test" });
    const day = 24 * 3600_000;
    await testEnv.DB.prepare(`UPDATE threads SET last_message_at = ?, unread = 0, seen = 1 WHERE id = ?`).bind(Date.now() - 5 * day, thread).run();

    const before = await gatherCandidates(testEnv.DB, "nw");
    expect(before.map((c) => [c.thread_id, c.source])).toEqual([[thread, "waiting"]]);
    const saved = rulesBrief("2026-10-05", before, []);
    expect(saved.items.map((i) => i.kind)).toEqual(["waiting"]);

    expect((await json(await call("GET", `/api/threads/${thread}?peek=1`, { token }))).not_waiting).toBe(false);
    const res = await call("POST", "/api/ai/actions/state", { token, body: { thread_id: thread, action_id: "not_waiting", state: "done" } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });

    expect((await json(await call("GET", `/api/threads/${thread}?peek=1`, { token }))).not_waiting).toBe(true);
    expect(await gatherCandidates(testEnv.DB, "nw")).toEqual([]);
    const after = await dropClosedWaiting(testEnv.DB, saved);
    expect(after.items).toEqual([]);
    expect(after.headline).toBe("Nothing needs you today.");
  });

  it("leaves rows that someone else is waiting on you for", async () => {
    await wipeAll();
    await signIn("nw2");
    await seedAccount("nw2-acc", "nw2@example.test", { user: "nw2" });
    const { thread } = await seedThread("nw2-acc", { from: "someone@example.test" });
    const b = rulesBrief("2026-10-05", await gatherCandidates(testEnv.DB, "nw2"), []);
    expect(b.items.map((i) => [i.thread_id, i.kind])).toEqual([[thread, "reply"]]);
    expect(await dropClosedWaiting(testEnv.DB, b)).toBe(b);
  });
});
