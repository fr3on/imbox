import { queueInboundEvent } from "./agent";
import { decryptSecret, encryptSecret } from "./ai/crypto";
import { ingestInvitesFrom } from "./calendar/invites";
import type { AccountRow } from "./db";
import { logSync, now, uid } from "./db";
import type { Env } from "./env";
import { DEFAULT_LIMITS, imapFetchNew, imapVerify, type ImapConfig, type ImapLimits, type ImapSecurity } from "./imap";
import { deliverInbound, parseInbound } from "./inbound";
import { getSessionSecret } from "./secrets";
import { smtpSend, smtpVerify, type SmtpConfig, type SmtpSecurity } from "./smtp";

/** An ordinary poll takes at most this many; a mailbox with a backlog takes more, up to the time and memory budget of the pass. */
const MAX_MESSAGES_PER_RUN = 25;
const BACKLOG_MESSAGES_PER_RUN = 200;

/** How long a pass working through a backlog may run before it stops and leaves the rest for the next minute. */
const BACKLOG_BUDGET_MS = 25_000;

// One pass at a time per mailbox, in this process. A manual sync, the re-sync button and the once-a-minute job can all ask at once, and two passes would
// download the same messages twice over two connections (Gmail limits both). The second asker simply does nothing: the first is already doing it.
const running = new Set<string>();

// After a failed pass on a mailbox with a backlog, wait before trying again, longer each time (2, 4, 8, 16, then 30 minutes), so a server that is
// throttling us is not hit again a minute later.
const backoff = new Map<string, { until: number; step: number }>();
const BACKOFF_MINUTES = [2, 4, 8, 16, 30];

export interface ImapAccountRow {
  account_id: string;
  imap_host: string;
  imap_port: number;
  imap_security: ImapSecurity;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  username: string;
  password_enc: string;
  password_hint: string;
  folder: string;
  uid_validity: number;
  last_uid: number;
  updated_at: number;
  /** Set when the mailbox was provisioned through a Stalwart server (see stalwart_servers). */
  stalwart_server_id: string | null;
  stalwart_account_id: string | null;
  /** Newest messages to import on the first sync; cleared once that sync has run. */
  initial_import: number;
  /** Messages still to bring in after the last pass, and how many there were when the import began. Both 0 once up to date. */
  backlog: number;
  import_total: number;
}

/** A user-supplied import count, forced into 0..200. Anything unreadable means "don't import". */
export function clampImport(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(200, Math.max(0, n)) : 0;
}

/** "Everything in the inbox": more than any mailbox holds, so the cursor lands before the oldest message. */
export const RESYNC_ALL = 100_000;

/** A re-sync count, forced into 1..RESYNC_ALL; anything unreadable means the default of the latest 200. */
export function clampResync(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(RESYNC_ALL, n) : 200;
}

export async function loadImapRow(env: Env, accountId: string): Promise<ImapAccountRow | null> {
  return (
    (await env.DB.prepare(`SELECT * FROM imap_accounts WHERE account_id = ?`).bind(accountId).first<ImapAccountRow>()) ?? null
  );
}

/**
 * A fixed placeholder standing in for a stored password. Deliberately reveals nothing — not the
 * last characters and not the length. An API key hint elsewhere in the app helps you tell two of
 * your own keys apart; a mailbox password is a credential to someone else's system, and the ends of
 * it are worth more to an attacker than the reassurance is worth to you.
 */
const GOOGLE_HOST = /(^|\.)(gmail|googlemail)\.com$/i;

/**
 * Google shows an app password in four groups ("abcd efgh ijkl mnop") and people paste it that way. It has no spaces, and Google's
 * IMAP refuses it with them, so whitespace is dropped for Google's servers. Other providers' passwords are left exactly as typed.
 */
export function normalizePassword(host: string, password: string): string {
  return GOOGLE_HOST.test(host.trim()) ? password.replace(/\s+/g, "") : password;
}

