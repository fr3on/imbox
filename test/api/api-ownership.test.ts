import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, json, migrate, testEnv } from "../api-harness";
import { fill, seedWorld, type World } from "../api-world";
import { ROUTES } from "../api-routes";

/**
 * Two people share one server. Everything the second one is told, and everything the second one can change, must stop at the edge of the
 * second one's own data: a route that takes an id has to look the id up under the signed-in user, never by the id alone.
 */

let a: World;
let b: World;
const db = () => testEnv.DB;

// What only A's data contains. If any of it shows up in an answer to B, A's mail has leaked.
const A_MARKERS = ["Mail of ua", "Agent mail of ua", "ua@imap.test", "ua@gmail.test", "ua-bot@imap.test", "ua.example.org", "worth keeping ua", "I prefer short answers ua", "Never promise a date ua", "L-ua", "C-ua", "Cal-ua", "Bot-ua", "Someday ua", "Lunch ua", "Work ua"];
const leaks = (text: string) => A_MARKERS.filter((m) => text.includes(m));

/** Every row A owns, as text, so a before and an after can be compared. */
async function fingerprint(w: World): Promise<string> {
  const accounts = [w.gmail, w.imap, w.agentAccount, w.domainAccount];
  const inAcc = `(${accounts.map((x) => `'${x}'`).join(",")})`;
  const queries: Record<string, string> = {
    users: `SELECT id, name, settings_json, password_hash, totp_enabled FROM users WHERE id = '${w.user}'`,
    accounts: `SELECT * FROM accounts WHERE user_id = '${w.user}' ORDER BY id`,
    imap_accounts: `SELECT * FROM imap_accounts WHERE account_id IN ${inAcc} ORDER BY account_id NULLS FIRST`,
    threads: `SELECT * FROM threads WHERE account_id IN ${inAcc} ORDER BY id`,
    messages: `SELECT id, unread, thread_id FROM messages WHERE account_id IN ${inAcc} ORDER BY id`,
    attachments: `SELECT * FROM attachments WHERE account_id IN ${inAcc}`,
    labels: `SELECT * FROM labels WHERE account_id IN ${inAcc}`,
    thread_labels: `SELECT * FROM thread_labels`,
    collections: `SELECT * FROM collections WHERE account_id IN ${inAcc}`,
    collection_threads: `SELECT * FROM collection_threads`,
    clips: `SELECT * FROM clips WHERE account_id IN ${inAcc}`,
    drafts: `SELECT * FROM drafts WHERE account_id IN ${inAcc}`,
    bundles: `SELECT * FROM bundles WHERE account_id IN ${inAcc}`,
    contacts: `SELECT * FROM contacts WHERE account_id IN ${inAcc}`,
    domains: `SELECT * FROM domains WHERE user_id = '${w.user}'`,
    stalwart_servers: `SELECT * FROM stalwart_servers WHERE user_id = '${w.user}'`,
    passkeys: `SELECT * FROM passkeys WHERE user_id = '${w.user}'`,
    auto_let_ins: `SELECT * FROM auto_let_ins WHERE user_id = '${w.user}'`,
    calendars: `SELECT * FROM calendars WHERE user_id = '${w.user}' ORDER BY id`,
    events: `SELECT * FROM events WHERE user_id = '${w.user}' ORDER BY id`,
    day_covers: `SELECT id, user_id, mime, size, name FROM day_covers WHERE user_id = '${w.user}'`,
    calendar_days: `SELECT * FROM calendar_days WHERE user_id = '${w.user}'`,
    ai_conversations: `SELECT * FROM ai_conversations WHERE user_id = '${w.user}'`,
    ai_memory: `SELECT * FROM ai_memory WHERE user_id = '${w.user}'`,
    auto_agents: `SELECT * FROM auto_agents WHERE user_id = '${w.user}'`,
    auto_agent_memory: `SELECT * FROM auto_agent_memory WHERE user_id = '${w.user}'`,
    agent_mailboxes: `SELECT * FROM agent_mailboxes WHERE account_id IN ${inAcc}`,
    agent_keys: `SELECT id, account_id, name, revoked_at, scopes FROM agent_keys WHERE account_id IN ${inAcc}`,
    push_subscriptions: `SELECT * FROM push_subscriptions WHERE user_id = '${w.user}'`,
  };
  const out: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(queries)) out[k] = (await db().prepare(q).all()).results;
  return JSON.stringify(out);
}

