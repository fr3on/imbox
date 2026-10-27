// The once-a-minute job (the tick in server/run.mjs).
//
// Every piece of it goes through runJob (jobs.ts): its own time budget, a hard deadline, one run at a time, and a log line when it fails or
// runs long. The tick itself is serialised by the host, so the whole of this has to finish, or be walked away from, in a bounded time.

import { sealStoredTokens } from "./secrets";
import type { Env } from "./env";
import type { AccountRow } from "./db";
import { syncAccount, processBubbleUps } from "./sync";
import { processScheduledSends } from "./send";
import { runLearning } from "./ai/memory";
import { dispatchAgentWebhooks } from "./agent";
import { reconcileStalwart } from "./stalwartsync";
import { pushDue } from "./push";
import { autoLetInDue } from "./autoletin-job";
import { autoCalendarDue } from "./ai/autocalendar";
import { vacationDue } from "./vacation";
import { rescueDue } from "./ai/rescue";
import { runAutoAgents } from "./autoagent";
import { runWorkflows } from "./workflows/run";
import { backfillSenderPhotos } from "./photos";
import { runCalendarSync } from "./calendar/sync";
import { MAIL_SCOPE_SQL } from "./google";
import { MS_MAIL_SCOPE_SQL } from "./microsoft";
import { Budget, runJob } from "./jobs";

/** A mailbox pass (one provider, up to eight accounts) may work this long before it stops starting new accounts. */
const MAIL_PASS_BUDGET_MS = 150_000;
/** A tick of the clock that does the hourly cleanup no more than once an hour, even if a tick was missed or two landed in the same minute. */
const CLEANUP_EVERY_MS = 3_600_000;
let lastCleanupAt = 0;

/** For tests. */
export function resetCron() {
  lastCleanupAt = 0;
}

/**
 * Sync each account in turn, stopping before the next one once the budget is spent. An account that is mid-sync from another invocation is
 * skipped (a stale 'syncing' marker of more than ten minutes is taken to be a crash and is retried).
 */
async function syncEach(env: Env, label: string, accounts: AccountRow[], budget: Budget): Promise<void> {
  for (const acc of accounts) {
    if (budget.spent) {
      console.warn(`${label} sync: out of time, the remaining accounts wait for the next minute`);
      break;
    }
    if (acc.sync_status === "syncing" && acc.last_synced_at && Date.now() - acc.last_synced_at < 10 * 60_000) continue;
    try {
      await syncAccount(env, acc, { budget });
    } catch (e) {
      console.error(`${label} sync failed`, acc.email, e);
    }
  }
}

