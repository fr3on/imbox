import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";

// The Updates page lists Feeds and Paper Trail together. Receipts are mail you keep, so they show whether or not they are marked done.

let session = "";
beforeAll(migrate);
beforeEach(async () => {
  await wipeAll();
  session = await signIn("u1");
  await seedAccount("a1", "maya@chen.test");
});

const subjects = async (q: string) => {
  const res = await call("GET", `/api/feed${q}`, { token: session });
  const body = await json<{ threads?: { subject: string }[] }>(res);
  if (!body.threads) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body.threads.map((t) => t.subject).sort();
};

describe("GET /api/feed on the Updates page", () => {
  it("keeps a done receipt in the New view but not a done newsletter", async () => {
    const receipt = await seedThread("a1", { subject: "Receipt 1", bucket: "paper_trail" });
    const news = await seedThread("a1", { subject: "Newsletter 1", bucket: "feed" });
    await seedThread("a1", { subject: "Fresh newsletter", bucket: "feed" });
    await testEnv.DB.prepare(`UPDATE threads SET seen = 1 WHERE id IN (?, ?)`).bind(receipt.thread, news.thread).run();
    expect(await subjects("?bucket=library")).toEqual(["Fresh newsletter", "Receipt 1"]);
    expect(await subjects("?bucket=library&show=all")).toEqual(["Fresh newsletter", "Newsletter 1", "Receipt 1"]);
  });

  it("pages from the last thread seen, so threads marked done meanwhile do not make it skip any", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 35; i++) {
      const { thread } = await seedThread("a1", { subject: `News ${String(i).padStart(2, "0")}`, bucket: "feed" });
      await testEnv.DB.prepare(`UPDATE threads SET last_message_at = ? WHERE id = ?`).bind(1_000_000 + i, thread).run();
      ids.push(thread);
    }
    const first = await json<{ threads: { id: string }[]; next_cursor: string | null }>(await call("GET", "/api/feed?bucket=library", { token: session }));
    expect(first.threads).toHaveLength(30);
    expect(first.next_cursor).toBeTruthy();
    // Done on the first ten while the second page is still to come.
    await testEnv.DB.prepare(`UPDATE threads SET seen = 1 WHERE id IN (${first.threads.slice(0, 10).map(() => "?").join(",")})`).bind(...first.threads.slice(0, 10).map((t) => t.id)).run();
    const second = await json<{ threads: { id: string }[]; next_cursor: string | null }>(await call("GET", `/api/feed?bucket=library&cursor=${encodeURIComponent(first.next_cursor!)}`, { token: session }));
    expect(second.threads).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.threads, ...second.threads].map((t) => t.id)).size).toBe(35);
  });

  it("searches everything, not just a page, and can keep to threads with files", async () => {
    for (let i = 0; i < 32; i++) await seedThread("a1", { subject: `Filler ${i}`, bucket: "feed" });
    const target = await seedThread("a1", { subject: "Quarterly invoice from Acme", bucket: "paper_trail" });
    await testEnv.DB.prepare(`UPDATE threads SET last_message_at = 1000 WHERE id = ?`).bind(target.thread).run();
    expect(await subjects("?bucket=library&q=invoice")).toEqual(["Quarterly invoice from Acme"]);
    expect(await subjects("?bucket=library&q=nothing-like-this")).toEqual([]);
    expect(await subjects("?bucket=library&files=1")).toEqual([]);
    await testEnv.DB.prepare(
      `INSERT INTO attachments (id, account_id, thread_id, message_id, gmail_attachment_id, filename, mime_type, size, content_id, is_inline, created_at) VALUES ('att-1', 'a1', ?, ?, 'ga1', 'invoice.pdf', 'application/pdf', 10, '', 0, 1)`
    )
      .bind(target.thread, target.message)
      .run();
    expect(await subjects("?bucket=library&files=1")).toEqual(["Quarterly invoice from Acme"]);
  });

  it("sends a saved one-line summary along with its thread", async () => {
    const { thread, message } = await seedThread("a1", { subject: "Weekly digest", bucket: "feed" });
    await testEnv.DB.prepare(`INSERT INTO thread_gists (thread_id, message_id, gist, created_at) VALUES (?, ?, 'Five links on testing.', 1)`).bind(thread, message).run();
    const body = await json<{ threads: { subject: string; gist: string | null }[] }>(await call("GET", "/api/feed?bucket=library", { token: session }));
    expect(body.threads.map((t) => [t.subject, t.gist])).toEqual([["Weekly digest", "Five links on testing."]]);
  });
});
