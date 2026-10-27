import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { uid } from "../../src/api/db";

const db = () => testEnv.DB;
let token: string;
const userId = "clip_user";
const accountId = "clip_acc";
let threadId: string;
let messageId: string;

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn(userId);
  await seedAccount(accountId, "clip@test.local", { user: userId });

  threadId = uid();
  messageId = uid();
  const now = Date.now();

  await db()
    .prepare(
      `INSERT INTO threads (id, account_id, gmail_thread_id, subject, snippet, bucket, seen, unread, created_at, updated_at, message_count, first_message_at, last_message_at)
       VALUES (?, ?, ?, 'Test Clip Thread', 'Snippet', 'imbox', 1, 0, ?, ?, 1, ?, ?)`
    )
    .bind(threadId, accountId, threadId, now, now, now, now)
    .run();

  await db()
    .prepare(
      `INSERT INTO messages (id, account_id, thread_id, gmail_message_id, from_email, from_name, to_json, cc_json, bcc_json, subject, date, snippet, text_body, html_body, is_from_me, unread, created_at)
       VALUES (?, ?, ?, ?, 'from@test.local', 'From', '[]', '[]', '[]', 'Test Clip Thread', ?, 'Snippet', 'Hello world clip text', '<p>Hello world clip text</p>', 0, 0, ?)`
    )
    .bind(messageId, accountId, threadId, messageId, now, now)
    .run();
});

describe("Clips API", () => {
  it("POST /api/clips successfully saves a clip", async () => {
    const res = await call("POST", "/api/clips", {
      token,
      body: {
        thread_id: threadId,
        message_id: messageId,
        text: "Save up to 79% now on select domains and transfers.",
      },
    });
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.text).toBe("Save up to 79% now on select domains and transfers.");
    expect(data.thread_id).toBe(threadId);
    expect(data.message_id).toBe(messageId);
    expect(data.account_id).toBe(accountId);

    // Verify GET /api/threads/:id includes the clip
    const tRes = await call("GET", `/api/threads/${threadId}`, { token });
    expect(tRes.status).toBe(200);
    const tData = await json(tRes);
    expect(tData.clips).toHaveLength(1);
    expect(tData.clips[0].text).toBe("Save up to 79% now on select domains and transfers.");
  });
});