beforeAll(async () => {
  await migrate();
  // The mock AI provider, so the AI routes get past "no provider set up" and reach the check this file is about.
  (testEnv as unknown as Record<string, string>).AI_MOCK = "1";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
  a = await seedWorld("ua");
  b = await seedWorld("ub");
  for (const w of [a, b]) expect((await call("PUT", "/api/ai/settings", { token: w.token, body: { preset: "mock" } })).status).toBe(200);
  // A has a push device; B knows its address.
  const endpoint = "https://push.example.com/send/ua-device";
  const sub = await call("POST", "/api/push/subscribe", { token: a.token, body: { endpoint, keys: { p256dh: "p".repeat(60), auth: "a".repeat(20) } } });
  expect(sub.status).toBe(200);
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (testEnv as unknown as Record<string, string>).AI_MOCK;
});

// Routes whose id parameter alone is enough to say "not yours". A request body, where the route needs one to get as far as the id, is below.
const ID_PARAMS = /:(id|accountId|threadId|attId|aid|keyId|mid)\b/;

const BODIES: Record<string, (w: World) => unknown> = {
  "POST /api/threads/:id/actions": () => ({ action: "mark_read" }),
  "POST /api/accounts/:id/imap/resync": () => ({ count: 10 }),
  "PATCH /api/accounts/:id/imap": () => ({ imap_host: "evil.example.net" }),
  "PUT /api/agents/:accountId": () => ({ enabled: false }),
  "POST /api/agents/:accountId/keys": () => ({ name: "k", scopes: ["read"] }),
  "PUT /api/agents/:accountId/webhook": () => ({ url: "https://hooks.example.net/x" }),
  "PATCH /api/ai/memory/:id": () => ({ content: "overwritten" }),
  "PATCH /api/ai/conversations/:id": () => ({ title: "overwritten" }),
  "PUT /api/auto-agents/:id": () => ({ name: "overwritten", enabled: false }),
  "POST /api/auto-agents/:id/memory": () => ({ content: "planted" }),
  "PATCH /api/auto-agents/:id/memory/:mid": () => ({ content: "overwritten" }),
  "PATCH /api/labels/:id": () => ({ name: "overwritten" }),
  "PATCH /api/collections/:id": () => ({ name: "overwritten" }),
  "PATCH /api/contacts/:id": () => ({ name: "overwritten", screen_status: "screened_out" }),
  "PATCH /api/drafts/:id": () => ({ subject: "overwritten" }),
  "PATCH /api/me/passkeys/:id": () => ({ name: "overwritten" }),
  "PATCH /api/domains/:id": () => ({ catch_all_account_id: null }),
  "POST /api/domains/:id/mailboxes": () => ({ local_part: "planted" }),
  "PATCH /api/calendar/events/:id": () => ({ title: "overwritten" }),
  "POST /api/calendar/events/:id/rsvp": () => ({ rsvp: "accepted" }),
  "POST /api/calendar/events/:id/done": () => ({ done: true }),
  "PATCH /api/calendar/sources/:id": () => ({ name: "overwritten" }),
  "PATCH /api/calendar/flex-tasks/:id": () => ({ title: "overwritten" }),
  "PATCH /api/calendar/time/:id": () => ({ title: "overwritten" }),
  "PATCH /api/accounts/:id": () => ({ signature: "overwritten", display_name: "overwritten" }),
  "POST /api/stalwart/:id/mailboxes/:sid/connect": () => ({ confirm_reset: true }),
  "PUT /api/stalwart/:id/key": () => ({ api_key: "a-new-api-key" }),
  "POST /api/stalwart/:id/domains": () => ({ name: "planted.example.org" }),
  "PATCH /api/stalwart/:id/domains/:did": () => ({ is_enabled: false }),
  "POST /api/stalwart/:id/mailboxes": () => ({ name: "planted", domain_id: "d" }),
  "POST /api/stalwart/:id/mailboxes/:sid/reset-password": () => ({}),
  "POST /api/ai/summarize": (w) => ({ thread_id: w.thread }),
};

