import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { now, uid } from "../db";
import { getVapid, sendPush } from "../webpush";
import { cleanTypes, } from "../push";
import { isPrivateHost } from "../netguard";

const push = new Hono<AppEnv>();

/** A person has a few devices. Capped so "send me a test" (one request per device) is a bounded loop. */
const MAX_DEVICES = 20;
const endpointOf = (body: unknown): string => {
  const e = (body as { endpoint?: unknown } | null)?.endpoint;
  return typeof e === "string" && e.length <= 1000 ? e : "";
};

// The key a browser needs to subscribe to this server.
push.get("/key", async (c) => c.json({ key: (await getVapid(c.env)).publicKey }));

const Sub = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(40).max(200), auth: z.string().min(10).max(100) }),
  types: z.record(z.string(), z.boolean()).optional(),
  /** The address of the subscription this one replaces, when the browser swapped it for a new one: its choices carry over and it is forgotten. */
  replaces: z.string().url().max(1000).optional(),
});

// A browser says yes (or says it again, which just refreshes what it wants).
push.post("/subscribe", async (c) => {
  const userId = c.get("user").id;
  const parsed = Sub.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Bad subscription" }, 400);
  const { endpoint, keys, types, replaces } = parsed.data;
  // The server will POST to this address every time mail arrives, so it has to be a push service on the internet, not something on a private network.
  if (isPrivateHost(new URL(endpoint).hostname)) return c.json({ error: "Bad subscription" }, 400);
  const ua = (c.req.header("user-agent") ?? "").slice(0, 200);
  // A browser that rotated its subscription cannot say what the person had chosen (the choices live in the page, not the worker), so they are read from the old one.
  let chosen: unknown = types;
  if (replaces && replaces !== endpoint) {
    const old = await c.env.DB.prepare(`SELECT types_json FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).bind(userId, replaces).first<{ types_json: string }>();
    if (old && types === undefined) chosen = JSON.parse(old.types_json || "{}");
    await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).bind(userId, replaces).run();
  }
  const known = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND endpoint <> ?`).bind(userId, endpoint).first<{ n: number }>();
  if ((known?.n ?? 0) >= MAX_DEVICES) return c.json({ error: "Too many devices" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, types_json, user_agent, created_at, failures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, types_json = excluded.types_json, user_agent = excluded.user_agent, failures = 0`
  )
    .bind(uid(), userId, endpoint, keys.p256dh, keys.auth, JSON.stringify(cleanTypes(chosen)), ua, now())
    .run();
  // Anything from before this moment is history, not news.
  await c.env.DB.prepare(`INSERT INTO push_state (user_id, pushed_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(userId, now()).run();
  return c.json({ ok: true });
});

push.post("/unsubscribe", async (c) => {
  const endpoint = endpointOf(await c.req.json().catch(() => null));
  if (!endpoint) return c.json({ error: "Bad request" }, 400);
  await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).bind(c.get("user").id, endpoint).run();
  return c.json({ ok: true });
});

// Which kinds this device wants.
push.put("/types", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { endpoint?: string; types?: Record<string, boolean> } | null;
  const endpoint = endpointOf(body);
  if (!endpoint) return c.json({ error: "Bad request" }, 400);
  await c.env.DB.prepare(`UPDATE push_subscriptions SET types_json = ? WHERE user_id = ? AND endpoint = ?`).bind(JSON.stringify(cleanTypes(body?.types)), c.get("user").id, endpoint).run();
  return c.json({ ok: true });
});

// Is this device one the server will push to?
push.post("/status", async (c) => {
  const endpoint = endpointOf(await c.req.json().catch(() => null));
  const row = endpoint ? await c.env.DB.prepare(`SELECT 1 AS ok FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).bind(c.get("user").id, endpoint).first() : null;
  return c.json({ subscribed: !!row });
});

// "Send me a test": goes to every device of this person now.
push.post("/test", async (c) => {
  const userId = c.get("user").id;
  const subs = await c.env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`).bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();
  if (!subs.results.length) return c.json({ error: "No device is set up for this yet." }, 400);
  let delivered = 0;
  for (const s of subs.results) {
    const r = await sendPush(c.env, s, { title: "Notifications are on", body: "This one arrived even though you might not have the app open.", link: "/", tag: "push-test", kind: "mail" }, `mailto:${c.get("user").email}`);
    if (r.ok) delivered++;
    if (r.gone) await c.env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(s.endpoint).run();
  }
  return c.json({ delivered, devices: subs.results.length });
});

// Used by the once-a-minute job and the tests; not a route anyone calls.
export default push;
