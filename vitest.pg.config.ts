import { defineConfig } from "vitest/config";

// The Postgres tests, and the tests of the Node-only code (src/node), run in plain Node, not in workerd. The Postgres ones use a real database (PG_TEST_URL) and check the translator, the gateway and the whole server.
export default defineConfig({
  test: { include: ["test/pg/**/*.test.ts", "test/node/**/*.test.ts"], environment: "node", fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