/**
 * A refused Google login, said the way Google means it. Google's three refusals look alike but mean different things, so each gets its own
 * words; the server's own text is kept at the end so nothing is hidden. Other providers' errors pass through untouched.
 */
export function explainConnectionError(host: string, message: string): string {
  if (!GOOGLE_HOST.test(host.trim())) return message;
  const raw = message.replace(/^imap_login_failed:\s*/i, "").trim();
  if (/disabled|not enabled|IMAP access/i.test(raw) && /admin|domain|disabled/i.test(raw)) {
    return `Google says IMAP is turned off for this account or domain. On Workspace, an admin turns it on in Admin console → Apps → Google Workspace → Gmail → End user access → POP and IMAP. (Google: ${raw})`;
  }
  if (/Application-specific password required|ALERT/i.test(raw)) {
    return `Google wants an app password here, not the normal one. Make it at myaccount.google.com/apppasswords in this same account, with 2-Step Verification on. (Google: ${raw})`;
  }
  if (/AUTHENTICATIONFAILED|Invalid credentials|login_failed/i.test(raw)) {
    return `Google doesn't accept this email and app password together. Check that the app password was made in this same Google account (the one signed in as this address), that it was copied whole, and that the address is the account's main one, not an alias. If you can't create app passwords at all, your admin has them off. (Google: ${raw})`;
  }
  return message;
}

export const PASSWORD_PLACEHOLDER = "••••••••";
export function passwordHint(_password: string): string {
  return PASSWORD_PLACEHOLDER;
}

export async function encryptPassword(env: Env, password: string): Promise<string> {
  return encryptSecret(await getSessionSecret(env), password);
}

async function credentials(env: Env, row: ImapAccountRow): Promise<{ imap: ImapConfig; smtp: SmtpConfig }> {
  const password = row.password_enc ? await decryptSecret(await getSessionSecret(env), row.password_enc) : "";
  return {
    imap: {
      host: row.imap_host,
      port: row.imap_port,
      security: row.imap_security,
      username: row.username,
      password,
    },
    smtp: {
      host: row.smtp_host,
      port: row.smtp_port,
      security: row.smtp_security,
      username: row.username,
      password,
    },
  };
}

export async function configFor(env: Env, accountId: string): Promise<{ imap: ImapConfig; smtp: SmtpConfig } | null> {
  const row = await loadImapRow(env, accountId);
  return row ? credentials(env, row) : null;
}

/** Connect and log in to both servers — what "Test connection" runs before anything is saved. */
export async function verifyBoth(cfg: { imap: ImapConfig; smtp: SmtpConfig }): Promise<void> {
  await imapVerify(cfg.imap);
  await smtpVerify(cfg.smtp);
}

export interface ImapSyncOptions {
  /** Cap on how long this pass may run. The once-a-minute job uses the full budget; a request someone is waiting on uses less. */
  budgetMs?: number;
  /** Run even if this mailbox is waiting out a failure (a person pressed Sync). */
  force?: boolean;
}

/**
 * One incremental pass over an IMAP mailbox.
 *
 * The cursor is (UIDVALIDITY, last UID). A server that renumbers the folder changes UIDVALIDITY,
 * which invalidates every stored UID — that case re-baselines to the current end of the folder
 * rather than re-importing the whole history, the same choice the Gmail and Outlook paths make.
 *
 * A pass is bounded: it takes messages until it has used its time or its memory budget, ingests them, and records exactly how far it got, so a big
 * re-sync is many small passes (one a minute) rather than one that can run for ever. Only one pass runs per mailbox at a time.
 */
