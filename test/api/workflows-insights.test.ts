import { beforeAll, describe, expect, it } from "vitest";
import { call, nid, seedThread, signIn, testEnv } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { seedWorld, type World } from "../api-world";
import { SUGGEST_AFTER } from "../../src/api/workflows/insights";

/** What imbox says about workflows without running them: what you keep doing by hand, what is wrong with the ones you have, why one matched. */

let w: World;
let otherToken: string;
const db = () => testEnv.DB;
const as = (method: string, path: string, body?: unknown, token = w.token) => call(method, path, { token, ...(body === undefined ? {} : { body }) });

async function movedByHand(from: string, bucket: string, times: number, account = w.imap, user = w.user) {
  for (let i = 0; i < times; i++) {
    const t = await seedThread(account, { subject: `${from} ${i}`, from, bucket });
    await db().prepare(`INSERT INTO activity_log (user_id, at, actor, kind, summary, thread_id) VALUES (?, ?, 'you', 'move', 'Moved it', ?)`).bind(user, Date.now(), t.thread).run();
  }
}

async function make(over: Record<string, unknown> = {}) {
  const res = await as("POST", "/api/workflows", { name: "W", conditions: [{ field: "subject", op: "contains", value: "x" }], actions: [{ type: "mark_read" }], ...over });
  expect(res.status).toBe(200);
  return (await res.json()).id as string;
}

beforeAll(async () => {
  w = await seedWorld("uwi");
  otherToken = await signIn("uwi-other");
  await seedAccount("wi-foreign", "foreign-wi@test.local", { user: "uwi-other" });
});

describe("suggestions", () => {
  it("offers what you moved by hand a few times, and only to you", async () => {
    await movedByHand("promo@shop-a.example.com", "feed", SUGGEST_AFTER);
    await movedByHand("rare@shop-b.example.com", "feed", SUGGEST_AFTER - 1);
    await movedByHand("theirs@shop-c.example.com", "feed", SUGGEST_AFTER, "wi-foreign", "uwi-other");
    const mine = (await (await as("GET", "/api/workflows/suggestions")).json()).suggestions;
    expect(mine.map((s: any) => s.def.conditions[0].value)).toEqual(["promo@shop-a.example.com"]);
    expect(mine[0].def.actions).toEqual([{ type: "move", tray: "feed" }]);
    expect(mine[0].why).toMatch(/3 of their emails/);
    const theirs = (await (await as("GET", "/api/workflows/suggestions", undefined, otherToken)).json()).suggestions;
    expect(theirs.map((s: any) => s.def.conditions[0].value)).toEqual(["theirs@shop-c.example.com"]);
  });

  it("stops offering one once a workflow covers the sender or its domain", async () => {
    await movedByHand("deals@shop-d.example.com", "paper_trail", SUGGEST_AFTER);
    const has = async () => (await (await as("GET", "/api/workflows/suggestions")).json()).suggestions.some((s: any) => s.def.conditions[0].value === "deals@shop-d.example.com");
    expect(await has()).toBe(true);
    await make({ conditions: [{ field: "from", op: "is", value: "shop-d.example.com" }] });
    expect(await has()).toBe(false);
  });
});

