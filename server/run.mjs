// Runs Imbox on your own server. One Node process that:
//   - runs the API (the code in src/api, built by npm run build:node) in this process;
//   - owns the Postgres connection pool, and answers the API's database calls (see server/pggateway.mjs);
//   - serves the built web app's static files;
//   - fires the once-a-minute job (mail sync, scheduled sends).
// Put a TLS proxy (Caddy) in front of it. Configuration is all environment variables; see imbox-website/docs/content/docs/self-hosting.mdx.

import fs from "node:fs";
import cluster from "node:cluster";
import zlib from "node:zlib";
import { promisify } from "node:util";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createExecutor } from "./pggateway.mjs";
import { clientAddress, headersFor, parseHeadersFile, STRIPPED_REQUEST_HEADERS } from "./frontdoor.mjs";
import { createApiHost } from "./host.mjs";
import { createChangeBus } from "./changes.mjs";
import { installEgressGuard } from "./egress.mjs";

const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);
/** Replies smaller than this are not worth the work of compressing. */
const COMPRESS_FROM = 1024;

/** The reply body, compressed when the caller accepts it and it is JSON (the lists are mostly repeated field names, and shrink to a tenth). */
async function compressed(buf, type, accept) {
  if (buf.length < COMPRESS_FROM || !/^application\/json/i.test(type ?? "")) return null;
  if (/\bbr\b/.test(accept)) return { encoding: "br", body: await brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }) };
  if (/\bgzip\b/.test(accept)) return { encoding: "gzip", body: await gzip(buf, { level: 5 }) };
  return null;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MAX_BODY = 40 * 1024 * 1024;

/** Everything read from the environment, so a test can hand in its own. */
export function configFromEnv(env = process.env) {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "127.0.0.1",
    nodeDir: path.resolve(root, env.NODE_DIR ?? "node-dist"),
    staticDir: path.resolve(root, env.STATIC_DIR ?? "dist"),
    cronSeconds: Number(env.CRON_SECONDS ?? 60),
    // How many processes answer requests. 1 (the default) is one process that does everything; more than 1 starts that many web processes and one more that
    // owns the database migrations and the once-a-minute job.
    workers: Math.max(1, Math.floor(Number(env.WEB_CONCURRENCY ?? 1)) || 1),
    databaseUrl: env.DATABASE_URL,
    // Where the server listens for changes (see /api/events). Only needed when DATABASE_URL goes through a pooler in transaction mode, which cannot LISTEN.
    listenUrl: env.LISTEN_DATABASE_URL,
    poolMax: Number(env.PG_POOL_MAX ?? 10),
    // A query that runs longer than this is stopped, and a request that cannot get a connection within the wait gives up, so one slow query
    // cannot hold every connection and make the whole app wait. Set either to 0 to turn it off.
    statementTimeoutMs: Number(env.PG_STATEMENT_TIMEOUT_MS ?? 20_000),
    connectWaitMs: Number(env.PG_CONNECT_WAIT_MS ?? 10_000),
    vars: Object.fromEntries(PASS_THROUGH.filter((k) => env[k]).map((k) => [k, env[k]])),
  };
}

