import { decryptSecret } from "./ai/crypto";
import { now } from "./db";
import type { Env } from "./env";
import { Budget, UNLIMITED } from "./jobs";
import { getSessionSecret } from "./secrets";
import { listUsers, StalwartError } from "./stalwart";

/** How often each server is checked. The cron ticks every minute; this is not worth a request per tick. */
const CHECK_EVERY_MS = 10 * 60_000;

interface DueServer {
  id: string;
  base_url: string;
  api_key_enc: string;
}

/**
 * Keep inbox's view of each Stalwart server honest.
 *
 * A mailbox that was provisioned from Stalwart but has since been deleted there can never log in again,
 * so it is marked disconnected (the cron's IMAP pass skips those) with a reason the UI can show.
 * Accounts that exist on the server but are not connected here are left alone: connecting one means
 * resetting its password, which must be a person's decision, never a background job's.
 */
export async function reconcileStalwart(env: Env, budget: Budget = UNLIMITED): Promise<void> {
  const cutoff = now() - CHECK_EVERY_MS;
  const due = await env.DB.prepare(
    `SELECT id, base_url, api_key_enc FROM stalwart_servers WHERE COALESCE(last_checked_at, 0) < ? ORDER BY COALESCE(last_checked_at, 0) ASC LIMIT 4`
  )
    .bind(cutoff)
    .all<DueServer>();

  for (const s of due.results) {
    if (budget.spent) break;
    try {
      const apiKey = await decryptSecret(await getSessionSecret(env), s.api_key_enc);
      const users = await listUsers({ baseUrl: s.base_url, apiKey });
      const present = new Set(users.map((u) => u.id));
      const linked = await env.DB.prepare(`SELECT account_id, stalwart_account_id FROM imap_accounts WHERE stalwart_server_id = ?`)
        .bind(s.id)
        .all<{ account_id: string; stalwart_account_id: string }>();
      for (const l of linked.results) {
        if (present.has(l.stalwart_account_id)) continue;
        await env.DB.prepare(`UPDATE accounts SET sync_status = 'disconnected', sync_error = ? WHERE id = ? AND sync_status <> 'disconnected'`)
          .bind("This mailbox no longer exists on the Stalwart server.", l.account_id)
          .run();
      }
      await env.DB.prepare(`UPDATE stalwart_servers SET last_checked_at = ?, last_error = NULL WHERE id = ?`).bind(now(), s.id).run();
    } catch (e) {
      const msg = e instanceof StalwartError ? e.message : (e as Error).message?.slice(0, 200) ?? "unknown error";
      // Stamp the time even on failure so a dead server is retried on schedule, not every minute.
      await env.DB.prepare(`UPDATE stalwart_servers SET last_checked_at = ?, last_error = ? WHERE id = ?`).bind(now(), msg, s.id).run();
    }
  }
}
