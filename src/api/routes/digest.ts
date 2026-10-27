import { Hono } from "hono";
import type { AppEnv } from "../env";
import { dayKey } from "../ai/brief";
import { digestAiEnabled, digestIsStale, digestKey, digestMails, loadDigest, writeDigest } from "../ai/digest";
import { userTimezone } from "../timezone";

const digest = new Hono<AppEnv>();

// Today's Updates digest, as it was last written, and whether new mail has come in since (`stale`; mail read since does not count). Reading it never calls the model; the page asks
// for a fresh one with /refresh when this says it is out of date.
digest.get("/", async (c) => {
  const userId = c.get("user").id;
  const tz = await userTimezone(c.env.DB, userId);
  const day = dayKey(tz);
  const [ai, mails, stored] = await Promise.all([digestAiEnabled(c.env, userId), digestMails(c.env.DB, userId), loadDigest(c.env.DB, userId, day)]);
  const key = digestKey(mails);
  return c.json(
    { digest: mails.length ? stored?.digest ?? null : null, count: mails.length, stale: digestIsStale(stored?.digest, mails), ai_enabled: ai, key },
    200,
    { "cache-control": "private, no-store" },
  );
});

// Write it now (a few seconds). The same mail is not written twice in a row: a digest that is up to date is returned as it is.
digest.post("/refresh", async (c) => {
  const userId = c.get("user").id;
  const tz = await userTimezone(c.env.DB, userId);
  const day = dayKey(tz);
  const body = await c.req.json<{ force?: boolean }>().catch(() => ({}) as { force?: boolean });
  if (!(await digestAiEnabled(c.env, userId))) return c.json({ error: "ai_off" }, 400);
  if (!body.force) {
    const [mails, stored] = await Promise.all([digestMails(c.env.DB, userId), loadDigest(c.env.DB, userId, day)]);
    if (stored && !digestIsStale(stored.digest, mails)) return c.json({ digest: stored.digest, count: mails.length, stale: false, ai_enabled: true, key: stored.key });
  }
  const r = await writeDigest(c.env, userId, day, !!body.force);
  if (!r.ok) return c.json({ error: r.reason === "busy" ? "digest_busy" : "digest_failed" }, r.reason === "busy" ? 429 : 502);
  const mails = await digestMails(c.env.DB, userId);
  return c.json({ digest: r.digest, count: mails.length, stale: digestIsStale(r.digest, mails), ai_enabled: true, key: r.key });
});

export default digest;
