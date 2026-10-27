import { Hono } from "hono";
import type { AppEnv } from "../env";
import { listNotifications, markSeen, seenAt } from "../notifications";

const notifications = new Hono<AppEnv>();

/** What is worth knowing, newest first, and how many of it is newer than the last look. */
notifications.get("/", async (c) => {
  const user = c.get("user");
  const [items, seen] = await Promise.all([listNotifications(c.env.DB, user.id), seenAt(c.env.DB, user.id)]);
  return c.json({ items, seen_at: seen, unread: items.filter((i) => i.at > seen).length });
});

/** "I have looked": everything up to now stops counting as new. */
notifications.post("/seen", async (c) => {
  const seen = await markSeen(c.env.DB, c.get("user").id);
  return c.json({ ok: true, seen_at: seen });
});

export default notifications;
