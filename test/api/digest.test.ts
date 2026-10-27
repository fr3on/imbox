import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { buildDigestPrompt, digestFromPicks, digestIsStale, digestKey, type DigestMail } from "../../src/api/ai/digest";

beforeAll(async () => {
  await migrate();
  (testEnv as unknown as Record<string, string>).AI_MOCK = "1";
});
afterAll(() => {
  delete (testEnv as unknown as Record<string, string>).AI_MOCK;
});

const mail = (n: number, kind: DigestMail["kind"] = "newsletter"): DigestMail => ({ thread_id: `t${n}`, kind, from: `Sender ${n}`, subject: `Subject ${n}`, last_message_at: 1000 + n, gist: "", snippet: "" });

describe("digestFromPicks", () => {
  const mails = [mail(1), mail(2), mail(3)];

  it("keeps the sections that point at real mail, once each, and drops the rest", () => {
    const d = digestFromPicks(
      "2026-10-05",
      {
        sections: [
          { theme: "Engineering", text: "Two posts on queues!", n: [1, 2, 2, 9] },
          { theme: "Ghost", text: "Mentions a mail that does not exist.", n: [9] },
          { theme: "", text: "No theme.", n: [3] },
        ],
      },
      mails,
    );
    expect(d?.sections).toEqual([{ theme: "Engineering", text: "Two posts on queues.", sources: [{ thread_id: "t1", from: "Sender 1", subject: "Subject 1" }, { thread_id: "t2", from: "Sender 2", subject: "Subject 2" }] }]);
    expect(d?.count).toBe(3);
  });

  it("gives nothing when nothing usable is left", () => {
    expect(digestFromPicks("2026-10-05", { sections: [{ theme: "x", text: "y", n: [7] }] }, mails)).toBeNull();
  });
});

describe("digestIsStale", () => {
  const d = digestFromPicks("2026-10-05", { sections: [{ theme: "A", text: "b", n: [1, 2] }] }, [mail(1), mail(2)])!;

  it("is only about new mail, not mail that was read since", () => {
    expect(digestIsStale(d, [mail(1), mail(2)])).toBe(false);
    expect(digestIsStale(d, [mail(2)])).toBe(false);
    expect(digestIsStale(d, [mail(1), mail(2), mail(3)])).toBe(true);
    expect(digestIsStale(d, [{ ...mail(1), last_message_at: 99 }])).toBe(true);
  });

  it("is stale with none written and mail waiting, and never with nothing to write about", () => {
    expect(digestIsStale(null, [mail(1)])).toBe(true);
    expect(digestIsStale(null, [])).toBe(false);
    expect(digestIsStale(d, [])).toBe(false);
  });
});

describe("digestKey and the prompt", () => {
  it("changes when mail comes or goes, and not otherwise", () => {
    expect(digestKey([mail(1), mail(2)])).toBe(digestKey([mail(1), mail(2)]));
    expect(digestKey([mail(1), mail(2)])).not.toBe(digestKey([mail(1)]));
    expect(digestKey([mail(1)])).not.toBe(digestKey([{ ...mail(1), last_message_at: 5 }]));
  });

  it("numbers the mails from one", () => {
    const p = JSON.parse(buildDigestPrompt([{ ...mail(1), text: "Hello there" }, { ...mail(2, "receipt"), text: "" }]));
    expect(p.mails.map((m: { n: number; kind: string }) => [m.n, m.kind])).toEqual([[1, "newsletter"], [2, "receipt"]]);
  });
});

describe("the digest routes", () => {
  it("say when there is nothing to write about, and refuse to write with no AI set up", async () => {
    await wipeAll();
    const token = await signIn("dg");
    await seedAccount("dg-acc", "dg@example.test", { user: "dg" });
    expect(await json(await call("GET", "/api/digest", { token }))).toMatchObject({ digest: null, count: 0, stale: false, ai_enabled: false });
    expect((await call("POST", "/api/digest/refresh", { token })).status).toBe(400);
  });

  it("write a digest from the unread mail, keep it, and call it stale when new mail arrives", async () => {
    await wipeAll();
    const token = await signIn("dg2");
    await seedAccount("dg2-acc", "dg2@example.test", { user: "dg2" });
    expect((await call("PUT", "/api/ai/settings", { token, body: { preset: "mock" } })).status).toBe(200);
    await seedThread("dg2-acc", { subject: "Weekly digest", bucket: "feed", from: "news@example.org" });
    await seedThread("dg2-acc", { subject: "Your receipt", bucket: "paper_trail", from: "billing@example.org" });
    await seedThread("dg2-acc", { subject: "Not in Updates", bucket: "imbox" });

    const before = await json(await call("GET", "/api/digest", { token }));
    expect(before).toMatchObject({ digest: null, count: 2, stale: true, ai_enabled: true });

    const madeRes = await call("POST", "/api/digest/refresh", { token });
    const made = await json(madeRes);
    expect(madeRes.status, JSON.stringify(made)).toBe(200);
    expect(made.stale).toBe(false);
    expect(made.digest.sections).toHaveLength(1);
    expect(made.digest.sections[0].sources.map((s: { subject: string }) => s.subject).sort()).toEqual(["Weekly digest", "Your receipt"]);

    const again = await json(await call("GET", "/api/digest", { token }));
    expect(again).toMatchObject({ count: 2, stale: false });
    expect(again.digest.sections[0].theme).toBe("Mock");

    // Reading one of the two does not make it stale; a new one does.
    await testEnv.DB.prepare(`UPDATE threads SET seen = 1 WHERE subject = 'Weekly digest'`).run();
    expect(await json(await call("GET", "/api/digest", { token }))).toMatchObject({ count: 1, stale: false });
    await seedThread("dg2-acc", { subject: "One more", bucket: "feed" });
    expect(await json(await call("GET", "/api/digest", { token }))).toMatchObject({ count: 2, stale: true });
  });

  it("show a person only their own mail", async () => {
    await wipeAll();
    const a = await signIn("dg3");
    const b = await signIn("dg3-b");
    await seedAccount("dg3-acc", "dg3@example.test", { user: "dg3" });
    await seedThread("dg3-acc", { bucket: "feed" });
    expect((await json(await call("GET", "/api/digest", { token: a }))).count).toBe(1);
    expect((await json(await call("GET", "/api/digest", { token: b }))).count).toBe(0);
  });
});
