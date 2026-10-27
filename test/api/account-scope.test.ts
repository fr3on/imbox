import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, seedThread, signIn, wipeAll } from "../api-harness";
import { seedAccount, seedAgent } from "../agent-fixtures";
import { resetStatements, sent } from "../support/pgenv";

/**
 * Which accounts a request reads: the user's own, with an agent's mailbox kept out of the unified inbox unless it is all there is, narrowed to one by
 * X-Account-Id, and never someone else's. The middleware (requireAccount) decides it for every list, so it is pinned here, one scenario at a time.
 */

const subjects = async (token: string, headers: Record<string, string> = {}) => {
  const res = await call("GET", "/api/threads?bucket=imbox", { token, headers });
  expect(res.status).toBe(200);
  return ((await json(res)).threads as { subject: string }[]).map((t) => t.subject).sort();
};

beforeAll(async () => {
  await migrate();
  await wipeAll();
});

describe("which accounts a request reads", () => {
  let token: string;
  let other: string;

  beforeAll(async () => {
    token = await signIn("u1");
    other = await signIn("u2");
    await seedAccount("a-mine", "mine@test.local", { user: "u1" });
    await seedAccount("a-work", "work@test.local", { user: "u1" });
    await seedAccount("a-bot", "bot@test.local", { user: "u1" });
    await seedAgent("a-bot");
    await seedAccount("a-theirs", "theirs@test.local", { user: "u2" });
    await seedThread("a-mine", { subject: "mine" });
    await seedThread("a-work", { subject: "work" });
    await seedThread("a-bot", { subject: "bot" });
    await seedThread("a-theirs", { subject: "theirs" });
  });

  it("reads all of a person's own accounts, and leaves an agent's mailbox out", async () => {
    expect(await subjects(token)).toEqual(["mine", "work"]);
    expect(await subjects(token, { "x-account-id": "all" })).toEqual(["mine", "work"]);
  });

  it("reads one account when it is asked for by header or by query", async () => {
    expect(await subjects(token, { "x-account-id": "a-work" })).toEqual(["work"]);
    const res = await call("GET", "/api/threads?bucket=imbox&account=a-mine", { token });
    expect(((await json(res)).threads as { subject: string }[]).map((t) => t.subject)).toEqual(["mine"]);
  });

  it("shows an agent's mailbox when it is picked by name", async () => {
    expect(await subjects(token, { "x-account-id": "a-bot" })).toEqual(["bot"]);
  });

  it("never reads another person's account: an id that is not theirs falls back to their own", async () => {
    expect(await subjects(token, { "x-account-id": "a-theirs" })).toEqual(["mine", "work"]);
    expect(await subjects(other)).toEqual(["theirs"]);
  });

  it("counts only what the same scope reads", async () => {
    const res = await call("GET", "/api/counts", { token });
    expect((await json(res)).imbox_new).toBe(2);
  });

  it("asks the database about the accounts once, even on a path the middleware is mounted on twice", async () => {
    for (const path of ["/api/threads?bucket=imbox", "/api/contacts", "/api/labels"]) {
      resetStatements();
      const res = await call("GET", path, { token });
      expect(res.status).toBe(200);
      expect(sent.sql.filter((q) => /FROM accounts/.test(q) && /agent_mailboxes/.test(q)).length, path).toBe(1);
      expect(sent.sql.filter((q) => /agent_mailboxes m JOIN accounts/.test(q)).length, path).toBe(0);
    }
  });
});

describe("a person with no account", () => {
  it("is told so, not given an empty inbox", async () => {
    const token = await signIn("u3");
    const res = await call("GET", "/api/threads?bucket=imbox", { token });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("no_account");
  });
});

describe("a person whose only account is an agent's", () => {
  it("reads it as the whole inbox", async () => {
    const token = await signIn("u4");
    await seedAccount("a-only-bot", "onlybot@test.local", { user: "u4" });
    await seedAgent("a-only-bot");
    await seedThread("a-only-bot", { subject: "all there is" });
    expect(await subjects(token)).toEqual(["all there is"]);
  });
});