/** The settings the API reads from its environment. Anything else set on the host is left out of it. */
const PASS_THROUGH = ["APP_URL", "APP_NAME", "SESSION_SECRET", "INBOUND_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "RESEND_API_KEY"];

export async function start(cfg) {
const PORT = cfg.port;
const HOST = cfg.host;
const NODE_DIR = cfg.nodeDir;
const STATIC_DIR = cfg.staticDir;
const CRON_SECONDS = cfg.cron === false ? 0 : cfg.cronSeconds;
const LISTEN = cfg.listen !== false;
installEgressGuard();
if (!cfg.databaseUrl) throw new Error("DATABASE_URL is not set (for example postgres://inbox:password@localhost:5432/inbox)");

const bindings = { ...cfg.vars };
bindings.APP_NAME ??= "imbox";

const pool = new pg.Pool({
  connectionString: cfg.databaseUrl,
  max: cfg.poolMax,
  idleTimeoutMillis: 30_000,
  ...(cfg.statementTimeoutMs > 0 ? { statement_timeout: cfg.statementTimeoutMs } : {}),
  ...(cfg.connectWaitMs > 0 ? { connectionTimeoutMillis: cfg.connectWaitMs } : {}),
});
pool.on("error", (e) => console.error("postgres pool:", e.message));
// Requests queued for a connection are the sign of a slow query holding them. Say so in the log, at most every ten seconds.
setInterval(() => {
  if (pool.waitingCount > 0) console.warn(`postgres pool: ${pool.waitingCount} request(s) waiting, ${pool.totalCount - pool.idleCount} of ${cfg.poolMax} connections busy`);
}, 10_000).unref();
const executor = createExecutor(pool);

/* ---------- static files ---------- */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".sh": "text/plain; charset=utf-8", ".map": "application/json",
  ".zip": "application/zip", ".dmg": "application/x-apple-diskimage",
  ".exe": "application/vnd.microsoft.portable-executable", ".deb": "application/vnd.debian.binary-package",
};

// The cache rules and the security headers from public/_headers.
let headerRules = [];
try {
  headerRules = parseHeadersFile(fs.readFileSync(path.join(STATIC_DIR, "_headers"), "utf8"));
} catch {
  /* no _headers file in this build */
}

function fileFor(pathname) {
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(STATIC_DIR, clean);
  if (full !== STATIC_DIR && !full.startsWith(STATIC_DIR + path.sep)) return null;
  try {
    const st = fs.statSync(full);
    if (st.isFile()) return full;
    if (st.isDirectory() && fs.existsSync(path.join(full, "index.html"))) return path.join(full, "index.html");
  } catch {
    /* not a file */
  }
  return null;
}

function staticResponse(pathname, method, spa = true) {
  let file = fileFor(pathname);
  // A path with no file behind it is a page of the single-page app; a missing asset (something with an extension) is a real 404.
  if (!file && spa && !path.extname(pathname)) file = path.join(STATIC_DIR, "index.html");
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const hashed = /[/\\]assets[/\\]/.test(file);
  const headers = { "content-type": type, "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache", ...headersFor(headerRules, pathname) };
  return new Response(method === "HEAD" ? null : fs.readFileSync(file), { headers });
}

/* ---------- the API ---------- */

// Windows are told that their mail changed through this: PostgreSQL notifies (migration 0027), this process listens on a connection of its own, not one
// from the pool. A process that serves no requests (the scheduler of a cluster) has no windows to tell.
const events = createChangeBus({
  connect: async () => {
    const client = new pg.Client({ connectionString: cfg.listenUrl ?? cfg.databaseUrl, keepAlive: true, application_name: "imbox-listener" });
    await client.connect();
    return client;
  },
  // Whether the app syncs the mailboxes by itself every minute (the scheduler, in a cluster, is another process), so a window need not ask it to.
  syncs: cfg.cronSeconds > 0,
});
if (LISTEN) void events.start();
/** Streams that are open (see /api/events), so closing the server can end them. */
const streams = new Set();

const api = await createApiHost({ nodeDir: NODE_DIR, bindings, executor, staticResponse, events });

/* ---------- the front door ---------- */

const WORKER_FIRST = /^\/(api|auth|agent)(\/|$)/;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// A request that takes this long is worth a line in the log: a send that hangs is how a proxy in front ends up answering with its own 502.
const SLOW_MS = 15_000;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on("close", () => {
    const ms = Date.now() - started;
    if (!res.eventStream && (ms >= SLOW_MS || !res.writableFinished)) {
      const path = String(req.url ?? "").split("?")[0];
      console.warn(`${new Date().toISOString()} ${!res.writableFinished ? "request ended before the reply was sent" : "slow request"}: ${req.method} ${path} ${ms} ms (status ${res.statusCode})`);
    }
  });
  try {
    const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0].trim();
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`).split(",")[0].trim();
    const url = new URL(req.url ?? "/", `${proto}://${host}`);

    if (url.pathname === "/healthz") {
      await pool.query("SELECT 1");
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }

    let response;
    if ((req.method === "GET" || req.method === "HEAD") && !WORKER_FIRST.test(url.pathname)) {
      response = staticResponse(url.pathname, req.method);
    } else {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !STRIPPED_REQUEST_HEADERS.includes(k)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      // Hand the API the one address it may count failed logins against. Whatever the caller wrote in these headers is gone.
      headers.set("x-forwarded-for", clientAddress(req));
      response = await api.fetch(url, { method: req.method, headers, body: hasBody ? await readBody(req) : undefined, redirect: "manual" });
    }

    const out = {};
    response.headers.forEach((v, k) => {
      if (k !== "set-cookie") out[k] = v;
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) out["set-cookie"] = cookies;
    delete out["content-encoding"];
    delete out["content-length"];
    if (!response.body || req.method === "HEAD") {
      res.writeHead(response.status, out);
      return void res.end();
    }
    // A stream stays open and is passed on as it comes: not read to the end, and not compressed (the browser would wait for a full block).
    if (/^text\/event-stream/i.test(String(out["content-type"] ?? ""))) return void (await pipeStream(res, response, out));
    const buf = Buffer.from(await response.arrayBuffer());
    const packed = await compressed(buf, out["content-type"], String(req.headers["accept-encoding"] ?? ""));
    if (packed) {
      out["content-encoding"] = packed.encoding;
      out.vary = out.vary ? `${out.vary}, Accept-Encoding` : "Accept-Encoding";
    }
    res.writeHead(response.status, out);
    res.end(packed ? packed.body : buf);
  } catch (e) {
    const status = e?.status ?? 502;
    console.error(`${new Date().toISOString()} request failed: ${req.method} ${String(req.url ?? "").split("?")[0]} -> ${status}: ${String(e?.stack ?? e?.message ?? e).slice(0, 600)}`);
    if (!res.headersSent) res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: status === 413 ? "too_large" : "gateway_error", message: String(e?.message ?? e).slice(0, 200) }));
  }
});

