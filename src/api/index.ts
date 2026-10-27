import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { requireUser, requireAccount, getSessionUser } from "./auth";
import { originGuard, securityHeaders } from "./security";
import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import eventsRoutes from "./routes/events";
import accountRoutes from "./routes/accounts";
import mailRoutes from "./routes/mail";
import screenerRoutes from "./routes/screener";
import contactRoutes from "./routes/contacts";
import labelRoutes from "./routes/labels";
import collectionRoutes from "./routes/collections";
import clipRoutes from "./routes/clips";
import composeRoutes from "./routes/compose";
import bundleRoutes from "./routes/bundles";
import aiRoutes from "./routes/ai";
import domainRoutes from "./routes/domains";
import stalwartRoutes from "./routes/stalwart";
import systemRoutes from "./routes/system";
import agentsRoutes from "./routes/agents";
import agentApi from "./routes/agent";
import { sanitizeBrand } from "../shared/brand";
import oauthRoutes from "./routes/oauth";
import calendarRoutes from "./routes/calendar";
import avatarRoutes from "./routes/avatar";
import notificationRoutes from "./routes/notifications";
import autoAgentRoutes from "./routes/autoagents";
import workflowRoutes from "./routes/workflows";
import briefRoutes from "./routes/brief";
import digestRoutes from "./routes/digest";
import activityRoutes from "./routes/activity";
import pushRoutes from "./routes/push";
import vacationRoutes from "./routes/vacation";
import searchesRoutes from "./routes/searches";
import { configuredProviders } from "./oauth";
import inboundRoutes from "./routes/inbound";
import { runCron } from "./cron";
import { withDatabase } from "./database";
import { jsonBodyGuard } from "./input";
import { ensureMigrations } from "./migrations";
import { VERSION, COMMIT, BUILT_AT } from "@shared/buildInfo";

export const app = new Hono<AppEnv>();

app.use("*", securityHeaders);
// Cookie-authenticated routes only act on requests from the app's own origin. The agent API takes a bearer key and has no cookie to ride.
app.use("/api/*", originGuard);
app.use("/auth/*", originGuard);

app.onError((err, c) => {
  // A value the database cannot store (a number too large for its column, text that is not valid there): the caller sent something unusable, not the server failing.
  const code = (err as unknown as { code?: unknown }).code;
  if (typeof code === "string" && /^22/.test(code)) return c.json({ error: "invalid_input", message: "A value in the request is not valid." }, 400);
  console.error("Unhandled error", c.req.method, new URL(c.req.url).pathname, err);
  // What went wrong stays in the log. A database or library message sent to the browser tells a stranger how the server is built.
  return c.json({ error: "internal_error", message: "Something went wrong on the server." }, 500);
});

// No route reads a body that is too large, not JSON, or not an object (see input.ts). Sending mail carries attachments and a calendar import is a
// whole file, so those two may be bigger; everything else is small.
app.use("/api/*", jsonBodyGuard(1_000_000, { "/api/send": 40_000_000, "/api/calendar/sources/import": 9_000_000 }));
app.use("/auth/*", jsonBodyGuard(65_536));
app.use("/agent/*", jsonBodyGuard(1_500_000));

app.route("/auth", authRoutes);

const api = new Hono<AppEnv>();

/**
 * Conditional GETs for JSON. The Imbox, counts and lists are polled every minute and mostly have
 * not changed; with an ETag the browser sends `If-None-Match` and an unchanged answer is a 304 with
 * no body. `no-cache` (not `no-store`) is what lets the browser keep the copy it revalidates
 * against. Attachments set their own Cache-Control and are left alone, as is anything that is not
 * JSON — hashing a multi-megabyte file to save nothing would be a poor trade.
 */
