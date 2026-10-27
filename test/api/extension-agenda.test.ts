import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { extensionMayCall, hashToken, newToken } from "../../src/api/extensionTokens";

// The extension's side panel lists the next days of the calendar. A token may read that agenda, and not the calendar itself.

let token = "";
let session = "";
beforeAll(migrate);
beforeEach(async () => {
  await wipeAll();
  session = await signIn("u1");
  token = newToken();
  await testEnv.DB.prepare(`INSERT INTO extension_tokens (id, user_id, name, created_at) VALUES (?, 'u1', 'test', ?)`).bind(await hashToken(token), Date.now()).run();
});

type Agenda = { today: string; days: { date: string; events: { title: string; all_day: boolean; join: string; description?: string }[] }[] };

describe("GET /api/calendar/agenda", () => {
  it("is on the list of what a token may call, and the full calendar is not", () => {
    expect(extensionMayCall("GET", "/api/calendar/agenda")).toBe(true);
    expect(extensionMayCall("GET", "/api/calendar/events")).toBe(false);
    expect(extensionMayCall("POST", "/api/calendar/events")).toBe(false);
  });

  it("lists each day from today, with the events on it and nothing but what the panel draws", async () => {
    await call("GET", "/api/calendar/sources", { token: session }); // makes the person's default calendar
    const soon = Date.now() + 2 * 3_600_000;
    const made = await call("POST", "/api/calendar/events", { token: session, body: { title: "Daily tech. call", starts_at: soon, ends_at: soon + 900_000, description: "secret agenda", conference_url: "https://meet.example/abc" } });
    expect(made.status, JSON.stringify(await made.clone().json())).toBeLessThan(300);

    const res = await call("GET", "/api/calendar/agenda?days=3", { token });
    expect(res.status).toBe(200);
    const a = await json<Agenda>(res);
    expect(a.days).toHaveLength(3);
    expect(a.days[0].date).toBe(a.today);
    const all = a.days.flatMap((d) => d.events);
    const ev = all.find((e) => e.title === "Daily tech. call");
    expect(ev?.join).toBe("https://meet.example/abc");
    expect(JSON.stringify(a)).not.toContain("secret agenda");
  });

  it("still refuses a token the rest of the calendar", async () => {
    expect((await call("GET", "/api/calendar/events", { token })).status).toBe(403);
    expect((await call("POST", "/api/calendar/events", { token, body: { title: "x" } })).status).toBe(403);
  });
});
