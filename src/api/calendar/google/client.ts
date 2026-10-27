import type { AccountRow } from "../../db";
import type { Env } from "../../env";
import { GmailError, googleFetch, hasCalendarScope } from "../../google";
import type { CalendarRow } from "../types";
import { API } from "./types";

/** Fail before making a doomed request when the refresh token never carried the Calendar scope. */
export function requireScope(account: AccountRow): void {
  if (!hasCalendarScope(account.scopes)) {
    throw new GmailError(
      403,
      "calendar_scope_missing",
      `${account.email} is not connected to Google Calendar. Reconnect the account to grant calendar access.`
    );
  }
}

/** The Google calendarId this row points at. */
export function remoteCalendarId(cal: CalendarRow): string {
  if (cal.source !== "google" || !cal.remote_id) {
    throw new GmailError(400, "not_a_google_calendar", `Calendar ${cal.id} is not a Google calendar`);
  }
  return cal.remote_id;
}

export function eventsUrl(cal: CalendarRow, suffix = ""): string {
  return `${API}/calendars/${encodeURIComponent(remoteCalendarId(cal))}/events${suffix}`;
}

/** An authed Calendar request that turns any non-2xx into a GmailError, naming a missing scope. */
export async function calJson<T = any>(env: Env, account: AccountRow, url: string, init: RequestInit = {}): Promise<T> {
  const res = await googleFetch(env, account, url, init);
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE|forbidden/i.test(text)) {
      throw new GmailError(
        403,
        "calendar_scope_missing",
        `Google refused calendar access for ${account.email}: the account is missing the Calendar scope. Reconnect it to grant access.`
      );
    }
    throw new GmailError(res.status, text);
  }
  return (text ? JSON.parse(text) : {}) as T;
}
