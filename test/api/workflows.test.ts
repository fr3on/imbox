import { beforeAll, describe, expect, it } from "vitest";
import { call, nid, seedThread, signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { seedWorld, type World } from "../api-world";
import { processWorkflow, type WorkflowRow } from "../../src/api/workflows/run";

/** Workflows: creating and checking them over the API, and what the once-a-minute pass does to mail. */

let w: World;
let other: { token: string };
let myLabel: string;
let theirLabel: string;
const db = () => testEnv.DB;
const as = (method: string, path: string, body?: unknown, token = w.token) => call(method, path, { token, ...(body === undefined ? {} : { body }) });
const row = (id: string) => db().prepare(`SELECT * FROM workflows WHERE id = ?`).bind(id).first<WorkflowRow>();
const thread = (id: string) => db().prepare(`SELECT * FROM threads WHERE id = ?`).bind(id).first<any>();
const labelsOf = async (id: string) => (await db().prepare(`SELECT label_id FROM thread_labels WHERE thread_id = ?`).bind(id).all<{ label_id: string }>()).results.map((r) => r.label_id);

async function make(over: Record<string, unknown> = {}) {
  const res = await as("POST", "/api/workflows", {
    name: "Shop mail",
    enabled: true,
    conditions: [{ field: "from", op: "is", value: "shop.example.com" }],
    actions: [{ type: "move", tray: "feed" }, { type: "label", id: myLabel }, { type: "mark_read" }],
    account_ids: [w.imap],
    ...over,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  await db().prepare(`UPDATE workflows SET watermark = 0 WHERE id = ?`).bind(body.id).run(); // enabled now, but see mail from before this moment
  return body.id as string;
}

beforeAll(async () => {
  w = await seedWorld("uw");
  other = { token: (await signIn("ux")) as unknown as string };
  await seedAccount("wf-foreign", "foreign-wf@test.local", { user: "ux" });
  myLabel = nid("l");
  theirLabel = nid("l");
  await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES (?, ?, 'Shops', 1), (?, 'wf-foreign', 'Theirs', 1)`).bind(myLabel, w.imap, theirLabel).run();
});

describe("workflows over the API", () => {
  it("makes a workflow from a name alone, switched off, and drops half-filled rows from a draft", async () => {
    const res = await as("POST", "/api/workflows", { name: "Just a name" });
    expect(res.status).toBe(200);
    const wf = await res.json();
    expect(wf).toMatchObject({ enabled: false, conditions: [], actions: [] });
    expect((await as("POST", "/api/workflows", { name: " " })).status).toBe(400);
    const half = await (await as("PUT", `/api/workflows/${wf.id}`, { conditions: [{ field: "subject", value: "" }], actions: [{ type: "delete" }, { type: "mark_read" }] })).json();
    expect(half.conditions).toEqual([]);
    expect(half.actions).toEqual([{ type: "mark_read" }]);
  });

  it("will not switch on one that is not whole", async () => {
    const wf = await (await as("POST", "/api/workflows", { name: "Unfinished" })).json();
    const on = await as("PUT", `/api/workflows/${wf.id}`, { enabled: true });
    expect(on.status).toBe(400);
    expect((await on.json()).message).toMatch(/condition|action/);
    await as("PUT", `/api/workflows/${wf.id}`, { conditions: [{ field: "subject", op: "contains", value: "x" }], actions: [{ type: "mark_read" }] });
    expect((await as("PUT", `/api/workflows/${wf.id}`, { enabled: true })).status).toBe(200);
  });

  it("refuses an invalid workflow that is switched on, and a label that is not yours", async () => {
    expect((await as("POST", "/api/workflows", { name: "x", enabled: true, conditions: [{ field: "subject", value: "a" }], actions: [{ type: "delete" }] })).status).toBe(400);
    expect((await as("POST", "/api/workflows", { name: "x", enabled: true, conditions: [], actions: [{ type: "mark_read" }] })).status).toBe(400);
    const res = await as("POST", "/api/workflows", { name: "x", conditions: [{ field: "subject", value: "a" }], actions: [{ type: "label", id: theirLabel }] });
    expect(res.status).toBe(400);
  });

  it("starts switched off, and a newly switched-on one begins with the next email", async () => {
    const res = await as("POST", "/api/workflows", { name: "Later", conditions: [{ field: "subject", value: "a" }], actions: [{ type: "mark_read" }] });
    const wf = await res.json();
    expect(wf.enabled).toBe(false);
    const before = Date.now();
    const on = await (await as("PUT", `/api/workflows/${wf.id}`, { enabled: true })).json();
    expect(on.enabled).toBe(true);
    expect((await row(wf.id))!.watermark).toBeGreaterThanOrEqual(before);
    expect(on.conditions).toHaveLength(1); // a body of just enabled leaves the rest alone
  });

  it("keeps another person's workflows out of sight", async () => {
    const id = await make();
    expect((await as("GET", `/api/workflows/${id}/runs`, undefined, other.token)).status).toBe(404);
    expect((await as("PUT", `/api/workflows/${id}`, { enabled: false }, other.token)).status).toBe(404);
    expect((await as("DELETE", `/api/workflows/${id}`, undefined, other.token)).status).toBe(404);
    const mine = await (await as("GET", "/api/workflows")).json();
    expect(mine.some((x: any) => x.id === id)).toBe(true);
    const theirs = await (await as("GET", "/api/workflows", undefined, other.token)).json();
    expect(theirs).toEqual([]);
  });

  it("previews which recent mail it would pick out, changing nothing", async () => {
    const a = await seedThread(w.imap, { subject: "Preview hit", from: "deals@preview-shop.example.net" });
    await seedThread(w.imap, { subject: "Preview miss", from: "friend@example.org" });
    const res = await as("POST", "/api/workflows/preview", {
      name: "p",
      conditions: [{ field: "from", op: "is", value: "preview-shop.example.net" }],
      actions: [{ type: "mark_read" }],
    });
    const body = await res.json();
    expect(body.matches.map((m: any) => m.thread_id)).toEqual([a.thread]);
    expect((await thread(a.thread)).unread).toBe(1);
  });
});

describe("running workflows", () => {
  it("applies every action to matching mail, once, and leaves the rest alone", async () => {
    const id = await make();
    const hit = await seedThread(w.imap, { subject: "Sale", from: "deals@shop.example.com" });
    const miss = await seedThread(w.imap, { subject: "Hello", from: "friend@example.org" });

    expect((await processWorkflow(testEnv, (await row(id))!)).handled).toBe(1);
    const t = await thread(hit.thread);
    expect(t.bucket).toBe("feed");
    expect(t.unread).toBe(0);
    expect(await labelsOf(hit.thread)).toEqual([myLabel]);
    expect((await thread(miss.thread)).bucket).toBe("imbox");

    // The same mail is not handled again.
    await db().prepare(`UPDATE workflows SET watermark = 0 WHERE id = ?`).bind(id).run();
    expect((await processWorkflow(testEnv, (await row(id))!)).handled).toBe(0);

    const runs = await (await as("GET", `/api/workflows/${id}/runs`)).json();
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]).toMatchObject({ status: "done", subject: "Sale" });
    const log = await db().prepare(`SELECT actor, kind FROM activity_log WHERE thread_id = ?`).bind(hit.thread).first<any>();
    expect(log).toMatchObject({ actor: "rules", kind: "workflow" });
  });

  it("does not decide what leaves the Screener", async () => {
    const id = await make();
    const waiting = await seedThread(w.imap, { subject: "Stranger", from: "x@shop.example.com", bucket: "screener" });
    await processWorkflow(testEnv, (await row(id))!);
    expect((await thread(waiting.thread)).bucket).toBe("screener");
  });

  it("works only on the mailboxes it was given", async () => {
    const id = await make({ account_ids: [w.gmail] });
    const imapMail = await seedThread(w.imap, { subject: "Other box", from: "deals@shop.example.com" });
    await processWorkflow(testEnv, (await row(id))!);
    expect((await thread(imapMail.thread)).bucket).toBe("imbox");
  });

  it("stops at its daily limit and leaves the rest for later", async () => {
    const id = await make({ daily_limit: 1 });
    const a = await seedThread(w.imap, { subject: "One", from: "a@shop.example.com" });
    const b = await seedThread(w.imap, { subject: "Two", from: "b@shop.example.com" });
    await processWorkflow(testEnv, (await row(id))!);
    const moved = [(await thread(a.thread)).bucket, (await thread(b.thread)).bucket].filter((x) => x === "feed");
    expect(moved).toHaveLength(1);
  });

  it("skips a label that lives in another mailbox instead of applying it across", async () => {
    const gmailLabel = nid("l");
    await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES (?, ?, 'G', 1)`).bind(gmailLabel, w.gmail).run();
    const id = await make({ actions: [{ type: "label", id: gmailLabel }, { type: "mark_read" }] });
    const m = await seedThread(w.imap, { subject: "Cross", from: "c@shop.example.com" });
    await processWorkflow(testEnv, (await row(id))!);
    expect(await labelsOf(m.thread)).toEqual([]);
    expect((await thread(m.thread)).unread).toBe(0);
    const run = await db().prepare(`SELECT status, summary FROM workflow_runs WHERE workflow_id = ?`).bind(id).first<any>();
    expect(run.status).toBe("partial");
    expect(run.summary).toMatch(/another mailbox/);
  });

  it("acts on a thread you wrote last that has had no answer for days, once", async () => {
    const id = await make({ trigger: "no_reply", trigger_days: 3, conditions: [], actions: [{ type: "reply_later" }] });
    const quiet = await seedThread(w.imap, { subject: "Waiting on them", from: "me@example.com" });
    const old = Date.now() - 5 * 24 * 3600_000;
    await db().prepare(`UPDATE messages SET is_from_me = 1, date = ? WHERE thread_id = ?`).bind(old, quiet.thread).run();
    await db().prepare(`UPDATE threads SET last_message_at = ? WHERE id = ?`).bind(old, quiet.thread).run();
    const recent = await seedThread(w.imap, { subject: "Just sent", from: "me@example.com" });
    await db().prepare(`UPDATE messages SET is_from_me = 1 WHERE thread_id = ?`).bind(recent.thread).run();

    expect((await processWorkflow(testEnv, (await row(id))!)).handled).toBe(1);
    expect((await thread(quiet.thread)).reply_later).toBe(1);
    expect((await thread(recent.thread)).reply_later).toBe(0);
    expect((await processWorkflow(testEnv, (await row(id))!)).handled).toBe(0);
  });
});
