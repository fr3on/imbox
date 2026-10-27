// Where a mail server hands over mail for a domain mailbox: POST /inbound/mail?to=<recipient>&from=<sender>, the body being the raw message
// (RFC 822), and the header Authorization: Bearer <INBOUND_SECRET>. Without INBOUND_SECRET the endpoint does not exist.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { receiveInbound } from "../inbound";

const routes = new Hono<AppEnv>();

async function matches(given: string, expected: string): Promise<boolean> {
  const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

routes.post("/mail", async (c) => {
  const secret = c.env.INBOUND_SECRET;
  if (!secret) return c.json({ error: "not_found" }, 404);
  const given = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1] ?? "";
  if (!(await matches(given, secret))) return c.json({ error: "unauthorized" }, 401);
  const to = (c.req.query("to") ?? "").trim();
  if (!to.includes("@")) return c.json({ error: "invalid_input", message: "to is the recipient address." }, 400);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > 26 * 1024 * 1024) return c.json({ error: "too_large", message: "Message too large" }, 413);
  const r = await receiveInbound(c.env, { from: (c.req.query("from") ?? "").trim(), to, raw: await c.req.arrayBuffer() });
  return r.status === 202 ? c.json({ ok: true, stored: r.stored }, 202) : c.json({ error: "rejected", message: r.error }, r.status);
});

export default routes;
