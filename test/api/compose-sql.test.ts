import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * Drafts, sending and scheduled sending: what is stored, who may touch it, and what happens when the same send arrives twice, or two workers look at
 * the same due message. The mail goes nowhere here: the send itself is a stand-in that counts its calls.
 */

// The one place a message leaves: Gmail's send call. It is answered here, and every other call to Google fails (the sent message is then picked up by the next sync).
const out = vi.hoisted(() => ({ sendMail: vi.fn() }));
import { processScheduledSends } from "../../src/api/send";

const db = () => testEnv.DB;
const q = async <T>(sql: string, ...p: unknown[]) => (await db().prepare(sql).bind(...p).all<T>()).results;
let token: string;
let other: string;
const as = (method: string, path: string, body?: unknown, t = token) => call(method, path, { token: t, body: method === "GET" || method === "DELETE" ? undefined : (body ?? {}) });
const send = (body: Record<string, unknown>, t = token) => as("POST", "/api/send", { account_id: "cs-a", to: ["x@y.test"], subject: "Hi", body_html: "<p>hi</p>", ...body }, t);

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("csu");
  other = await signIn("csv");
  await seedAccount("cs-a", "a@test.local", { user: "csu", provider: "gmail" });
  await seedAccount("cs-b", "b@test.local", { user: "csu", provider: "gmail" });
  await seedAccount("cs-o", "o@test.local", { user: "csv", provider: "gmail" });
  await db().prepare(`UPDATE accounts SET access_token = 'tok', refresh_token = 'rtok', token_expires_at = ?, scopes = 'https://www.googleapis.com/auth/gmail.modify'`).bind(Date.now() + 3_600_000).run();
});
let n = 0;
beforeEach(() => {
  out.sendMail.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    if (/messages\/send/.test(String(url))) {
      await out.sendMail(String(url), { raw: Buffer.from(JSON.parse(String(init?.body)).raw, "base64url").toString() });
      return new Response(JSON.stringify({ id: `g${++n}`, threadId: "gt" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 500 });
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("drafts", () => {
  it("are made, listed newest first with their kinds only, changed, moved to another of the person's mailboxes, and deleted", async () => {
    const a = await json(await as("POST", "/api/drafts", { account_id: "cs-a", to: ["Ann@X.test", { email: "bo@x.test", name: "Bo" }, "not an address"], subject: "One", body_html: "<p>1</p>" }));
    expect(a).toMatchObject({ account_id: "cs-a", status: "draft", subject: "One", to: [{ email: "ann@x.test", name: "" }, { email: "bo@x.test", name: "Bo" }] });
    const b = await json(await as("POST", "/api/drafts", { account_id: "cs-a", subject: "Two" }));
    await db().prepare(`UPDATE drafts SET updated_at = updated_at + 5000 WHERE id = ?`).bind(b.id).run();
    await db().prepare(`INSERT INTO drafts (id, account_id, to_json, cc_json, bcc_json, subject, body_html, status, created_at, updated_at) VALUES ('cs-sending', 'cs-a', '[]', '[]', '[]', 'Gone', '', 'sending', 1, 1)`).run();
    const list = await json(await as("GET", "/api/drafts"));
    expect(list.map((d: any) => d.subject)).toEqual(["Two", "One"]);

    const changed = await json(await as("PATCH", `/api/drafts/${a.id}`, { subject: "One again", account_id: "cs-b", cc: ["c@x.test"] }));
    expect(changed).toMatchObject({ id: a.id, account_id: "cs-b", subject: "One again", cc: [{ email: "c@x.test", name: "" }], to: a.to });
    expect(changed.updated_at).toBeGreaterThanOrEqual(a.updated_at);
    expect((await as("PATCH", `/api/drafts/${a.id}`, { account_id: "cs-o" })).status).toBe(400);

    expect((await as("DELETE", `/api/drafts/${a.id}`)).status).toBe(200);
    expect((await as("DELETE", `/api/drafts/${a.id}`)).status).toBe(404);
    expect(await q(`SELECT 1 FROM drafts WHERE id = ?`, a.id)).toHaveLength(0);
  });

  it("are not seen, changed or deleted by anyone else, and cannot be made in another person's mailbox", async () => {
    const mine = await json(await as("POST", "/api/drafts", { account_id: "cs-a", subject: "Private" }));
    expect((await as("PATCH", `/api/drafts/${mine.id}`, { subject: "Hacked" }, other)).status).toBe(404);
    expect((await as("DELETE", `/api/drafts/${mine.id}`, undefined, other)).status).toBe(404);
    expect((await json(await as("GET", "/api/drafts", undefined, other))).map((d: any) => d.id)).not.toContain(mine.id);
    expect((await as("POST", "/api/drafts", { account_id: "cs-o" })).status).toBe(400);
    expect((await q<{ subject: string }>(`SELECT subject FROM drafts WHERE id = ?`, mine.id))[0].subject).toBe("Private");
  });

  it("take a few statements to make and to change", async () => {
    await as("GET", "/api/drafts");
    resetStatements();
    const made = await json(await as("POST", "/api/drafts", { account_id: "cs-a", subject: "Count" }));
    const makeStatements = sent.statements;
    resetStatements();
    await as("PATCH", `/api/drafts/${made.id}`, { subject: "Counted" });
    expect(makeStatements).toBeLessThanOrEqual(4);
    expect(sent.statements).toBeLessThanOrEqual(4);
  });
});

describe("sending", () => {
  it("sends once and removes the draft it was made from, only if the draft is the person's", async () => {
    const mine = await json(await as("POST", "/api/drafts", { account_id: "cs-a", subject: "Out" }));
    const theirs = await json(await as("POST", "/api/drafts", { account_id: "cs-o", subject: "Theirs" }, other).then((r) => (r.status === 200 ? r : as("POST", "/api/drafts", { account_id: "cs-o" }, other))));
    const r = await json(await send({ draft_id: mine.id }));
    expect(r).toMatchObject({ ok: true, account_id: "cs-a" });
    
    expect(out.sendMail).toHaveBeenCalledTimes(1);
    expect(await q(`SELECT 1 FROM drafts WHERE id = ?`, mine.id)).toHaveLength(0);
    if (theirs?.id) {
      await send({ draft_id: theirs.id });
      expect(await q(`SELECT 1 FROM drafts WHERE id = ?`, theirs.id)).toHaveLength(1);
    }
  });

  it("refuses what is not allowed before sending anything", async () => {
    expect((await send({ to: [] })).status).toBe(400);
    expect((await send({ account_id: "cs-o" })).status).toBe(400);
    expect((await send({ send_at: "soon" })).status).toBe(400);
    expect((await send({ thread_id: "no-such-thread", account_id: undefined })).status).toBe(404);
    expect(out.sendMail).not.toHaveBeenCalled();
  });

  it("answers a repeat of the same send with the first one's result, and sends once", async () => {
    const id = "client-id-0001";
    const first = await json(await send({ client_id: id }));
    const again = await json(await send({ client_id: id }));
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: true, repeat: true });
    expect(out.sendMail).toHaveBeenCalledTimes(1);
  });

  it("lets the same id try again when the first one failed", async () => {
    out.sendMail.mockRejectedValueOnce(new Error("provider down"));
    const id = "client-id-0002";
    expect((await send({ client_id: id })).status).toBe(502);
    expect((await send({ client_id: id })).status).toBe(200);
    expect(out.sendMail).toHaveBeenCalledTimes(2);
  });

  it("sends once when the same send arrives twice together", async () => {
    let release: () => void = () => {};
    out.sendMail.mockImplementation(() => new Promise<void>((res) => (release = () => res())));
    const id = "client-id-0003";
    // Which of the two gets there first is not known: the one that is told to wait answers at once, the other is held until it is let go.
    const statuses = [send({ client_id: id }), send({ client_id: id })].map((p) => p.then((r) => r.status));
    await vi.waitFor(() => expect(out.sendMail).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(await Promise.race(statuses)).toBe(409);
    release();
    expect((await Promise.all(statuses)).sort()).toEqual([200, 409]);
    expect(out.sendMail).toHaveBeenCalledTimes(1);
  });

  it("lets a retry take over a send that has been dead for minutes, but only one retry when they arrive together", async () => {
    const id = "client-id-0004";
    await db().prepare(`INSERT INTO send_attempts (user_id, client_id, status, created_at) VALUES ('csu', ?, 'sending', ?)`).bind(id, Date.now() - 10 * 60_000).run();
    const answers = await Promise.all([send({ client_id: id }), send({ client_id: id }), send({ client_id: id }), send({ client_id: id })]);
    // One took over and sent; the others were told to wait (409) or, if it had finished, given its result (a repeat).
    const bodies = await Promise.all(answers.map(async (r) => ({ status: r.status, repeat: !!(await json(r)).repeat })));
    expect(bodies.filter((b) => b.status === 200 && !b.repeat)).toHaveLength(1);
    expect(bodies.every((b) => b.status === 409 || b.status === 200)).toBe(true);
    expect(out.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("scheduled sending", () => {
  const at = () => Date.now() + 3_600_000;

  it("keeps the message as a scheduled draft, and cancelling turns it back into a draft", async () => {
    const r = await json(await send({ send_at: at(), subject: "Later" }));
    expect(r).toMatchObject({ ok: true, scheduled: true, account_id: "cs-a" });
    expect(out.sendMail).not.toHaveBeenCalled();
    expect((await q<any>(`SELECT status, subject, send_at FROM drafts WHERE id = ?`, r.draft_id))[0]).toMatchObject({ status: "scheduled", subject: "Later" });
    expect((await as("POST", "/api/send/cancel", { draft_id: r.draft_id })).status).toBe(200);
    expect((await q<any>(`SELECT status, send_at FROM drafts WHERE id = ?`, r.draft_id))[0]).toEqual({ status: "draft", send_at: null });
    expect((await as("POST", "/api/send/cancel", { draft_id: r.draft_id })).status).toBe(404);
    expect((await as("POST", "/api/send/cancel", { draft_id: r.draft_id }, other)).status).toBe(404);
  });

  it("reuses the person's own draft id, and gives a new one when the id is somebody else's", async () => {
    const mine = await json(await as("POST", "/api/drafts", { account_id: "cs-a", subject: "Mine" }));
    const r = await json(await send({ draft_id: mine.id, send_at: at(), subject: "Mine, later" }));
    expect(r.draft_id).toBe(mine.id);
    expect((await q<any>(`SELECT status, subject FROM drafts WHERE id = ?`, mine.id))[0]).toEqual({ status: "scheduled", subject: "Mine, later" });

    await db().prepare(`INSERT INTO drafts (id, account_id, to_json, cc_json, bcc_json, subject, body_html, status, created_at, updated_at) VALUES ('cs-theirs', 'cs-o', '[]', '[]', '[]', 'Theirs', '', 'draft', 1, 1)`).run();
    const stolen = await json(await send({ draft_id: "cs-theirs", send_at: at(), subject: "Take it" }));
    expect(stolen.draft_id).not.toBe("cs-theirs");
    expect((await q<any>(`SELECT subject, account_id FROM drafts WHERE id = 'cs-theirs'`))[0]).toEqual({ subject: "Theirs", account_id: "cs-o" });
  });

  it("goes out when it is due, once, and is removed; a failure is kept with its reason", async () => {
    const ok = await json(await send({ send_at: at(), subject: "Due" }));
    const bad = await json(await send({ send_at: at(), subject: "Broken" }));
    const future = await json(await send({ send_at: at(), subject: "Not yet" }));
    await db().prepare(`UPDATE drafts SET send_at = ? WHERE id IN (?, ?)`).bind(Date.now() - 1000, ok.draft_id, bad.draft_id).run();
    out.sendMail.mockImplementation(async (_u: unknown, p: { raw: string }) => {
      if (/Subject: Broken/.test(p.raw)) throw new Error("refused");
    });
    expect(await processScheduledSends(testEnv)).toBe(1);
    expect(await q(`SELECT 1 FROM drafts WHERE id = ?`, ok.draft_id)).toHaveLength(0);
    expect((await q<any>(`SELECT status, error FROM drafts WHERE id = ?`, bad.draft_id))[0]).toEqual({ status: "failed", error: "refused" });
    expect((await q<any>(`SELECT status FROM drafts WHERE id = ?`, future.draft_id))[0].status).toBe("scheduled");
  });

  it("is sent once when two workers look at the same due message", async () => {
    const due = await json(await send({ send_at: at(), subject: "Twice?" }));
    await db().prepare(`UPDATE drafts SET send_at = ? WHERE id = ?`).bind(Date.now() - 1000, due.draft_id).run();
    const counts = await Promise.all([processScheduledSends(testEnv), processScheduledSends(testEnv), processScheduledSends(testEnv)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(out.sendMail).toHaveBeenCalledTimes(1);
  });

  it("marks a send that was cut off as failed, and does not send it again", async () => {
    await db().prepare(`INSERT INTO drafts (id, account_id, to_json, cc_json, bcc_json, subject, body_html, send_at, status, created_at, updated_at) VALUES ('cs-cut', 'cs-a', '[]', '[]', '[]', 'Cut', '', 1, 'sending', 1, ?)`).bind(Date.now() - 3_600_000).run();
    await processScheduledSends(testEnv);
    expect((await q<any>(`SELECT status FROM drafts WHERE id = 'cs-cut'`))[0].status).toBe("failed");
    expect(out.sendMail).not.toHaveBeenCalled();
  });
});