// Not a route of one person's data: the id names nothing of A's, or the answer is the same for everyone.
const SKIP = new Set<string>([]);

// These answer 200 for any id, having changed nothing (deleting what is not yours is a no-op, not an error). The fingerprint below proves "nothing".
const NO_OP_OK = new Set(["DELETE /api/me/passkeys/:id", "PATCH /api/me/passkeys/:id", "PATCH /api/ai/conversations/:id", "DELETE /api/ai/conversations/:id", "DELETE /api/ai/memory/:id"]);

describe("one person's ids do nothing for another person", () => {
  const idRoutes = ROUTES.filter(([m, p]) => p.startsWith("/api") && ID_PARAMS.test(p) && !SKIP.has(`${m} ${p}`));

  it("covers every route that takes an id", () => {
    expect(idRoutes.length).toBeGreaterThan(70);
  });

  for (const [method, template] of idRoutes) {
    it(`${method} ${template} answers B as if A's thing were not there`, async () => {
      const before = await fingerprint(a);
      const path = fill(template, a);
      const body = BODIES[`${method} ${template}`]?.(a);
      const res = await call(method, path, { token: b.token, ...(method === "GET" || method === "DELETE" ? {} : { body: body ?? {} }) });
      const text = await res.text();
      const key = `${method} ${template}`;
      if (NO_OP_OK.has(key)) expect([200, 404]).toContain(res.status);
      else expect([400, 404], `${key} -> ${res.status} ${text.slice(0, 160)}`).toContain(res.status);
      expect(leaks(text), `${key} showed A's data`).toEqual([]);
      expect(await fingerprint(a), `${key} changed A's data`).toBe(before);
    });
  }
});

