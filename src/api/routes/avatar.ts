import { Hono } from "hono";
import type { AppEnv } from "../env";
import { fetchGravatar, fetchSiteIcon } from "../photos";
import { safeJson } from "../db";
import type { UserSettings } from "@shared/types";

/**
 * Sender pictures, fetched by the server and handed to the browser from your own address. The browser never talks to Gravatar
 * or to the sender's site. Signed-in only (it lives under /api), and cached in the browser for a week.
 */
const avatar = new Hono<AppEnv>();

const reply = (img: { bytes: ArrayBuffer; type: string }) =>
  new Response(img.bytes, { headers: { "content-type": img.type, "cache-control": "private, max-age=604800", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });

// With the switch off the server contacts no one, even for a picture it already knows the address of: the person sees initials.
const allowed = (c: { get: (k: "user") => { settings_json: string } | undefined }) => safeJson<UserSettings>(c.get("user")?.settings_json ?? "{}", {}).privacy?.senderPictures !== false;

avatar.get("/g/:hash", async (c) => {
  if (!allowed(c)) return c.body(null, 404);
  const img = await fetchGravatar(c.req.param("hash").toLowerCase());
  return img ? reply(img) : c.body(null, 404);
});

avatar.get("/d/:domain", async (c) => {
  if (!allowed(c)) return c.body(null, 404);
  const img = await fetchSiteIcon(c.req.param("domain").toLowerCase());
  return img ? reply(img) : c.body(null, 404);
});

export default avatar;
