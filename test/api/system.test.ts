import { beforeAll, describe, expect, it } from "vitest";
import { call, json, migrate, signIn, wipeAll } from "../api-harness";

beforeAll(migrate);

describe("GET /api/system", () => {
  it("tells a signed-in owner what the server is and how busy it is", async () => {
    await wipeAll();
    const token = await signIn("sys");
    const res = await call("GET", "/api/system", { token });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const s = await json(res);
    expect(s.app.version).toMatch(/\d/);
    expect(s.host.cpu_cores).toBeGreaterThan(0);
    expect(s.host.cpu_percent).toBeGreaterThanOrEqual(0);
    expect(s.host.cpu_percent).toBeLessThanOrEqual(100);
    expect(s.host.memory_total).toBeGreaterThan(s.host.memory_used);
    expect(s.host.load).toHaveLength(3);
    expect(s.database.version).toMatch(/^\d+/);
    expect(s.database.bytes).toBeGreaterThan(0);
    expect(s.database.tables.length).toBeGreaterThan(0);
    expect(s.database.tables[0]).toEqual({ name: expect.any(String), bytes: expect.any(Number), rows: expect.any(Number) });
  });

  it("is not shown to someone who is not signed in", async () => {
    expect((await call("GET", "/api/system")).status).toBe(401);
  });
});