describe("ids carried in a body, not in the path", () => {
  const cases: [string, string, (w: World) => unknown, number[]][] = [
    ["POST", "/api/clips", (w) => ({ thread_id: w.thread, text: "planted" }), [404]],
    ["POST", "/api/labels", (w) => ({ name: "planted", account_id: w.imap }), [400]],
    ["POST", "/api/collections", (w) => ({ name: "planted", account_id: w.imap }), [400]],
    ["POST", "/api/drafts", (w) => ({ account_id: w.imap, subject: "planted", to: ["a@b.co"] }), [400]],
    ["POST", "/api/send", (w) => ({ account_id: w.imap, to: ["a@b.co"], subject: "x", body_html: "<p>x</p>" }), [400]],
    ["POST", "/api/send", (w) => ({ thread_id: w.thread, to: ["a@b.co"], subject: "x", body_html: "<p>x</p>" }), [404]],
    ["POST", "/api/send/cancel", (w) => ({ draft_id: w.draft }), [404]],
    ["POST", "/api/threads/bulk", (w) => ({ thread_ids: [w.thread], action: "delete" }), [200]],
    ["POST", "/api/screener/decide", (w) => ({ contact_id: w.contact, decision: "screened_out" }), [404]],
    ["POST", "/api/ai/reply", (w) => ({ thread_id: w.thread, brief: "say yes" }), [404]],
    ["POST", "/api/ai/summarize", (w) => ({ thread_id: w.thread }), [404]],
    ["POST", "/api/ai/gist", (w) => ({ thread_id: w.thread }), [404]],
    ["POST", "/api/ai/gists", (w) => ({ thread_ids: [w.thread] }), [200]],
    ["POST", "/api/ai/catchup", (w) => ({ thread_id: w.thread, message_ids: [w.message] }), [404]],
    ["POST", "/api/ai/actions", (w) => ({ thread_id: w.thread }), [404]],
    ["POST", "/api/ai/actions/state", (w) => ({ thread_id: w.thread, action_id: "x", state: "done" }), [404]],
    ["POST", "/api/calendar/events", (w) => ({ calendar_id: w.calendar, title: "planted" }), [404]],
    ["POST", "/api/calendar/events/from-thread", (w) => ({ thread_id: w.thread }), [404]],
    ["POST", "/api/calendar/time", (w) => ({ title: "x", event_id: w.event }), [404]],
    ["PUT", "/api/calendar/days/2030-01-01", (w) => ({ cover_id: w.cover }), [404]],
    ["POST", "/api/auto-agents", (w) => ({ name: "planted", account_ids: [w.imap] }), [400]],
    ["POST", "/api/calendar/google/connect-link", (w) => ({ account_id: w.gmail }), [404, 500]],
  ];
  for (const [method, path, body, statuses] of cases) {
    it(`${method} ${path} with A's id in the body`, async () => {
      const before = await fingerprint(a);
      const res = await call(method, path, { token: b.token, body: body(a) });
      const text = await res.text();
      expect(statuses, `${method} ${path} -> ${res.status} ${text.slice(0, 160)}`).toContain(res.status);
      expect(leaks(text)).toEqual([]);
      expect(await fingerprint(a)).toBe(before);
    });
  }

  it("does not let B move a draft of B's own onto A's account", async () => {
    const mine = (await json(await call("POST", "/api/drafts", { token: b.token, body: { account_id: b.imap, subject: "mine" } }))).id;
    const res = await call("PATCH", `/api/drafts/${mine}`, { token: b.token, body: { account_id: a.imap } });
    expect(res.status).toBe(400);
    expect((await db().prepare(`SELECT account_id FROM drafts WHERE id = ?`).bind(mine).first<{ account_id: string }>())!.account_id).toBe(b.imap);
  });

  it("does not let B give an auto agent of B's own one of A's mailboxes", async () => {
    const res = await call("PUT", `/api/auto-agents/${b.autoAgent}`, { token: b.token, body: { account_ids: [a.imap] } });
    expect(res.status).toBe(400);
  });

  it("does not let B point a domain's catch-all at A's mailbox", async () => {
    const res = await call("PATCH", `/api/domains/${b.domain}`, { token: b.token, body: { catch_all_account_id: a.domainAccount } });
    expect(res.status).toBe(400);
    expect((await db().prepare(`SELECT catch_all_account_id FROM domains WHERE id = ?`).bind(b.domain).first<{ catch_all_account_id: string | null }>())!.catch_all_account_id).toBeNull();
  });

  it("does not let B stick one of A's labels on B's thread, or one of B's on A's", async () => {
    const mine = await call("POST", `/api/threads/${b.thread}/actions`, { token: b.token, body: { action: "labels", add: [a.label] } });
    expect(mine.status).toBe(200);
    expect((await db().prepare(`SELECT COUNT(*) AS n FROM thread_labels WHERE thread_id = ? AND label_id = ?`).bind(b.thread, a.label).first<{ n: number }>())!.n).toBe(0);
    const theirs = await call("POST", `/api/threads/${a.thread}/actions`, { token: b.token, body: { action: "labels", add: [b.label] } });
    expect(theirs.status).toBe(404);
  });

  it("does not let B merge A's thread into B's own", async () => {
    const res = await call("POST", `/api/threads/${b.thread}/actions`, { token: b.token, body: { action: "merge", thread_ids: [a.thread] } });
    expect([404, 400]).toContain(res.status);
    expect((await db().prepare(`SELECT merged_into FROM threads WHERE id = ?`).bind(a.thread).first<{ merged_into: string | null }>())!.merged_into).toBeNull();
  });

  it("does not let B delete A's push device by naming its address", async () => {
    const endpoint = "https://push.example.com/send/ua-device";
    expect((await call("POST", "/api/push/unsubscribe", { token: b.token, body: { endpoint } })).status).toBe(200);
    expect((await call("PUT", "/api/push/types", { token: b.token, body: { endpoint, types: { mail: false } } })).status).toBe(200);
    const row = await db().prepare(`SELECT types_json FROM push_subscriptions WHERE endpoint = ?`).bind(endpoint).first<{ types_json: string }>();
    expect(row).not.toBeNull();
    expect(row!.types_json).not.toContain('"mail":false');
    const status = await json(await call("POST", "/api/push/status", { token: b.token, body: { endpoint } }));
    expect(status.subscribed).toBe(false);
  });
});

