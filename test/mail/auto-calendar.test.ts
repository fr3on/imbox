import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { autoCalendarForUser } from "../../src/api/ai/autocalendar";
import { actionsKey, saveFound, setState } from "../../src/api/ai/actions";
import { toMessage, type MessageRow } from "../../src/api/db";

// "Put deadlines in my calendar": a deadline found in recent mail becomes an all-day event, once.

let thread = "";
const found = (day: string) => ({
  actions: [],
  overview: { id: "ovtest", what: "Domain renewal notice for 75status.com.", ask: "Update billing information.", due: { all_day: true, start_date: day, end_date: day, starts_at: Date.parse(`${day}T00:00:00Z`), ends_at: Date.parse(`${day}T23:59:59Z`) }, urgent: true, facts: [{ label: "Renewal price", value: "$18.99" }] },
});
const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await migrate();
  (testEnv as unknown as Record<string, string>).AI_MOCK = "1"; // the mock AI provider, so a provider counts as set up
});
afterAll(() => {
  delete (testEnv as unknown as Record<string, string>).AI_MOCK;
});
beforeEach(async () => {
  await wipeAll();
  const token = await signIn("u1");
  await seedAccount("a1", "maya@chen.test");
  expect((await call("PUT", "/api/ai/settings", { token, body: { preset: "mock" } })).status).toBe(200);
  ({ thread } = await seedThread("a1", { subject: "Your domain is up for renewal", bucket: "paper_trail" }));
  const rows = (await testEnv.DB.prepare(`SELECT * FROM messages WHERE thread_id = ?`).bind(thread).all<MessageRow>()).results;
  await saveFound(testEnv.DB, thread, actionsKey(rows.map((r) => toMessage(r))), found(day));
});

describe("autoCalendarForUser", () => {
  it("adds the deadline as an all-day event linked to the mail, and only once", async () => {
    const first = await autoCalendarForUser(testEnv, "u1");
    const events = (await testEnv.DB.prepare(`SELECT * FROM events WHERE thread_id = ?`).bind(thread).all<{ title: string; all_day: number; start_date: string; description: string }>()).results;
    expect(first).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Due: Domain renewal notice for 75status.com", all_day: 1, start_date: day });
    expect(events[0].description).toContain("Renewal price: $18.99");
    expect(await autoCalendarForUser(testEnv, "u1")).toBe(0);
    expect((await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE thread_id = ?`).bind(thread).first<{ n: number }>())?.n).toBe(1);
  });

  it("leaves a deadline alone that was already dealt with", async () => {
    await setState(testEnv.DB, thread, "ovtest", "dismissed");
    expect(await autoCalendarForUser(testEnv, "u1")).toBe(0);
  });
});
