// One answer to "where is this person?", for every feature that needs a day or a clock time.
import { isValidZone } from "./calendar/dates";

/** The zone the person chose in the calendar settings, else the one their browser last reported, else UTC. */
export function pickZone(saved: string | null | undefined, detected: string | null | undefined): string {
  for (const z of [saved, detected]) if (z && isValidZone(z)) return z;
  return "UTC";
}

/** A zone name from a request header or body: kept only when Intl knows it. */
export function cleanZone(raw: unknown): string {
  return typeof raw === "string" && raw.length <= 64 && isValidZone(raw.trim()) ? raw.trim() : "";
}

export async function userTimezone(db: Db, userId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT u.detected_timezone AS detected, cs.timezone AS saved FROM users u LEFT JOIN calendar_settings cs ON cs.user_id = u.id WHERE u.id = ?`)
    .bind(userId)
    .first<{ detected: string | null; saved: string | null }>()
    .catch(() => null);
  return pickZone(row?.saved, row?.detected);
}
