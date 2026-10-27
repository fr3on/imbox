import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedAccount, seedThread, signIn, testEnv, wipeAll } from "../api-harness";
import { logActivity } from "../../src/api/activity";

beforeAll(migrate);

const list = async (token: string, query = "") => json<{ events: any[]; next: string | null }>(await call("GET", `/api/activity${query}`, { token }));

describe("the activity log", () => {
  it("lists what happened, newest first, with the older records beside it", async () => {
    await wipeAll();
    const token = await signIn("al");
    await seedAccount("al-acc", "al@example.test", { user: "al" });
    const db = testEnv.DB;
    const t = Date.now();
    await logActivity(db, "al", { actor: "you", kind: "move", summary: "Moved “Hello” to the Trash", why: "From the list" });
    await db.prepare(`INSERT INTO sync_log (account_id, level, message, created_at) VALUES ('al-acc', 'error', 'Login failed for al@example.test', ?)`).bind(t - 1000).run();
    await db.prepare(`INSERT INTO ai_calls (id, user_id, feature, model, input_tokens, output_tokens, estimated, ms, ok, created_at) VALUES ('c1', 'al', 'gist', 'test-model', 100, 20, 0, 640, 1, ?)`).bind(t - 2000).run();

    const out = await list(token);
    expect(out.events.map((e) => e.actor)).toEqual(["you", "sync", "ai"]);
    expect(out.events[0]).toMatchObject({ kind: "move", summary: "Moved “Hello” to the Trash", why: "From the list", level: "info" });
    expect(out.events[2]).toMatchObject({ summary: "Asked the AI: One-line summaries", why: "test-model · 120 tokens · 640 ms" });
    expect(out.next).toBeNull();
  });

  it("narrows by who did it, by problems, by words and by thread", async () => {
    await wipeAll();
    const token = await signIn("al2");
    await seedAccount("al2-acc", "al2@example.test", { user: "al2" });
    const { thread } = await seedThread("al2-acc", { subject: "Quarterly plan" });
    const db = testEnv.DB;
    await logActivity(db, "al2", { actor: "you", kind: "send", summary: "Sent “Quarterly plan”", threadId: thread });
    await logActivity(db, "al2", { actor: "rules", kind: "away_notice", summary: "Sent an away notice to Sam", why: "You are away" });
    await logActivity(db, "al2", { actor: "ai", kind: "auto_let_in", summary: "Let in Priya automatically", level: "warn" });

    expect((await list(token, "?actor=rules")).events.map((e) => e.kind)).toEqual(["away_notice"]);
    expect((await list(token, "?problems=1")).events.map((e) => e.kind)).toEqual(["auto_let_in"]);
    expect((await list(token, "?q=away")).events.map((e) => e.kind)).toEqual(["away_notice"]);
    expect((await list(token, "?q=100%25")).events).toEqual([]);
    expect((await list(token, `?thread=${thread}`)).events.map((e) => e.kind)).toEqual(["send"]);
    expect((await list(token, "?actor=nobody")).events).toHaveLength(3);
  });

  it("pages with a cursor and never repeats or skips an event", async () => {
    await wipeAll();
    const token = await signIn("al3");
    const db = testEnv.DB;
    for (let i = 0; i < 7; i++) {
      await db.prepare(`INSERT INTO activity_log (user_id, at, actor, kind, summary, why, level) VALUES ('al3', ?, 'you', 'move', ?, '', 'info')`).bind(1_000_000 + Math.floor(i / 2), `event ${i}`).run();
    }
    const seen: string[] = [];
    let before = "";
    for (let page = 0; page < 5; page++) {
      const out = await list(token, `?limit=3${before ? `&before=${encodeURIComponent(before)}` : ""}`);
      seen.push(...out.events.map((e) => e.summary));
      if (!out.next) break;
      before = out.next;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("shows a person only their own events, and clearing leaves the older records", async () => {
    await wipeAll();
    const a = await signIn("al4");
    const b = await signIn("al4-other");
    await logActivity(testEnv.DB, "al4", { actor: "you", kind: "move", summary: "Mine" });
    await logActivity(testEnv.DB, "al4-other", { actor: "you", kind: "move", summary: "Theirs" });
    expect((await list(b)).events.map((e) => e.summary)).toEqual(["Theirs"]);
    expect((await call("DELETE", "/api/activity", { token: a })).status).toBe(200);
    expect((await list(a)).events).toEqual([]);
    expect((await list(b)).events.map((e) => e.summary)).toEqual(["Theirs"]);
  });

  it("is written by the things a person does", async () => {
    await wipeAll();
    const token = await signIn("al5");
    await seedAccount("al5-acc", "al5@example.test", { user: "al5" });
    const { thread } = await seedThread("al5-acc", { subject: "Lunch on Thursday", from: "daniel@example.com", bucket: "imbox" });
    await call("POST", `/api/threads/${thread}/actions`, { token, body: { action: "reply_later", on: true } });
    await call("POST", `/api/threads/${thread}/actions`, { token, body: { action: "seen" } });
    await call("POST", `/api/threads/${thread}/actions`, { token, body: { action: "move", bucket: "trash" } });
    const events = (await list(token)).events;
    expect(events.map((e) => e.summary)).toEqual(["Moved “Lunch on Thursday” to the Trash", "Put “Lunch on Thursday” in Reply Later"]);
    expect(events.every((e) => e.actor === "you" && e.thread_id === thread)).toBe(true);
    // Only that conversation's own events, for the per-message view.
    expect((await list(token, `?thread=${thread}`)).events).toHaveLength(2);
  });
});
