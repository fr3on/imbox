import { Hono } from "hono";
import type { AppEnv } from "../../env";
import events, { agendaItem } from "./events";
import feeds from "./feeds";
import calendars, { asCalendars, calendarPayload, sourcesPayload } from "./calendars";
import days, { blobBytes, COVER_LIMIT, COVER_TYPES } from "./days";
import settings from "./settings";

const calendar = new Hono<AppEnv>();

calendar.route("/", events);
calendar.route("/", feeds);
calendar.route("/", calendars);
calendar.route("/", days);
calendar.route("/", settings);

export {
  HEX,
  MAX_SPAN_DAYS,
  BAD_REQUEST,
  str,
  trimmed,
  int,
  ms,
  bool,
  body,
  ctx,
  fail,
  readEventInput,
  scopeFor,
} from "./input";
export type { Scope } from "./input";

export { agendaItem, asCalendars, calendarPayload, sourcesPayload, blobBytes, COVER_LIMIT, COVER_TYPES };

export default calendar;