export async function syncImapAccount(env: Env, account: AccountRow, opts: ImapSyncOptions = {}): Promise<{ added: number }> {
  const row = await loadImapRow(env, account.id);
  if (!row) return { added: 0 };
  if (running.has(account.id)) return { added: 0 };

  const catchingUp = (row.backlog ?? 0) > 0 || (row.initial_import ?? 0) > 0;
  const wait = backoff.get(account.id);
  if (catchingUp && !opts.force && wait && wait.until > Date.now()) return { added: 0 };

  running.add(account.id);
  try {
    const out = await syncPass(env, account, row, catchingUp, opts);
    backoff.delete(account.id);
    return out;
  } catch (e) {
    if (catchingUp) {
      const step = Math.min((backoff.get(account.id)?.step ?? -1) + 1, BACKOFF_MINUTES.length - 1);
      backoff.set(account.id, { until: Date.now() + BACKOFF_MINUTES[step] * 60_000, step });
    }
    throw e;
  } finally {
    running.delete(account.id);
  }
}

async function syncPass(env: Env, account: AccountRow, row: ImapAccountRow, catchingUp: boolean, opts: ImapSyncOptions): Promise<{ added: number }> {
  const db = env.DB;
  const cfg = await credentials(env, row);
  const limits: Partial<ImapLimits> = catchingUp
    ? { maxMessages: BACKLOG_MESSAGES_PER_RUN, deadlineMs: opts.budgetMs ?? BACKLOG_BUDGET_MS }
    : { deadlineMs: opts.budgetMs ?? DEFAULT_LIMITS.deadlineMs };

  const result = await imapFetchNew(
    cfg.imap,
    row.folder,
    { uidValidity: row.uid_validity, lastUid: row.last_uid },
    MAX_MESSAGES_PER_RUN,
    row.initial_import ?? 0,
    limits
  );

  if (result.reset) {
    await logSync(env.DB, account.id, "warn", `IMAP folder was renumbered (UIDVALIDITY changed); re-syncing from now`);
  }
  for (const sk of result.skipped ?? []) {
    await logSync(env.DB, account.id, "warn", `Skipped one message (UID ${sk.uid}, ${(sk.size / 1048576).toFixed(1)} MB): too large to import. It is still in the mailbox on the server.`);
  }

  let added = 0;
  // The newest UID whose message is safely in. If a message fails to ingest, the cursor stops just before it, so the messages before it are not
  // fetched again and the one that failed is retried next time. Ingest is idempotent, so a replay never duplicates anything.
  let doneUid = result.reset || row.uid_validity === 0 ? result.lastUid : row.last_uid;
  let failure: unknown = null;
  for (const msg of result.messages) {
    try {
      const parsed = await parseInbound(msg.raw.buffer as ArrayBuffer, "", account.email);
      const r = await deliverInbound(env, account, parsed);
      added += r.added;
      // An agent mailbox with a webhook gets an event per new message. Never let that break a sync.
      if (r.added > 0) await queueInboundEvent(env, account.id, parsed.messageId, r.threadIds[0]).catch(() => false);
      // Meeting invitations go into this mailbox's calendar.
      if (r.added > 0 && parsed.attachments.length) await ingestInvitesFrom(env, account, parsed.attachments, { threadId: r.threadIds[0], messageId: parsed.messageId });
      doneUid = msg.uid;
    } catch (e) {
      failure = e;
      break;
    }
  }
  const finished = !failure;
  const lastUid = finished ? result.lastUid : doneUid;

  // Only when it actually moved: a poll that found nothing has nothing to record, and writing the same cursor back every minute is 1,440 row writes a
  // day per mailbox against a free-tier budget of 100,000. `last_synced_at` is syncAccount's to keep, on its own heartbeat.
  const backlog = finished ? Math.max(0, result.remaining ?? 0) : Math.max(row.backlog ?? 0, 1);
  // The total is set when a backfill begins, and cleared once the mailbox is up to date.
  const importTotal = backlog === 0 ? 0 : result.reset || row.uid_validity === 0 ? Math.max(backlog, row.import_total ?? 0) : Math.max(row.import_total ?? 0, backlog);
  const moved = result.uidValidity !== row.uid_validity || lastUid !== row.last_uid || backlog !== (row.backlog ?? 0) || importTotal !== (row.import_total ?? 0);
  if (moved) {
    await db
      .prepare(`UPDATE imap_accounts SET uid_validity = ?, last_uid = ?, initial_import = 0, backlog = ?, import_total = ?, updated_at = ? WHERE account_id = ?`)
      .bind(result.uidValidity, lastUid, backlog, importTotal, now(), account.id)
      .run();
  }
  if (failure) throw failure;
  if (!account.initial_sync_done) {
    await db.prepare(`UPDATE accounts SET initial_sync_done = 1 WHERE id = ?`).bind(account.id).run();
    account.initial_sync_done = 1;
  }
  return { added };
}

