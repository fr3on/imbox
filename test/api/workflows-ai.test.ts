import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, nid, seedThread, testEnv } from "../api-harness";
import { seedWorld, type World } from "../api-world";
import type { LlmProvider } from "../../src/api/ai/provider";
import { AI_PER_PASS, processWorkflow, type WorkflowRow } from "../../src/api/workflows/run";
import { shapeDraft } from "../../src/api/workflows/ai";
import { runTool, TOOLS, type ToolContext } from "../../src/api/ai/tools";
import type { AccountRow } from "../../src/api/db";
import { normalizeWorkflow } from "../../src/shared/workflows";

/** Where the AI helps with workflows: a draft from a few words, and an AI condition. It never runs a workflow and never picks its actions. */

let w: World;
let label: string;
const db = () => testEnv.DB;
const as = (method: string, path: string, body?: unknown) => call(method, path, { token: w.token, ...(body === undefined ? {} : { body }) });
const row = (id: string) => db().prepare(`SELECT * FROM workflows WHERE id = ?`).bind(id).first<WorkflowRow>();
const thread = (id: string) => db().prepare(`SELECT * FROM threads WHERE id = ?`).bind(id).first<any>();

/** A model that answers with what it is given, and counts how often it was asked. */
function fake(answer: (prompt: string) => unknown) {
  const asked: string[] = [];
  const provider = {
    model: "fake",
    async *stream() {},
    async complete(p: { messages: { content: unknown }[] }) {
      const prompt = String(p.messages[0].content);
      asked.push(prompt);
      return { text: "", json: answer(prompt) };
    },
  } as unknown as LlmProvider;
  return { provider, asked };
}

