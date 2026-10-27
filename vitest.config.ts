import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";

/** The migrations are .sql files that the app imports as text. Vite has no such rule, so add it here. */
const sqlAsText = {
  name: "sql-as-text",
  transform(_code: string, id: string) {
    if (!id.endsWith(".sql")) return null;
    return { code: `export default ${JSON.stringify(fs.readFileSync(id, "utf8"))};`, map: null };
  },
};

// The tests run in plain Node against a real PostgreSQL (see test/support): the API code goes through the same gateway and SQL translation that the
// server uses, so what passes here is what runs. Each test file gets its own database, copied from a template made once in global-setup.ts.
// PG_TEST_URL says where the server is. The tests under test/pg and test/node run apart, with `npm run test:pg`.
export default defineConfig({
  plugins: [sqlAsText],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["test/pg/**", "test/node/**"],
    globalSetup: ["test/support/global-setup.ts"],
    setupFiles: ["test/support/setup-file.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
