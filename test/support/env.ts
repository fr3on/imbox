import type { Env } from "../../src/api/env";
import { createTestDatabase, dbFor, lazyDb } from "./pgenv";

// One database for this test file, made as the file loads.
const made = createTestDatabase();
made.catch(() => {});

export const pool = () => made.then((d) => d.pool);

export const testEnv: Env = {
  DB: lazyDb(made.then((d) => dbFor(d.pool))),
  ASSETS: { fetch: async () => new Response("assets") } as unknown as Fetcher,
  APP_NAME: "inbox",
  SESSION_SECRET: "test-session-secret",
};