async function make(over: Record<string, unknown> = {}) {
  const res = await as("POST", "/api/workflows", {
    name: "Receipts by AI",
    enabled: true,
    match: "all",
    conditions: [
      { field: "from", op: "is", value: "shop.example.com" },
      { field: "ai", op: "is", value: "is a receipt" },
    ],
    actions: [{ type: "move", tray: "paper_trail" }],
    account_ids: [w.imap],
    ...over,
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  await db().prepare(`UPDATE workflows SET watermark = 0 WHERE id = ?`).bind(body.id).run();
  return body.id as string;
}

beforeAll(async () => {
  w = await seedWorld("uwa");
  label = nid("l");
  await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES (?, ?, 'Shops', 1)`).bind(label, w.imap).run();
});
afterAll(() => {
  delete (testEnv as unknown as Record<string, string>).AI_MOCK;
});

describe("AI conditions", () => {
  it("asks the AI only about mail the plain conditions let through, and acts on a yes", async () => {
    const id = await make();
    const yes = await seedThread(w.imap, { subject: "Your receipt", from: "deals@shop.example.com" });
    const no = await seedThread(w.imap, { subject: "Weekly offers", from: "deals@shop.example.com" });
    const other = await seedThread(w.imap, { subject: "Receipt from a friend", from: "friend@example.org" });
    const { provider, asked } = fake((p) => ({ answer: p.includes("Subject: Your receipt") }));

    expect((await processWorkflow(testEnv, (await row(id))!, { provider })).handled).toBe(1);
    expect((await thread(yes.thread)).bucket).toBe("paper_trail");
    expect((await thread(no.thread)).bucket).toBe("imbox");
    expect((await thread(other.thread)).bucket).toBe("imbox");
    // The friend's mail failed the sender condition, so the AI was never asked about it.
    expect(asked).toHaveLength(2);
    expect(asked.some((p) => p.includes("Receipt from a friend"))).toBe(false);
    expect(asked[0]).toContain("<email>");
  });

  it("treats mail the AI can't judge as not matching, and does nothing without an AI", async () => {
    const id = await make();
    const t = await seedThread(w.imap, { subject: "Your receipt", from: "deals@shop.example.com" });
    const broken = fake(() => undefined);
    await processWorkflow(testEnv, (await row(id))!, { provider: broken.provider });
    expect((await thread(t.thread)).bucket).toBe("imbox");

    await db().prepare(`UPDATE workflows SET watermark = 0 WHERE id = ?`).bind(id).run();
    await db().prepare(`DELETE FROM workflow_runs WHERE workflow_id = ?`).bind(id).run();
    await processWorkflow(testEnv, (await row(id))!); // no provider given, none configured
    expect((await thread(t.thread)).bucket).toBe("imbox");
  });

  it("puts a limit on questions per pass, and looks at the rest next time", async () => {
    const id = await make({ conditions: [{ field: "ai", op: "is", value: "is a receipt" }] });
    const made: string[] = [];
    for (let i = 0; i < AI_PER_PASS + 3; i++) made.push((await seedThread(w.imap, { subject: `Receipt ${i}`, from: `a${i}@shop.example.com` })).thread);
    const { provider, asked } = fake(() => ({ answer: true }));

    const first = await processWorkflow(testEnv, (await row(id))!, { provider });
    expect(asked).toHaveLength(AI_PER_PASS);
    expect(first.handled).toBe(AI_PER_PASS);
    const second = await processWorkflow(testEnv, (await row(id))!, { provider });
    expect(second.handled).toBeGreaterThan(0);
    const moved = (await Promise.all(made.map(thread))).filter((t) => t.bucket === "paper_trail");
    expect(moved.length).toBeGreaterThan(AI_PER_PASS);
  });

  it("checks the AI condition when a workflow is saved", () => {
    expect("error" in normalizeWorkflow({ name: "x", conditions: [{ field: "ai", value: " " }], actions: [{ type: "mark_read" }] })).toBe(true);
    const three = Array.from({ length: 3 }, (_, i) => ({ field: "ai", value: `is thing ${i}` }));
    expect("error" in normalizeWorkflow({ name: "x", conditions: three, actions: [{ type: "mark_read" }] })).toBe(true);
    expect("ok" in normalizeWorkflow({ name: "x", conditions: three.slice(0, 2), actions: [{ type: "mark_read" }] })).toBe(true);
  });

  it("leaves the AI out of the preview and says so", async () => {
    await seedThread(w.imap, { subject: "Your receipt", from: "deals@preview-ai.example.net" });
    const res = await as("POST", "/api/workflows/preview", {
      name: "p",
      conditions: [{ field: "from", op: "is", value: "preview-ai.example.net" }, { field: "ai", op: "is", value: "is a receipt" }],
      actions: [{ type: "mark_read" }],
    });
    const body = await res.json();
    expect(body.ai_skipped).toBe(true);
    expect(body.total).toBe(1);
  });
});

describe("a workflow the assistant drafts", () => {
  const answer = {
    name: "Shop mail",
    trigger: "message_arrives",
    trigger_days: null,
    match: "all",
    conditions: [{ field: "from", op: "is", value: "shop.example.com" }],
    actions: [
      { type: "label", tray: null, label: "shops", collection: null, hours: null },
      { type: "label", tray: null, label: "Nope", collection: null, hours: null },
      { type: "delete", tray: null, label: null, collection: null, hours: null },
      { type: "move", tray: "feed", label: null, collection: null, hours: null },
    ],
    notes: "Labels shop mail and moves it to the Feed.",
  };

  it("names real labels, leaves out what does not exist, and never makes a delete step", async () => {
    const r = await shapeDraft(testEnv, w.user, answer);
    if ("error" in r) throw new Error(r.error);
    expect(r.def.actions).toEqual([{ type: "label", id: label }, { type: "move", tray: "feed" }]);
    expect(r.def.account_ids).toEqual([w.imap]);
    expect(r.notes.join(" ")).toMatch(/Nope/);
    expect(r.summary).toMatch(/^When mail arrives and all of: sender is shop.example.com, label it "Shops", then move it to the Feed\.$/);
  });

  it("is a tool the assistant calls: it shows a card and saves nothing", async () => {
    expect(TOOLS.find((t) => t.name === "draft_workflow")).toBeTruthy();
    const accounts = (await db().prepare(`SELECT * FROM accounts WHERE user_id = ? AND id <> ? ORDER BY id`).bind(w.user, w.agentAccount).all<AccountRow>()).results;
    const events: Record<string, unknown>[] = [];
    const ctx: ToolContext = { env: testEnv, user: { id: w.user, email: `${w.user}@test.local`, name: "Maya" }, accounts, autoSend: false, emit: (e) => void events.push(e) };
    const before = (await db().prepare(`SELECT COUNT(*) AS n FROM workflows`).first<{ n: number }>())!.n;

    const r = await runTool(ctx, "draft_workflow", answer);
    expect(r.isError).toBeFalsy();
    expect(r.result).toMatch(/not saved or switched on/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "workflow_proposal", proposal: { def: { name: "Shop mail" } } });
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM workflows`).first<{ n: number }>())!.n).toBe(before);

    // Even after the model has read mail, it can only draft: there is nothing here that sends or deletes.
    const read = await runTool({ ...ctx, sawMailContent: true }, "draft_workflow", { ...answer, name: "After reading mail" });
    expect(read.isError).toBeFalsy();
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM workflows`).first<{ n: number }>())!.n).toBe(before);
  });

  it("has no endpoint of its own any more", async () => {
    expect((await as("POST", "/api/workflows/draft", { text: "newsletters" })).status).toBe(404);
  });
});
