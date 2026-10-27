// Where the API code runs: in this process, as plain Node.js. The bundle (node-dist/api.js) is built by scripts/build-node.mjs from src/api.
// It is handed the same kind of environment the code was written for: bindings from the environment variables, a database executor, and a way to get the
// built web files. It hands back three things: fetch(url, init), scheduled(), dispose().

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** A `Fetcher` (what `env.ASSETS` is in the code) made from a function that answers a Request. */
const fetcherOf = (handle) => ({ fetch: (input, init) => handle(input instanceof Request && !init ? input : new Request(input, init)) });

export async function createApiHost({ nodeDir, bindings, executor, staticResponse, events }) {
  const file = path.join(nodeDir, "api.js");
  if (!fs.existsSync(file)) throw new Error(`No Node bundle in ${nodeDir}. Run: npm run build:node`);
  const api = (await import(pathToFileURL(file).href)).default;
  // The database executor is in this process, so the API hands statements to it directly.
  const env = { ...bindings, PG: { execute: executor }, ...(events ? { EVENTS: events } : {}), ASSETS: fetcherOf((request) => staticResponse(new URL(request.url).pathname, request.method)) };
  // What a request hands to waitUntil keeps running after the answer. Remember it, so closing the server can wait for it.
  const background = new Set();
  const context = (own) => ({
    waitUntil(p) {
      const tracked = Promise.resolve(p).catch((e) => console.error("background work failed:", e?.message ?? e));
      background.add(tracked);
      own?.push(tracked);
      tracked.finally(() => background.delete(tracked));
    },
    passThroughOnException() {},
  });
  return {
    fetch: (url, init) => api.fetch(new Request(url, init), env, context()),
    scheduled: async () => {
      const mine = [];
      api.scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, env, context(mine));
      await Promise.allSettled(mine);
    },
    dispose: async () => {
      await Promise.race([Promise.allSettled([...background]), new Promise((r) => setTimeout(r, 5000))]);
    },
  };
}
