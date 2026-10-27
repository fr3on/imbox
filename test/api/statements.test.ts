import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { call, migrate, seedThread, nid, testEnv } from "../api-harness";
import { fill, seedWorld, type World } from "../api-world";
import { ROUTES } from "../api-routes";
import { resetStatements, sent } from "../support/pgenv";
import { clearCommonTerms } from "../../src/api/search";

/**
 * How many statements each read route sends to the database, counted, and the number kept in statement-budget.json. Two things are checked:
 *
 *  - the count does not grow with the data. Each route is run on a small mailbox and again on one with ten more threads, contacts and messages; a route that
 *    asks the database one thing per row (one query for the list, then one for each row) answers with more statements the second time, and fails here;
 *  - the count is at or under its budget. A change that makes a route ask more has to say so, by changing the number, so the cost shows up in review.
 *
 * To record the numbers after a deliberate change:  UPDATE_BUDGET=1 npx vitest run test/api/statements.test.ts
 */

const BUDGET_FILE = path.join(__dirname, "statement-budget.json");
const budget: Record<string, number> = fs.existsSync(BUDGET_FILE) ? JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8")) : {};
const update = process.env.UPDATE_BUDGET === "1";

// Routes known to ask for more when there is more data. The test found one the day it was written (the Imbox, fixed in docs/perf/changes.md), so the list is empty now.
// It can only shrink: a route that stops growing has to be taken off it, and a new route that grows is not let on.
const KNOWN_GROWTH = new Set<string>([]);

// Routes that reach out to another server or stream, and are not a read of the database.
const SKIP = new Set(["GET /api/events", "GET /api/accounts/:id/oauth", "GET /api/messages/:id/source"]);
const READS = ROUTES.filter(([m, p]) => m === "GET" && !SKIP.has(`${m} ${p}`) && !/^\/(auth|agent)\//.test(p) && !p.includes("/oauth") && !p.includes("callback"));

let w: World;
const measured: Record<string, number> = {};
const small: Record<string, number> = {};
const texts: { small: Record<string, string[]>; large: Record<string, string[]> } = { small: {}, large: {} };
const brief = (q: string) => q.replace(/\s+/g, " ").replace(/\(\?(,\s?\?)*\)/g, "(?…)").slice(0, 110);

async function measure(token: string, into: Record<string, string[]>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [m, p] of READS) {
    clearCommonTerms();
    resetStatements();
    const res = await call(m, `${fill(p, w)}${p.includes("/search") ? "?q=hello" : ""}`, { token });
    await res.arrayBuffer().catch(() => null);
    out[`${m} ${p}`] = sent.statements;
    into[`${m} ${p}`] = sent.sql.map(brief);
  }
  return out;
}

beforeAll(async () => {
  await migrate();
  w = await seedWorld("us");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline in tests");
  });
  // More of everything a list draws a row for, in the account the world's own thread is in, so only the number of rows changes and not the number of accounts.
  // A route that fills a section only when it has something for it (a bundle, a screener row) asks for more once the section is not empty, so the small
  // mailbox starts with a few rows already and the large one adds ten more.
  const home = (await testEnv.DB.prepare(`SELECT account_id FROM threads WHERE id = ?`).bind(w.thread).first<{ account_id: string }>())!.account_id;
  const more = async (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      await seedThread(home, { subject: `More ${i}`, from: `more${i}@example.com` });
      await testEnv.DB.prepare(`INSERT INTO contacts (id, account_id, email, name, screen_status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, 'in', ?, ?) ON CONFLICT DO NOTHING`)
        .bind(nid("c"), home, `more${i}@example.com`, `More ${i}`, Date.now(), Date.now())
        .run();
    }
  };
  await more(0, 3);
  Object.assign(small, await measure(w.token, texts.small));
  await more(3, 13);
  Object.assign(measured, await measure(w.token, texts.large));
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (update) {
    const sorted = Object.fromEntries(Object.entries(measured).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  }
});

describe("statements per read route", () => {
  it("covers the routes it should", () => {
    expect(READS.length).toBeGreaterThan(30);
  });

  it("does not send more statements when there is more data", () => {
    const grew = Object.keys(measured).filter((k) => measured[k] > small[k] && !KNOWN_GROWTH.has(k));
    // For each route that grew, say which statements there are more of, so the cause is in the failure and not to be hunted for.
    const why = (k: string) => {
      const count = (list: string[]) => list.reduce((m, q) => m.set(q, (m.get(q) ?? 0) + 1), new Map<string, number>());
      const before = count(texts.small[k]);
      return [...count(texts.large[k])].filter(([q, n]) => n > (before.get(q) ?? 0)).map(([q, n]) => `    ${before.get(q) ?? 0} then ${n}: ${q}`);
    };
    expect(grew.map((k) => [`${k}: ${small[k]} then ${measured[k]}`, ...why(k)].join("\n"))).toEqual([]);
  });

  it("has no route on the known-growth list that has stopped growing", () => {
    const fixed = [...KNOWN_GROWTH].filter((k) => !(measured[k] > small[k]));
    expect(fixed, "remove it from KNOWN_GROWTH").toEqual([]);
  });

  it("stays within its budget", () => {
    if (update) return;
    const over = Object.keys(measured).filter((k) => k in budget && measured[k] > budget[k]);
    expect(over.map((k) => `${k}: ${measured[k]}, budget ${budget[k]}`)).toEqual([]);
  });

  it("has a budget for every route", () => {
    if (update) return;
    const missing = Object.keys(measured).filter((k) => !(k in budget));
    expect(missing, "run UPDATE_BUDGET=1 npx vitest run test/api/statements.test.ts and commit statement-budget.json").toEqual([]);
  });
});
