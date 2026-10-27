import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";

beforeAll(migrate);

describe("reporting a message as phishing", () => {
  it("screens the sender out and puts the thread in the trash, for its owner only", async () => {
    await wipeAll();
    const token = await signIn("rp");
    const other = await signIn("rp-other");
    await seedAccount("rp-acc", "rp@example.test", { user: "rp" });
    const { thread } = await seedThread("rp-acc", { subject: "Account Restricted", from: "support@nexcess.net", bucket: "screener" });

    // Someone with no access to it is refused and nothing moves.
    const denied = await call("POST", `/api/threads/${thread}/report`, { token: other });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect((await testEnv.DB.prepare(`SELECT bucket FROM threads WHERE id = ?`).bind(thread).first<{ bucket: string }>())?.bucket).toBe("screener");

    const res = await call("POST", `/api/threads/${thread}/report`, { token });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, blocked: "support@nexcess.net" });

    const row = await testEnv.DB.prepare(`SELECT bucket FROM threads WHERE id = ?`).bind(thread).first<{ bucket: string }>();
    expect(row?.bucket).toBe("trash");
    const contact = await testEnv.DB.prepare(`SELECT screen_status FROM contacts WHERE account_id = 'rp-acc' AND lower(email) = 'support@nexcess.net'`).first<{ screen_status: string }>();
    expect(contact?.screen_status).toBe("screened_out");
  });

  it("remembers Looks fine until something newer arrives", async () => {
    await wipeAll();
    const token = await signIn("rp2");
    await seedAccount("rp2-acc", "rp2@example.test", { user: "rp2" });
    const { thread } = await seedThread("rp2-acc", { from: "support@nexcess.net" });
    const detail = async () => json(await call("GET", `/api/threads/${thread}?peek=1`, { token }));
    expect((await detail()).phish_ok).toBe(false);

    const res = await call("POST", "/api/ai/actions/state", { token, body: { thread_id: thread, action_id: "phish_ok", state: "done" } });
    expect(res.status).toBe(200);
    expect((await detail()).phish_ok).toBe(true);

    await testEnv.DB.prepare(`UPDATE threads SET last_message_at = ? WHERE id = ?`).bind(Date.now() + 60_000, thread).run();
    expect((await detail()).phish_ok).toBe(false);
  });

  it("remembers a report for the whole domain, and Looks fine for the one sender", async () => {
    await wipeAll();
    const token = await signIn("rp3");
    await seedAccount("rp3-acc", "rp3@example.test", { user: "rp3" });
    const first = await seedThread("rp3-acc", { subject: "Password expiry", from: "dana@jonmarier.example", bucket: "screener" });
    const later = await seedThread("rp3-acc", { subject: "Another notice", from: "it-desk@jonmarier.example", bucket: "screener" });
    const detail = async (id: string, t = token) => json(await call("GET", `/api/threads/${id}?peek=1`, { token: t }));
    expect((await detail(later.thread)).phish_verdict).toBeNull();

    await call("POST", `/api/threads/${first.thread}/report`, { token });
    // A different address at the same domain is judged by the report; another sender elsewhere is not.
    expect((await detail(later.thread)).phish_verdict).toBe("bad");
    expect((await testEnv.DB.prepare(`SELECT key FROM phish_verdicts`).all<{ key: string }>()).results.map((r) => r.key)).toEqual(["@jonmarier.example"]);

    // Looks fine for that one sender wins over the domain, and only for them.
    await call("POST", "/api/ai/actions/state", { token, body: { thread_id: later.thread, action_id: "phish_ok", state: "done" } });
    expect((await detail(later.thread)).phish_verdict).toBe("ok");
    expect((await detail(first.thread)).phish_verdict).toBe("bad");
  });

  it("reports a sender at a shared mail provider as that one address, not the whole provider", async () => {
    await wipeAll();
    const token = await signIn("rp4");
    await seedAccount("rp4-acc", "rp4@example.test", { user: "rp4" });
    const a = await seedThread("rp4-acc", { from: "scammer@gmail.com", bucket: "screener" });
    const b = await seedThread("rp4-acc", { from: "friend@gmail.com", bucket: "screener" });
    await call("POST", `/api/threads/${a.thread}/report`, { token });
    expect((await testEnv.DB.prepare(`SELECT key FROM phish_verdicts`).all<{ key: string }>()).results.map((r) => r.key)).toEqual(["scammer@gmail.com"]);
    expect((await json(await call("GET", `/api/threads/${b.thread}?peek=1`, { token }))).phish_verdict).toBeNull();
  });
});
