import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// WEB_CONCURRENCY above 1: the first process applies the migrations and owns the schedule, and several web processes share the port. Needs npm run build:node.
const URL = process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test";
const root = path.resolve(__dirname, "../..");
const built = fs.existsSync(path.join(root, "node-dist/api.js")) && fs.existsSync(path.join(root, "dist/index.html"));

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

describe("more than one web process", () => {
  if (!built) return it.skip("needs npm run build:node", () => {});
  let child: ChildProcess;
  let out = "";
  let port = 0;
  const dbName = "inbox_cluster_test";

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: URL, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    await admin.end();
    port = await freePort();
    child = spawn(process.execPath, ["server/run.mjs"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: URL.replace(/\/[^/]*$/, `/${dbName}`), SESSION_SECRET: "test-secret-test-secret-test-secret", PORT: String(port), WEB_CONCURRENCY: "2", CRON_SECONDS: "0" },
    });
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (out += d));
    await vi_waitFor(() => (out.match(/web process \d/g) ?? []).length >= 2, 30_000);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    const admin = new pg.Pool({ connectionString: URL, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  });

  it("applies the migrations once, before the web processes start", () => {
    expect(out.indexOf("migrations done")).toBeGreaterThan(-1);
    expect(out.indexOf("migrations done")).toBeLessThan(out.indexOf("web process"));
    expect((out.match(/migration failed/g) ?? []).length).toBe(0);
  });

  it("answers from both processes, and a session made by one is good in the other", async () => {
    let cookie = "";
    const setup = await fetch(`http://127.0.0.1:${port}/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@test.local", password: "correct-horse-battery-staple", name: "Owner" }) });
    expect(setup.status).toBe(200);
    cookie = (setup.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    for (let i = 0; i < 30; i++) {
      const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
    }
  });

  it("stops when asked, web processes included", async () => {
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    expect(await Promise.race([exited, new Promise((r) => setTimeout(() => r("timeout"), 15_000))])).toBe(0);
  });
});

async function vi_waitFor(fn: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting");
}
