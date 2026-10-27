// The person's privacy switches, read where the server is about to contact someone outside. Both default to on, as the app always behaved.

import { safeJson } from "./db";
import type { UserSettings } from "@shared/types";

/** The part of a settings column that holds a disabled switch, for SQL that skips those people. */
export const SENDER_PICTURES_OFF = `%"senderPictures":false%`;

/** Whether this mailbox's owner lets the server look up pictures of senders (Gravatar, a sender's site, brand logos). */
export async function senderPicturesOn(db: Db, accountId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT u.settings_json FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ?`).bind(accountId).first<{ settings_json: string }>();
  return safeJson<UserSettings>(row?.settings_json ?? "{}", {}).privacy?.senderPictures !== false;
}
