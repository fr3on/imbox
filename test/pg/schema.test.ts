import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migratedPool, renderSchema } from "../../scripts/gen-schema.mjs";

describe("src/api/schema.ts", () => {
  it("matches the migrations (run `npm run gen:schema` if this fails)", async () => {
    const pool = await migratedPool(process.env.PG_TEST_URL ?? "postgres://inbox@localhost:54329/inbox_test", path.resolve(__dirname, "../../migrations"));
    try {
      const have = fs.readFileSync(path.resolve(__dirname, "../../src/api/schema.ts"), "utf8");
      expect(have).toBe(await renderSchema(pool));
    } finally {
      await pool.end();
    }
  });
});
