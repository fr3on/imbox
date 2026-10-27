// Meeting invitations that arrive by email. When a message carries an iCalendar part, its events go
// into the calendar of the mailbox that received it, linked back to the thread, so a mailbox's
// calendar shows the meetings that mailbox was invited to without anyone adding them by hand.

import type { Env } from "../env";
import type { AccountRow } from "../db";
import type { ParsedAttachment } from "../mime";
import { logSync } from "../db";
import { parseIcs } from "./ical";
import { mailboxCalendar } from "./mailbox";
import { upsertIcsEvents } from "./sources";

/** An invitation is a small file; anything bigger is not one. */
const MAX_INVITE_BYTES = 512 * 1024;

export function isCalendarPart(a: Pick<ParsedAttachment, "mimeType" | "filename">): boolean {
  const type = (a.mimeType ?? "").toLowerCase();
  return type.startsWith("text/calendar") || type === "application/ics" || /\.ics$/i.test(a.filename ?? "");
}

/** The iTIP method (REQUEST, CANCEL, REPLY, PUBLISH…) of an iCalendar body, upper-cased. Empty when it has none. */
export function icsMethod(text: string): string {
  return (/^METHOD:\s*([A-Za-z-]+)/m.exec(text)?.[1] ?? "").toUpperCase();
}

/**
 * Put the events of one iCalendar body into the receiving mailbox's calendar.
 * REQUEST/PUBLISH/none add or update; CANCEL removes; REPLY (someone else's answer to an invitation
 * we sent) and anything unknown is ignored. Returns how many events were touched.
 */
export async function ingestInvite(env: Env, account: AccountRow, text: string, link: { threadId?: string; messageId?: string }): Promise<number> {
  if (!/BEGIN:VCALENDAR/i.test(text)) return 0;
  const method = icsMethod(text);
  if (method && !["REQUEST", "PUBLISH", "CANCEL", "ADD", "UPDATE"].includes(method)) return 0;
  const cal = await mailboxCalendar(env.DB, account);
  if (!cal) return 0;
  const { events } = parseIcs(text);
  if (!events.length) return 0;
  if (method === "CANCEL") {
    for (const ev of events) ev.status = "cancelled";
  }
  const n = await upsertIcsEvents(env, cal, events, link);
  if (n) await logSync(env.DB, account.id, "info", `Updated ${n} calendar event${n === 1 ? "" : "s"} from an invitation`);
  return n;
}

/** Look through a delivered message's attachments for invitations. Never throws: mail matters more than the calendar. */
export async function ingestInvitesFrom(env: Env, account: AccountRow, attachments: ParsedAttachment[], link: { threadId?: string; messageId?: string }): Promise<number> {
  let n = 0;
  for (const a of attachments) {
    if (!isCalendarPart(a) || !a.blob || a.blob.byteLength > MAX_INVITE_BYTES) continue;
    try {
      n += await ingestInvite(env, account, new TextDecoder().decode(a.blob), link);
    } catch (e) {
      console.error("invitation ingest failed", account.email, e);
    }
  }
  return n;
}