describe("checkup", () => {
  it("notices two that are the same, and two that send the same mail to different trays", async () => {
    const same = { conditions: [{ field: "subject", op: "contains", value: "dup-check" }], actions: [{ type: "mark_read" }] };
    const a = await make({ name: "Same A", ...same });
    const b = await make({ name: "Same B", ...same });
    const c1 = await make({ name: "Clash A", enabled: true, conditions: [{ field: "subject", op: "contains", value: "clash" }], actions: [{ type: "move", tray: "feed" }] });
    const c2 = await make({ name: "Clash B", enabled: true, conditions: [{ field: "subject", op: "contains", value: "clash" }], actions: [{ type: "move", tray: "paper_trail" }] });
    const notes = (await (await as("GET", "/api/workflows/checkup")).json()).notes;
    const dup = notes.find((n: any) => n.kind === "duplicate" && n.workflow_ids.includes(a));
    expect(dup.workflow_ids.sort()).toEqual([a, b].sort());
    const clash = notes.find((n: any) => n.kind === "conflict");
    expect(clash.workflow_ids.sort()).toEqual([c1, c2].sort());
  });

  it("notices a step that points at a label that is gone, and one that never matched", async () => {
    const lab = nid("l");
    await db().prepare(`INSERT INTO labels (id, account_id, name, created_at) VALUES (?, ?, 'Temp', 1)`).bind(lab, w.imap).run();
    const id = await make({ name: "Uses temp", conditions: [{ field: "subject", op: "contains", value: "temp-label" }], actions: [{ type: "label", id: lab }], account_ids: [w.imap] });
    await db().prepare(`DELETE FROM labels WHERE id = ?`).bind(lab).run();
    const quiet = await make({ name: "Quiet one", enabled: true, conditions: [{ field: "subject", op: "contains", value: "never-seen" }] });
    await db().prepare(`UPDATE workflows SET updated_at = ? WHERE id = ?`).bind(Date.now() - 20 * 24 * 3600_000, quiet).run();
    const notes = (await (await as("GET", "/api/workflows/checkup")).json()).notes;
    expect(notes.find((n: any) => n.kind === "missing_target" && n.workflow_ids[0] === id)).toBeTruthy();
    expect(notes.find((n: any) => n.kind === "never_matched" && n.workflow_ids[0] === quiet)).toBeTruthy();
  });
});

describe("testing a workflow against one email", () => {
  it("says which conditions hold and what is in the way", async () => {
    const id = await make({
      match: "all",
      conditions: [{ field: "from", op: "is", value: "shop.example.com" }, { field: "subject", op: "contains", value: "receipt" }],
      account_ids: [w.imap],
    });
    const good = await seedThread(w.imap, { subject: "Your receipt", from: "deals@shop.example.com" });
    const r = await (await as("POST", `/api/workflows/${id}/check`, { thread_id: good.thread })).json();
    expect(r).toMatchObject({ would_act: true, blockers: [] });
    expect(r.conditions.map((c: any) => c.ok)).toEqual([true, true]);

    const miss = await seedThread(w.imap, { subject: "Hello", from: "deals@shop.example.com" });
    const m = await (await as("POST", `/api/workflows/${id}/check`, { thread_id: miss.thread })).json();
    expect(m.would_act).toBe(false);
    expect(m.conditions.map((c: any) => c.ok)).toEqual([true, false]);

    const waiting = await seedThread(w.imap, { subject: "Your receipt", from: "deals@shop.example.com", bucket: "screener" });
    const s = await (await as("POST", `/api/workflows/${id}/check`, { thread_id: waiting.thread })).json();
    expect(s.would_act).toBe(false);
    expect(s.blockers.join(" ")).toMatch(/Screener/);

    const gm = await seedThread(w.gmail, { subject: "Your receipt", from: "deals@shop.example.com" });
    const o = await (await as("POST", `/api/workflows/${id}/check`, { thread_id: gm.thread })).json();
    expect(o.blockers.join(" ")).toMatch(/mailbox/);
  });

  it("leaves an AI condition undecided, and keeps other people's mail out", async () => {
    const id = await make({ conditions: [{ field: "ai", op: "is", value: "is a receipt" }] });
    const t = await seedThread(w.imap, { subject: "Whatever", from: "a@example.org" });
    const r = await (await as("POST", `/api/workflows/${id}/check`, { thread_id: t.thread })).json();
    expect(r.would_act).toBe(null);
    expect(r.conditions[0].ok).toBe(null);
    const theirs = await seedThread("wi-foreign", { subject: "Theirs", from: "a@example.org" });
    expect((await as("POST", `/api/workflows/${id}/check`, { thread_id: theirs.thread })).status).toBe(404);
    expect((await as("POST", `/api/workflows/${id}/check`, { thread_id: t.thread }, otherToken)).status).toBe(404);
  });

  it("lists the latest conversations to pick from", async () => {
    const list = (await (await as("GET", "/api/workflows/recent")).json()).threads;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty("subject");
    const theirs = (await (await as("GET", "/api/workflows/recent", undefined, otherToken)).json()).threads;
    expect(theirs.every((t: any) => !list.some((m: any) => m.thread_id === t.thread_id))).toBe(true);
  });
});
