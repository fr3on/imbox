import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, testEnv, wipeAll } from "../api-harness";
import { ownedRow } from "../../src/api/db";
import { resetStatements, sent } from "../support/pgenv";

/**
 * Custom domains and their mailboxes: a name belongs to one person on the whole server, and so does an address. The checks for that were a look and then an
 * insert, so two requests that arrived together both passed the look and the second failed in the database as a server error. Pinned with the answers one
 * at a time first.
 */

const db = () => testEnv.DB;
let token: string;
let other: string;
const as = (method: string, path: string, body?: unknown, t = token) => call(method, path, { token: t, body: method === "GET" || method === "DELETE" ? undefined : (body ?? {}) });

beforeAll(async () => {
  await migrate();
  await wipeAll();
  token = await signIn("dmu");
  other = await signIn("dmv");
});

describe("domains", () => {
  it("are added by name in lower case, listed, and refused when the name is bad or taken, by anyone", async () => {
    const r = await as("POST", "/api/domains", { name: "Mail.Example.ORG." });
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ name: "mail.example.org", status: "pending", mailboxes: [] });
    expect((await json(await as("GET", "/api/domains"))).map((d: any) => d.name)).toEqual(["mail.example.org"]);
    expect((await as("POST", "/api/domains", { name: "mail.example.org" })).status).toBe(409);
    expect((await as("POST", "/api/domains", { name: "mail.example.org" }, other)).status).toBe(409);
    expect((await as("POST", "/api/domains", { name: "not a domain" })).status).toBe(400);
    expect((await json(await as("GET", "/api/domains", undefined, other))).length).toBe(0);
  });

  it("are added once when the same name arrives twice together, and the other is told it exists", async () => {
    const answers = await Promise.all([as("POST", "/api/domains", { name: "race.example.org" }), as("POST", "/api/domains", { name: "race.example.org" }, other), as("POST", "/api/domains", { name: "race.example.org" })]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM domains WHERE name = 'race.example.org'`).first<{ n: number }>())!.n).toBe(1);
  });

  it("take mailboxes with a local part, a catch-all, and refuse a second one with the same address, also when they arrive together", async () => {
    const d = await json(await as("POST", "/api/domains", { name: "boxes.example.org" }));
    const made = await json(await as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "Info", display_name: "Info desk", catch_all: true }));
    expect(made).toMatchObject({ email: "info@boxes.example.org", provider: "domain" });
    const listed = await json(await as("GET", "/api/domains"));
    expect(listed.find((x: any) => x.id === d.id)).toMatchObject({ catch_all_account_id: made.id });
    expect((await as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "info" })).status).toBe(409);
    expect((await as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "bad one" })).status).toBe(400);
    expect((await as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "sales" }, other)).status).toBe(404);
    const both = await Promise.all([as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "twin" }), as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "twin" })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("are changed only by their owner, and removing one removes its mailboxes", async () => {
    const d = await json(await as("POST", "/api/domains", { name: "gone.example.org" }));
    const m = await json(await as("POST", `/api/domains/${d.id}/mailboxes`, { local_part: "a" }));
    expect((await as("PATCH", `/api/domains/${d.id}`, { catch_all_account_id: m.id }, other)).status).toBe(404);
    expect((await as("PATCH", `/api/domains/${d.id}`, { catch_all_account_id: m.id })).status).toBe(200);
    expect((await as("DELETE", `/api/domains/${d.id}`, undefined, other)).status).toBe(404);
    expect((await as("DELETE", `/api/domains/${d.id}`)).status).toBe(200);
    expect(await db().prepare(`SELECT 1 FROM accounts WHERE id = ?`).bind(m.id).first()).toBeNull();
    expect(await db().prepare(`SELECT 1 FROM domains WHERE id = ?`).bind(d.id).first()).toBeNull();
  });

  it("take a few statements to add", async () => {
    await as("GET", "/api/domains");
    resetStatements();
    await as("POST", "/api/domains", { name: "count.example.org" });
    expect(sent.statements).toBeLessThanOrEqual(5);
  });
});

describe("a row of an account-owned table, by id", () => {
  it("is found for its owner and only its owner, and only for the tables that have an account", async () => {
    await db().prepare(`INSERT INTO accounts (id, user_id, provider, email, created_at) VALUES ('ow-a', 'dmu', 'imap', 'ow@test.local', 1)`).run();
    await db().prepare(`INSERT INTO labels (id, account_id, name, color, created_at) VALUES ('ow-l', 'ow-a', 'L', '#111111', 1)`).run();
    expect(await ownedRow(db(), "labels", "ow-l", "dmu")).toMatchObject({ id: "ow-l" });
    expect(await ownedRow(db(), "labels", "ow-l", "dmv")).toBeNull();
    await expect(ownedRow(db(), "users; DROP TABLE users" as never, "x", "dmu")).rejects.toThrow(/account-owned/);
    await expect(ownedRow(db(), "sessions" as never, "x", "dmu")).rejects.toThrow(/account-owned/);
  });
});