/** Pass a streaming answer (Server-Sent Events) to the client as it is written, until either side is done. */
async function pipeStream(res, response, headers) {
  streams.add(res);
  res.eventStream = true;
  res.socket?.setNoDelay(true);
  res.socket?.setTimeout(0);
  res.writeHead(response.status, headers);
  res.flushHeaders();
  const reader = response.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => {}));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      if (!res.write(value)) {
        await new Promise((resolve) => {
          res.once("drain", resolve);
          res.once("close", resolve);
        });
      }
    }
  } catch {
    /* the client went away, or the stream was cancelled */
  } finally {
    res.end();
    streams.delete(res);
  }
}

/* ---------- the once-a-minute job ---------- */

let running = false;
let runningSince = 0;
let lastSkipLog = 0;
// A run that takes longer than this is worth a line in the log even when it finishes. The API bounds each of its jobs (src/api/jobs.ts), so a run
// this long means something is being waited for that the API could not cut loose.
const SLOW_TICK_MS = 120_000;
async function tick() {
  if (running) {
    // The minute came round while the last run was still going. Say so (at most every five minutes), so a run that is stuck shows up in the log
    // instead of the app simply never syncing again.
    const now = Date.now();
    if (now - lastSkipLog > 300_000) {
      lastSkipLog = now;
      console.warn(`${new Date(now).toISOString()} scheduled run: still going after ${Math.round((now - runningSince) / 1000)} s, skipping this minute`);
    }
    return;
  }
  running = true;
  runningSince = Date.now();
  try {
    await api.scheduled();
  } catch (e) {
    console.error("scheduled run failed:", e?.message ?? e);
  } finally {
    const took = Date.now() - runningSince;
    if (took >= SLOW_TICK_MS) console.warn(`${new Date().toISOString()} scheduled run: took ${Math.round(took / 1000)} s`);
    running = false;
  }
}
const timer = CRON_SECONDS > 0 ? setInterval(tick, CRON_SECONDS * 1000) : null;

if (LISTEN) await new Promise((resolve) => server.listen(PORT, HOST, resolve));
const address = LISTEN ? server.address() : { port: 0 };
if (LISTEN) console.log(`Imbox listening on http://${HOST}:${address.port} (static: ${STATIC_DIR}, cron every ${CRON_SECONDS}s${cluster.isWorker ? `, web process ${cluster.worker.id}` : ""})`);
const firstTick = timer ? setTimeout(tick, 5000) : null;

async function close() {
  if (timer) clearInterval(timer);
  if (firstTick) clearTimeout(firstTick);
  await events.close();
  for (const res of streams) res.destroy();
  if (LISTEN) await new Promise((resolve) => server.close(resolve));
  await api.dispose();
  await pool.end().catch(() => {});
}
return { server, api, pool, port: address.port, close, tick };
}

/**
 * More than one web process (WEB_CONCURRENCY above 1). The first process only prepares and schedules: it applies the migrations once, before any web process
 * starts, and runs the once-a-minute job, so neither is done twice. The web processes share the port and only answer requests. A web process that exits is
 * replaced.
 */
async function startCluster(cfg) {
  const scheduler = await start({ ...cfg, listen: false });
  await scheduler.api.fetch("http://localhost/api/version"); // the first API request applies any migration that is waiting
  console.log(`${new Date().toISOString()} migrations done; starting ${cfg.workers} web processes`);
  let stopping = false;
  const fork = () => cluster.fork();
  for (let i = 0; i < cfg.workers; i++) fork();
  cluster.on("exit", (w, code, signal) => {
    if (stopping) return;
    console.error(`${new Date().toISOString()} web process ${w.id} exited (${signal ?? code}); starting another`);
    setTimeout(fork, 1000);
  });
  return {
    scheduler,
    async close() {
      stopping = true;
      await Promise.all(Object.values(cluster.workers ?? {}).map((w) => new Promise((resolve) => (w.once("exit", resolve), w.process.kill("SIGTERM")))));
      await scheduler.close();
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const cfg = configFromEnv();
    // A web process started by the cluster below runs the server without the job; the one that is not a worker decides how many to start.
    const app = cluster.isWorker ? await start({ ...cfg, cron: false }) : cfg.workers > 1 ? await startCluster(cfg) : await start(cfg);
    const stop = async (signal) => {
      console.log(`${new Date().toISOString()} ${signal}: shutting down`);
      await app.close();
      process.exit(0);
    };
    process.on("SIGTERM", () => stop("SIGTERM"));
    process.on("SIGINT", () => stop("SIGINT"));
    // Say why the process went away. An uncaught exception leaves it in an unknown state, so it is logged and the process exits for the service
    // manager to start it again; a rejected promise nobody handled is logged and the server keeps serving.
    process.on("uncaughtException", (e) => {
      console.error(`${new Date().toISOString()} uncaught exception, exiting: ${e?.stack ?? e}`);
      process.exit(1);
    });
    process.on("unhandledRejection", (e) => {
      console.error(`${new Date().toISOString()} unhandled rejection: ${e?.stack ?? e}`);
    });
    console.log(`${new Date().toISOString()} started, pid ${process.pid}`);
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(1);
  }
}
