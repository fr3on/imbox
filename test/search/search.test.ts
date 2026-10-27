import { beforeEach, describe, expect, it } from "vitest";
import { call, json, seedThread, signIn } from "../api-harness";
import { seedAccount } from "../agent-fixtures";
import { parseSearch } from "../../src/shared/searchQuery";
import { testEnv } from "../helpers";

describe("reading a search", () => {
  it("separates words, phrases and filters", () => {
    const { parsed } = parseSearch('budget "annual plan" from:sam@example.org is:unread');
    expect(parsed.terms).toEqual(expect.arrayContaining(["budget"]));
    expect(JSON.stringify(parsed)).toContain("sam@example.org");
  });
});

describe("GET /api/search", () => {
  let token: string;
  beforeEach(async () => {
    token = await signIn("us");
    await seedAccount("us-acc", "us@imap.test", { user: "us", provider: "imap" });
    const a = await seedThread("us-acc", { subject: "Zanzibar budget review" });
    await testEnv.DB.prepare(`UPDATE messages SET text_body = 'the quarterly budget is attached' WHERE id = ?`).bind(a.message).run();
    await seedThread("us-acc", { subject: "Lunch on Friday" });
  });

  it("finds a thread by a word in its subject or body, and not the others", async () => {
    const hit = JSON.stringify(await json(await call("GET", "/api/search?q=zanzibar", { token })));
    expect(hit).toContain("Zanzibar budget review");
    expect(hit).not.toContain("Lunch on Friday");
    expect(JSON.stringify(await json(await call("GET", "/api/search?q=quarterly", { token })))).toContain("Zanzibar budget review");
  });

  it("matches nothing for a word nobody wrote, and survives odd input", async () => {
    expect(JSON.stringify(await json(await call("GET", "/api/search?q=qqqzzz", { token })))).not.toContain("Zanzibar");
    for (const q of ['"unterminated', "from:", "%", "a ".repeat(300)]) expect((await call("GET", `/api/search?q=${encodeURIComponent(q)}`, { token })).status).toBeLessThan(500);
  });
});
