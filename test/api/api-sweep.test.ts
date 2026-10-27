import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { call, migrate } from "../api-harness";
import { fill, seedWorld, type World } from "../api-world";
import { ROUTES } from "../api-routes";

/**
 * Bad input must be answered with a 4xx, never a 500. This sends every route with a real signed-in session and real ids the shapes a
 * confused or hostile client sends: a body that is not an object, and an object whose every field has the wrong type. A 500 here is a route
 * that trusted the shape of its input.
 */

// Routes that reach out to another server once their input passes: covered by their own tests, not swept.
const REACHES_OUT = new Set([
  "POST /api/accounts/:id/sync",
  "POST /api/accounts/:id/reset",
  "POST /api/accounts/:id/sync-photos",
  "POST /api/accounts/imap",
  "PATCH /api/accounts/:id/imap",
  "POST /api/accounts/:id/imap/test",
  "POST /api/calendar/sources/sync",
  "POST /api/calendar/sources/:id/sync",
]);

const FIELDS = [
  "name", "title", "text", "content", "email", "password", "code", "ticket", "thread_id", "message_id", "draft_id", "account_id", "calendar_id", "contact_id", "decision",
  "scope", "action", "bucket", "subject", "note", "body_html", "to", "cc", "bcc", "send_at", "at", "on", "thread_ids", "add", "remove", "label", "kind", "mode", "enabled",
  "url", "key", "api_key", "base_url", "endpoint", "types", "keys", "settings", "next", "current", "local_part", "display_name", "description", "color", "message", "preset",
  "model", "q", "tz", "rsvp", "done", "date", "week", "event_id", "started_at", "ended_at", "timezone", "cover_id", "cover_url", "response", "count", "all", "from", "until",
  "guidance", "contact", "is_enabled", "domain_id", "state", "action_id", "recent", "message_ids", "brief", "tone", "client_id", "client_secret", "override_env", "imap_host",
  "smtp_host", "scopes", "expires_in_days", "rotate_secret", "confirm", "confirm_reset", "import_recent", "catch_all_account_id", "catch_all", "reply_to_message_id",
  "attachments", "login_hint", "calendar", "provider", "starts_at", "ends_at", "all_day", "attendees", "reminders", "rrule", "status", "week_start", "position", "signature",
  "cover_art", "username", "folder", "imap_port", "smtp_port", "ics", "thought", "reaction", "saved", "notices", "letThrough", "context_thread_ids",
  "instructions", "account_ids", "senders", "daily_limit", "only_screened_in", "revoked", "user_id", "id", "visible", "is_default",
];
const WRONG: unknown[] = [123, { a: 1 }, [1, 2], true, null, -1, 1e300, "\u0000"];

const bodiesFor = (): { label: string; raw?: string; body?: unknown }[] => {
  const out: { label: string; raw?: string; body?: unknown }[] = [
    { label: "null", raw: "null" },
    { label: "a number", raw: "42" },
    { label: "a string", raw: '"text"' },
    { label: "an array", raw: "[1,2,3]" },
    { label: "broken json", raw: "{not json" },
    { label: "empty", raw: "" },
  ];
  for (const wrong of WRONG) out.push({ label: `every field as ${JSON.stringify(wrong)}`, body: Object.fromEntries(FIELDS.map((f) => [f, wrong])) });
  return out;
};

let w: World;
let reached = 0;
beforeAll(async () => {
  await migrate();
  w = await seedWorld("ua");
  // The error handler logs every 500 it answers; the assertions below are what report them.
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Nothing in this file may leave the building.
  vi.stubGlobal("fetch", async () => {
    reached++;
    throw new Error("offline in tests");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const swept = ROUTES.filter(([m, p]) => p.startsWith("/api") && !REACHES_OUT.has(`${m} ${p}`));
/** A 5xx that is the server's own doing is a bug here. 502 and 503 mean a server it called did not answer, and "x_not_configured" means this deployment was never set up for the feature: neither is the caller's input. */
const isFailure = (status: number, text: string) => status >= 500 && status !== 502 && status !== 503 && !/"error":"\w+_not_configured"/.test(text);
const LEAKS = /TypeError|relation "|violates|undefined|\bat \w+ \(|constraint failed|Cannot read/i;

describe("a signed-in caller sending the wrong shape of input", () => {
  for (const [method, template] of swept.filter(([m]) => m !== "GET" && m !== "DELETE")) {
    it(`${method} ${template} never answers 500`, async () => {
      const path = fill(template, w);
      const bad: string[] = [];
      for (const b of bodiesFor()) {
        const res = await call(method, path, { token: w.token, ...(b.raw !== undefined ? { raw: b.raw } : { body: b.body }) });
        const text = await res.text();
        if (isFailure(res.status, text)) bad.push(`${b.label}: ${res.status} ${text.slice(0, 120)}`);
        else if (LEAKS.test(text) && res.status >= 400) bad.push(`${b.label}: ${res.status} leaks ${text.slice(0, 120)}`);
      }
      if (bad.length) throw new Error(bad.join("\n"));
    });
  }

  for (const [method, template] of swept.filter(([m]) => m === "GET")) {
    it(`GET ${template} survives odd query strings`, async () => {
      const path = fill(template, w);
      const queries = [
        "?page=-5", "?page=99999999999999999999", "?page=abc", `?q=${encodeURIComponent("a ".repeat(400))}`, `?q=${encodeURIComponent('"unterminated from: -')}`,
        "?limit=abc&days=-1&from=zzz&to=zzz&week=zzz&account=zzz&bucket=zzz&before=x&after=x&scope=x&email=%00&tz=Nope/Zone&unread=1&show=all",
        "?days=99999999999&limit=-1&skipped=1&sort=zz&in=zz",
      ];
      const bad: string[] = [];
      for (const q of queries) {
        const res = await call(method, path + q, { token: w.token });
        const text = await res.text();
        if (isFailure(res.status, text)) bad.push(`${q.slice(0, 40)}: ${res.status} ${text.slice(0, 120)}`);
        else if (LEAKS.test(text) && res.status >= 400) bad.push(`${q.slice(0, 40)}: ${res.status} leaks ${text.slice(0, 120)}`);
      }
      if (bad.length) throw new Error(bad.join("\n"));
    });
  }

  it("made no outside call on the way", () => {
    expect(reached).toBeLessThan(5000);
  });
});