describe("lists never include the other person's mail", () => {
  const lists = ROUTES.filter(([m, p]) => m === "GET" && p.startsWith("/api") && !/:/.test(p) && !["/api/me", "/api/version", "/api/push/key"].includes(p));
  for (const [, path] of lists) {
    it(`GET ${path}`, async () => {
      const res = await call("GET", path, { token: b.token });
      const text = await res.text();
      expect(leaks(text), `${path} -> ${res.status}`).toEqual([]);
    });
    it(`GET ${path} with A's account named in the scope`, async () => {
      for (const scope of [{ headers: { "x-account-id": a.imap } }, { headers: { "x-account-id": a.gmail } }]) {
        const res = await call("GET", `${path}${path.includes("?") ? "&" : "?"}account=${a.imap}`, { token: b.token, ...scope });
        expect(leaks(await res.text()), `${path} with ${JSON.stringify(scope.headers)}`).toEqual([]);
      }
    });
  }

  it("shows B only B's own mailboxes and counts", async () => {
    const accounts = await json<{ id: string }[]>(await call("GET", "/api/accounts", { token: b.token }));
    expect(accounts.map((x) => x.id).sort()).toEqual([b.agentAccount, b.domainAccount, b.gmail, b.imap].sort());
    const search = await json(await call("GET", "/api/search?q=Mail", { token: b.token }));
    expect(JSON.stringify(search)).toContain("Mail of ub");
    expect(JSON.stringify(search)).not.toContain("Mail of ua");
  });
});

describe("the agent API sees one mailbox", () => {
  it("lets A's key read A's agent mailbox and nothing of B's", async () => {
    const own = await call("GET", `/agent/v1/messages/${a.agentMessage}`, { token: a.agentKeyPlain });
    expect(own.status).toBe(200);
    const theirs = await call("GET", `/agent/v1/messages/${b.agentMessage}`, { token: a.agentKeyPlain });
    expect(theirs.status).toBe(404);
    const list = await call("GET", "/agent/v1/messages?direction=all", { token: a.agentKeyPlain });
    const text = await list.text();
    expect(text).toContain("Agent mail of ua");
    expect(text).not.toContain("Agent mail of ub");
  });

  it("cannot be used to reply to, mark read or fetch an attachment of another mailbox's message", async () => {
    expect((await call("POST", `/agent/v1/messages/${b.agentMessage}/reply`, { token: a.agentKeyPlain, body: { text: "hi" } })).status).toBe(404);
    expect((await call("POST", `/agent/v1/messages/${b.agentMessage}/read`, { token: a.agentKeyPlain, body: {} })).status).toBe(404);
    expect((await call("GET", `/agent/v1/messages/${b.agentMessage}/attachments/${b.attachment}`, { token: a.agentKeyPlain })).status).toBe(404);
  });
});
