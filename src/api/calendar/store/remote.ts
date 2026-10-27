import type { AccountRow } from "../../db";
import { logSync } from "../../db";
import type { Env } from "../../env";
import type { CalendarRow } from "../types";

/**
 * Google's own words for why it would not take an edit, in a form worth putting in front of
 * someone. The API buries the useful part in a JSON envelope; the reason code is the bit that
 * actually distinguishes "this kind of event cannot be moved" from "you may not write here".
 */
export function googleRefusal(e: unknown): string {
  const raw = (e as Error)?.message ?? String(e);
  const reason = /"reason":\s*"([^"]+)"/.exec(raw)?.[1] ?? "";
  const said = /"message":\s*"([^"]+)"/.exec(raw)?.[1] ?? "";
  if (reason === "eventTypeRestriction") return "Google won't move this kind of event — birthdays, holidays and working-location entries are fixed where they are.";
  if (reason === "forbiddenForServiceAccounts" || /readonly|forbidden/i.test(reason)) return "That calendar is read-only, so the change couldn't be saved to Google.";
  if (/^4\d\d/.test(raw) && said) return `Google wouldn't accept this change: ${said}`;
  return "Couldn't save this change to Google, so it has been put back.";
}

/**
 * Mirror a local write to Google. Best-effort by design: the database row is already committed, so a
 * remote failure is logged and swallowed rather than allowed to lose the user's edit.
 */
export async function mirrorGoogle<T>(env: Env, cal: CalendarRow, what: string, fn: (account: AccountRow) => Promise<T>): Promise<T | null> {
  if (cal.source !== "google") return null;
  try {
    const account = cal.account_id
      ? await env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).bind(cal.account_id).first<AccountRow>()
      : null;
    if (!account) throw new Error("no_account");
    return await fn(account);
  } catch (e) {
    await logSync(env.DB, cal.account_id, "error", `calendar ${what} (${cal.name || cal.id}): ${(e as Error)?.message ?? String(e)}`);
    return null;
  }
}