export async function runCron(env: Env): Promise<void> {
  const db = env.DB;
  await runJob("seal-tokens", () => sealStoredTokens(env));
  await runJob("bubble-ups", () => processBubbleUps(db));
  await runJob("scheduled-sends", (b) => processScheduledSends(env, b), { budgetMs: 90_000 });
  await runJob("ai-learning", (b) => runLearning(env, b), { budgetMs: 120_000 });
  await runJob("calendar-sync", (b) => runCalendarSync(env, b), { budgetMs: 120_000 });
  await runJob("sender-photos", (b) => backfillSenderPhotos(env, b));
  await runJob("workflows", (b) => runWorkflows(env, b), { budgetMs: 60_000 });
  await runJob("auto-agents", (b) => runAutoAgents(env, b), { budgetMs: 120_000 });
  await runJob("stalwart-reconcile", (b) => reconcileStalwart(env, b));

  // Accounts connected for calendar only carry no mail scope, so they are not mail accounts to sync.
  // MAIL_SCOPE_SQL mirrors hasMailScope: an empty `scopes` predates the column and does have mail.
  await runJob(
    "gmail-sync",
    async (b) => {
      const accounts = await db
        .prepare(
          `SELECT * FROM accounts WHERE provider = 'gmail' AND sync_status <> 'disconnected' AND refresh_token IS NOT NULL AND ${MAIL_SCOPE_SQL} ORDER BY initial_sync_done ASC, COALESCE(last_synced_at, 0) ASC LIMIT 8`
        )
        .all<AccountRow>();
      await syncEach(env, "gmail", accounts.results, b);
    },
    { budgetMs: MAIL_PASS_BUDGET_MS }
  );

  // Outlook is a separate pass rather than a widened query: MAIL_SCOPE_SQL tests for a Gmail scope,
  // so an Outlook row could never satisfy it.
  await runJob(
    "outlook-sync",
    async (b) => {
      const accounts = await db
        .prepare(
          `SELECT * FROM accounts WHERE provider = 'outlook' AND sync_status <> 'disconnected' AND refresh_token IS NOT NULL AND ${MS_MAIL_SCOPE_SQL} ORDER BY COALESCE(last_synced_at, 0) ASC LIMIT 8`
        )
        .all<AccountRow>();
      await syncEach(env, "outlook", accounts.results, b);
    },
    { budgetMs: MAIL_PASS_BUDGET_MS }
  );

  // IMAP mailboxes get their own pass too: they authenticate with a stored password, so the
  // `refresh_token IS NOT NULL` predicate the OAuth providers rely on would exclude every one.
  await runJob(
    "imap-sync",
    async (b) => {
      const accounts = await db
        .prepare(
          // Mailboxes with nothing to catch up on come first: a long re-sync of one must never make the others, or the rest of this minute's work, wait behind it.
          `SELECT a.* FROM accounts a LEFT JOIN imap_accounts i ON i.account_id = a.id WHERE a.provider = 'imap' AND a.sync_status <> 'disconnected'
           ORDER BY CASE WHEN COALESCE(i.backlog, 0) > 0 OR COALESCE(i.initial_import, 0) > 0 THEN 1 ELSE 0 END ASC, COALESCE(a.last_synced_at, 0) ASC LIMIT 8`
        )
        .all<AccountRow>();
      await syncEach(env, "imap", accounts.results, b);
    },
    { budgetMs: MAIL_PASS_BUDGET_MS }
  );

  // Last of the mail, so mail the passes above just stored reaches its webhook this minute rather than the next.
  await runJob("agent-webhooks", (b) => dispatchAgentWebhooks(env, undefined, undefined, b));

  await runJob("cleanup", () => hourlyCleanup(env));

  // After the sync, so mail it just stored is looked at this minute: let in the people who are obviously people, and spot Feeds and Paper Trail
  // mail that needs you.
  await runJob("auto-let-in", (b) => autoLetInDue(env, b), { budgetMs: 90_000 });
  await runJob("auto-calendar", (b) => autoCalendarDue(env, b), { budgetMs: 90_000 });
  await runJob("vacation-notices", (b) => vacationDue(env, b));
  await runJob("imbox-rescue", (b) => rescueDue(env, b), { budgetMs: 90_000 });

  // Then tell anyone with a subscribed device about what this minute brought, so it reaches them with the app closed.
  await runJob("push", (b) => pushDue(env, b));
}

/**
 * Once an hour, forget records that only ever matter for a while. Keyed on the time since it last ran rather than on the minute of the hour:
 * a tick that is skipped or late at minute zero must not skip the cleanup until the next hour, and the first tick after a restart does it.
 * The AI Usage page offers up to 90 days, so those records are kept for a year.
 */
export async function hourlyCleanup(env: Env, at: number = Date.now()): Promise<boolean> {
  if (at - lastCleanupAt < CLEANUP_EVERY_MS) return false;
  lastCleanupAt = at;
  const day = 86_400_000;
  const steps: [string, string, number[]][] = [
    ["ai usage", `DELETE FROM ai_calls WHERE created_at < ?`, [at - 365 * day]],
    ["send attempts", `DELETE FROM send_attempts WHERE created_at < ?`, [at - 3 * day]],
    // The sync log is what explains a stuck mailbox, and every failure writes to it. Without a limit it only grows.
    ["sync log", `DELETE FROM sync_log WHERE created_at < ?`, [at - 30 * day]],
    ["activity log", `DELETE FROM activity_log WHERE at < ?`, [at - 90 * day]],
    // A lockout that is still running is kept; everything else about a login attempt is stale after two days.
    ["old logins", `DELETE FROM login_attempts WHERE last_attempt_at < ? AND COALESCE(locked_until, 0) < ?`, [at - 2 * day, at]],
    // A contact's message count is added to as mail comes in, so a contact made another way (an address book, a decision) or a count that drifted
    // reads wrong for good. Count what is really stored and put right any that differ.
    [
      "contact counts",
      `UPDATE contacts c SET message_count = x.n
       FROM (SELECT account_id, lower(from_email) AS email, COUNT(*) AS n FROM messages WHERE is_from_me = 0 GROUP BY account_id, lower(from_email)) x
       WHERE c.account_id = x.account_id AND lower(c.email) = x.email AND c.message_count <> x.n`,
      [],
    ],
  ];
  for (const [what, sql, binds] of steps) {
    try {
      await env.DB.prepare(sql).bind(...binds).run();
    } catch (e) {
      console.error(`cleanup (${what}) failed`, e);
    }
  }
  return true;
}
