import { Hono } from "hono";
import { getSettings, putSettings, toSettings, type SettingsPatch } from "../../calendar/store";
import type { AppEnv } from "../../env";
import { body, int } from "./input";

const settings = new Hono<AppEnv>();

/* ---------- settings ---------- */

settings.get("/settings", async (c) => c.json(toSettings(await getSettings(c.env.DB, c.get("user").id))));

settings.put("/settings", async (c) => {
  const userId = c.get("user").id;
  const b = await body<{
    timezone: string;
    week_start: number;
    night_start: number;
    night_end: number;
    collapse_night: boolean;
    time_format: string;
    default_view: string;
    show_declined: boolean;
    cover_art: boolean;
  }>(c);
  const patch: SettingsPatch = {};
  if (typeof b.timezone === "string") patch.timezone = b.timezone.trim().slice(0, 80);
  if (b.week_start !== undefined) patch.week_start = int(b.week_start, 0, 6, 1);
  if (b.night_start !== undefined) patch.night_start = int(b.night_start, 0, 23, 22);
  if (b.night_end !== undefined) patch.night_end = int(b.night_end, 0, 23, 6);
  if (typeof b.collapse_night === "boolean") patch.collapse_night = b.collapse_night;
  if (typeof b.time_format === "string") {
    if (b.time_format !== "12" && b.time_format !== "24") return c.json({ error: "bad_time_format" }, 400);
    patch.time_format = b.time_format;
  }
  if (typeof b.default_view === "string") {
    if (!["days", "week", "month", "year", "agenda"].includes(b.default_view)) return c.json({ error: "bad_view" }, 400);
    patch.default_view = b.default_view;
  }
  if (typeof b.show_declined === "boolean") patch.show_declined = b.show_declined;
  if (typeof b.cover_art === "boolean") patch.cover_art = b.cover_art;
  return c.json(toSettings(await putSettings(c.env.DB, userId, patch)));
});

export default settings;