api.use("*", async (c, next) => {
  await next();
  if (c.req.method !== "GET" || c.res.status !== 200) return;
  if (!/^application\/json/i.test(c.res.headers.get("content-type") ?? "")) return;
  const body = await c.res.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-1", body);
  const tag = `W/"${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
  const headers = new Headers(c.res.headers);
  headers.set("etag", tag);
  if (!headers.has("cache-control")) headers.set("cache-control", "private, no-cache");
  const match = c.req.header("if-none-match");
  if (match?.split(",").some((m) => m.trim() === tag)) {
    c.res = new Response(null, { status: 304, headers });
    return;
  }
  c.res = new Response(body, { status: 200, headers });
});

// Anonymous GET /api/me -> { user: null, registration_open } (used by the register page)
api.get("/me", async (c, next) => {
  const user = await getSessionUser(c);
  if (user) return next();
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
  const cfg = await configuredProviders(c.env);
  return c.json({ user: null, accounts: [], setup_required: (n?.n ?? 0) === 0, google_configured: cfg.google, microsoft_configured: cfg.microsoft, app_name: sanitizeBrand(c.env.APP_NAME) });
});
// What this deployment is running (used by the update check).
api.get("/version", (c) => c.json({ version: VERSION, commit: COMMIT, built_at: BUILT_AT, latest: null }));
api.use("*", requireUser);

/**
 * "Has any of my mail changed?" in one number: the newest `updated_at` across every thread the
 * user owns. Sync bumps it when mail arrives, every action bumps it when mail moves, so a
 * client that polls this every few seconds and refetches on a change sees what another client
 * did within seconds — without asking for whole lists it already has. One index seek per
 * account (idx_threads_account_updated), cheap enough to ask constantly.
 */
api.get("/changes", async (c) => {
  const db = c.env.DB;
  const accounts = await db.prepare(`SELECT id FROM accounts WHERE user_id = ?`).bind(c.get("user").id).all<{ id: string }>();
  let revision = 0;
  if (accounts.results.length > 0) {
    const rows = await db.batch<{ r: number | null }>(
      accounts.results.map((a) => db.prepare(`SELECT MAX(updated_at) AS r FROM threads WHERE account_id = ?`).bind(a.id))
    );
    for (const row of rows) revision = Math.max(revision, row.results[0]?.r ?? 0);
  }
  return c.json({ revision }, 200, { "cache-control": "private, no-store" });
});

api.route("/me", meRoutes);
api.route("/events", eventsRoutes);
api.route("/accounts", accountRoutes);
api.route("/domains", domainRoutes);
api.route("/stalwart", stalwartRoutes);
api.route("/system", systemRoutes);
api.route("/agents", agentsRoutes);
api.route("/oauth", oauthRoutes);
api.route("/ai", aiRoutes);
api.route("/calendar", calendarRoutes);
api.route("/avatar", avatarRoutes);
api.route("/notifications", notificationRoutes);
api.route("/auto-agents", autoAgentRoutes);
api.route("/workflows", workflowRoutes);
api.route("/brief", briefRoutes);
api.route("/digest", digestRoutes);
api.route("/activity", activityRoutes);
api.route("/push", pushRoutes);
api.route("/vacation", vacationRoutes);
api.route("/searches", searchesRoutes);


const scoped = new Hono<AppEnv>();
for (const p of ["/counts", "/imbox", "/imbox/recent", "/threads", "/threads/*", "/feed", "/search", "/messages/*", "/files", "/screener", "/screener/*", "/contacts", "/contacts/*", "/labels", "/labels/*", "/collections", "/collections/*", "/clips", "/clips/*", "/drafts", "/drafts/*", "/send", "/send/*", "/bundles", "/bundles/*"]) {
  scoped.use(p, requireAccount);
}
scoped.route("/", mailRoutes); // counts, imbox, threads, feed, search, messages/*/attachments, files
scoped.route("/screener", screenerRoutes);
scoped.route("/contacts", contactRoutes);
scoped.route("/labels", labelRoutes);
scoped.route("/collections", collectionRoutes);
scoped.route("/clips", clipRoutes);
scoped.route("/bundles", bundleRoutes);
scoped.route("/", composeRoutes); // drafts, send
api.route("/", scoped);

api.notFound((c) => c.json({ error: "not_found" }, 404));
app.route("/api", api);
app.route("/agent/v1", agentApi);
app.route("/inbound", inboundRoutes);

app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/") || c.req.path.startsWith("/agent/") || c.req.path.startsWith("/inbound/")) return c.json({ error: "not_found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: async (request: Request, rawEnv: Env, ctx: ExecutionContext) => {
    const env = withDatabase(rawEnv);
    const { pathname } = new URL(request.url);
    // Static assets never need the database; everything else gets a migrated schema first (cached after the first call).
    if (pathname.startsWith("/api/") || pathname.startsWith("/auth/") || pathname.startsWith("/agent/") || pathname.startsWith("/inbound/")) {
      try {
        await ensureMigrations(env);
      } catch (e) {
        console.error("migration failed", e);
        return Response.json({ error: "migration_failed", message: "The database could not be prepared. See the server log." }, { status: 500 });
      }
    }
    return app.fetch(request, env, ctx);
  },
  scheduled: (_event: ScheduledEvent, rawEnv: Env, ctx: ExecutionContext) => {
    const env = withDatabase(rawEnv);
    ctx.waitUntil(ensureMigrations(env).then(() => runCron(env)));
  },
};
