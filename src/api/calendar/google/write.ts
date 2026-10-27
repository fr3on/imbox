import type { AccountRow } from "../../db";
import type { Env } from "../../env";
import { GmailError, googleFetch } from "../../google";
import type { CalendarRow, EventRow } from "../types";
import { type GEvent, RSVP_VALUES } from "./types";
import { requireScope, eventsUrl, calJson } from "./client";
import { eventBody, sendUpdates } from "./map";

export async function createRemoteEvent(
  env: Env,
  cal: CalendarRow,
  account: AccountRow,
  row: EventRow
): Promise<{ remote_id: string; etag: string | null }> {
  requireScope(account);
  const u = new URL(eventsUrl(cal));
  u.searchParams.set("sendUpdates", sendUpdates(row));
  const j = await calJson<GEvent>(env, account, u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(eventBody(row)),
  });
  if (!j.id) throw new GmailError(500, JSON.stringify(j).slice(0, 300), "Google created the event but returned no id");
  return { remote_id: j.id, etag: j.etag ?? null };
}

export async function updateRemoteEvent(env: Env, cal: CalendarRow, account: AccountRow, row: EventRow): Promise<{ etag: string | null }> {
  requireScope(account);
  if (!row.remote_id) throw new GmailError(400, "no_remote_id", "Event has no Google id to update");
  const u = new URL(eventsUrl(cal, `/${encodeURIComponent(row.remote_id)}`));
  u.searchParams.set("sendUpdates", sendUpdates(row));
  // PATCH, not PUT. A PUT replaces the whole event with what we send, and we do not model all of
  // it: `eventType` is the one that bites, because a birthday, holiday, out-of-office or
  // Gmail-derived event silently becomes `default` and Google rejects the lot with
  // "Event type cannot be changed" — after which the next sync pulls the unchanged event back and
  // the edit appears to undo itself. Omitting `recurrence` on a master would likewise have dropped
  // the repeat. PATCH touches only the fields named here and leaves the rest of the event alone.
  const j = await calJson<GEvent>(env, account, u.toString(), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(eventBody(row)),
  });
  return { etag: j.etag ?? null };
}

export async function deleteRemoteEvent(env: Env, cal: CalendarRow, account: AccountRow, remoteId: string): Promise<void> {
  requireScope(account);
  if (!remoteId) return;
  const u = new URL(eventsUrl(cal, `/${encodeURIComponent(remoteId)}`));
  u.searchParams.set("sendUpdates", "all");
  const res = await googleFetch(env, account, u.toString(), { method: "DELETE" });
  // Already gone is the outcome we wanted.
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new GmailError(res.status, await res.text());
}

/** Patch our own attendee entry's responseStatus, and send the update to the organizer. */
export async function setRemoteRsvp(env: Env, cal: CalendarRow, account: AccountRow, remoteId: string, rsvp: string): Promise<void> {
  requireScope(account);
  if (!remoteId) throw new GmailError(400, "no_remote_id", "Event has no Google id to RSVP to");
  if (!RSVP_VALUES.has(rsvp)) throw new GmailError(400, "bad_rsvp", `Unknown RSVP "${rsvp}"`);

  const base = eventsUrl(cal, `/${encodeURIComponent(remoteId)}`);
  const current = await calJson<GEvent>(env, account, base);
  const attendees = current.attendees ?? [];
  const mine = attendees.find((a) => a.self) ?? attendees.find((a) => (a.email ?? "").toLowerCase() === account.email.toLowerCase());
  if (!mine) throw new GmailError(400, "not_an_attendee", `${account.email} is not an attendee of this event`);

  // A patch replaces the whole attendee list, so send it back intact with just our entry changed.
  const patched = attendees.map((a) => ({
    email: a.email,
    ...(a.displayName ? { displayName: a.displayName } : {}),
    ...(a.optional ? { optional: true } : {}),
    ...(a.organizer ? { organizer: true } : {}),
    ...(a.resource ? { resource: true } : {}),
    ...(a.self ? { self: true } : {}),
    responseStatus: a === mine ? rsvp : a.responseStatus ?? "needsAction",
  }));

  const u = new URL(base);
  u.searchParams.set("sendUpdates", "all");
  await calJson(env, account, u.toString(), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attendees: patched }),
  });
}