/** Hand a finished RFC822 message to the mailbox's own SMTP server. */
export async function sendViaImapAccount(
  env: Env,
  account: AccountRow,
  msg: { from: string; recipients: string[]; raw: string }
): Promise<void> {
  const cfg = await configFor(env, account.id);
  if (!cfg) throw new Error("smtp_not_configured");
  await smtpSend(cfg.smtp, msg);
}

export interface NewImapMailbox {
  email: string;
  username: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  imap_security: ImapSecurity;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  folder: string;
  /** Newest messages to import on the first sync (0 = none). */
  initial_import?: number;
}

/**
 * Write the `accounts` and `imap_accounts` rows for a mailbox whose credentials have already been
 * checked. `link` records which Stalwart server and account it was provisioned from, so inbox can
 * later reset its password or notice that it was deleted on the server.
 */
export async function insertImapAccount(
  env: Env,
  userId: string,
  cfg: NewImapMailbox,
  password: string,
  link?: { serverId: string; stalwartAccountId: string }
): Promise<string> {
  const enc = await encryptPassword(env, password);
  const id = uid();
  const t = now();
  // The account and its server settings are one change: a failure between two statements left an account with no settings, which nothing could sync.
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO accounts (id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, scopes,
           history_id, delta_link, initial_sync_done, initial_sync_page_token, initial_sync_count, sync_status, sync_error,
           last_synced_at, signature, cover_art, avatar_url, created_at)
         VALUES (?, ?, 'imap', ?, ?, NULL, NULL, NULL, '', NULL, NULL, 0, NULL, 0, 'idle', NULL, NULL, '', '', '', ?)`
      )
      .bind(id, userId, cfg.email, cfg.display_name, t),
    env.DB
      .prepare(
        `INSERT INTO imap_accounts (account_id, imap_host, imap_port, imap_security, smtp_host, smtp_port, smtp_security,
           username, password_enc, password_hint, folder, uid_validity, last_uid, updated_at, stalwart_server_id, stalwart_account_id, initial_import)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
      )
      .bind(
        id, cfg.imap_host, cfg.imap_port, cfg.imap_security, cfg.smtp_host, cfg.smtp_port, cfg.smtp_security,
        cfg.username, enc, passwordHint(password), cfg.folder, t, link?.serverId ?? null, link?.stalwartAccountId ?? null,
        clampImport(cfg.initial_import)
      ),
  ]);
  return id;
}

/**
 * Queue a non-destructive re-sync: the next sync re-reads the newest `count` messages of the folder and
 * ingests whatever is missing. Ingest is idempotent (by Message-ID), so mail already here is skipped and
 * nothing is duplicated; nothing is deleted. Works by rewinding the cursor, which the ordinary sync then
 * walks forward in bounded passes, one a minute. Returns false when the account is not an IMAP mailbox.
 */
export async function queueResync(env: Env, accountId: string, count: number): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE imap_accounts SET uid_validity = 0, last_uid = 0, initial_import = ?, backlog = 0, import_total = 0, updated_at = ? WHERE account_id = ?`)
    .bind(clampResync(count), now(), accountId)
    .run();
  if (!r.meta.changes) return false;
  // A sync error is exactly the sort of thing a re-sync is asked for; a mailbox that stopped syncing
  // because it was deleted on the server is not, so 'disconnected' is left alone.
  await env.DB.prepare(`UPDATE accounts SET sync_error = NULL, sync_status = 'idle' WHERE id = ? AND sync_status = 'error'`).bind(accountId).run();
  return true;
}
