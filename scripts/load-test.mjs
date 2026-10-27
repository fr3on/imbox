#!/usr/bin/env node
// Measures how a running server answers the app's main requests while many people use it at once. Needs a database filled by scripts/seed-load.mjs.
//   BASE=http://127.0.0.1:8787 TOKEN=<session token> node scripts/load-test.mjs
//   CONCURRENCY=20 DURATION=15 node scripts/load-test.mjs            (heavier or longer)
//   ONLY=search node scripts/load-test.mjs                          (scenarios whose name contains this)
// For each scenario it prints the requests per second and the 50th, 95th and 99th percentile times, so two runs can be compared.
// With a TOKENS file (the JSON that seed-load.mjs printed) every virtual user signs in as one of the users in it.
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const DURATION = Number(process.env.DURATION ?? 10);
const ONLY = process.env.ONLY ?? "";
const tokens = process.env.TOKENS ? JSON.parse(fs.readFileSync(process.env.TOKENS, "utf8")).tokens.map((t) => t.token) : [process.env.TOKEN].filter(Boolean);
if (!tokens.length) {
  console.error("Set TOKEN (a session id) or TOKENS (the JSON file seed-load.mjs printed)");
  process.exit(1);
}
const user = tokens[0].length ? await (await fetch(`${BASE}/api/threads?bucket=imbox`, { headers: { authorization: `Bearer ${tokens[0]}` } })).json() : null;
const firstThread = user?.threads?.[0]?.id;

// What a person does in the app: opening it fetches the first group; the rest are what they do next.
const SCENARIOS = {
  "open the app": ["/api/me", "/api/counts", "/api/imbox", "/api/changes"],
  "imbox list": ["/api/threads?bucket=imbox"],
  "imbox, deep page": ["/api/threads?bucket=imbox&page=20"],
  "updates list": ["/api/threads?bucket=paper_trail"],
  "feed": ["/api/feed"],
  "screener": ["/api/screener"],
  "contacts": ["/api/contacts"],
  "contacts search": ["/api/contacts?q=sender12"],
  "open a thread": () => [`/api/threads/${firstThread}`],
  "search, common word": ["/api/search?q=plan"],
  "search, rare word": ["/api/search?q=Zanzibar"],
  "poll for changes": ["/api/changes"],
};

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] : 0;
}

async function run(name, paths) {
  const times = [];
  let errors = 0;
  let bytes = 0;
  const end = Date.now() + DURATION * 1000;
  const worker = async (i) => {
    const token = tokens[i % tokens.length];
    while (Date.now() < end) {
      for (const p of typeof paths === "function" ? paths() : paths) {
        const t = performance.now();
        try {
          const res = await fetch(`${BASE}${p}`, { headers: { authorization: `Bearer ${token}` } });
          bytes += (await res.arrayBuffer()).byteLength;
          if (!res.ok) errors++;
        } catch {
          errors++;
        }
        times.push(performance.now() - t);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  times.sort((a, b) => a - b);
  const ms = (n) => n.toFixed(0).padStart(6);
  console.log(`${name.padEnd(22)} ${String(times.length).padStart(6)} req  ${(times.length / DURATION).toFixed(1).padStart(7)}/s  p50${ms(percentile(times, 50))}  p95${ms(percentile(times, 95))}  p99${ms(percentile(times, 99))} ms  ${(bytes / times.length / 1024).toFixed(0).padStart(5)} KB/req  errors ${errors}`);
}

console.log(`${BASE}  ${CONCURRENCY} at once, ${DURATION} s each, ${tokens.length} user(s)\n`);
for (const [name, paths] of Object.entries(SCENARIOS)) if (name.includes(ONLY)) await run(name, paths);
