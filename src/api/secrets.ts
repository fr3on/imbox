import type { Env } from "./env";
import { encryptSecret, decryptSecret } from "./ai/crypto";

let cached: Promise<string> | null = null;

function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * The secret used to encrypt stored AI keys. `SESSION_SECRET` from the environment wins; otherwise one is generated on
 * first use and persisted in `app_secrets`, so one-click deploys need no manual secret setup.
 */
export function getSessionSecret(env: Env): Promise<string> {
  if (env.SESSION_SECRET) return Promise.resolve(env.SESSION_SECRET);
  if (!cached) {
    cached = (async () => {
      const db = env.DB;
      const row = await db.prepare(`SELECT value FROM app_secrets WHERE key = 'session_secret'`).first<{ value: string }>();
      if (row?.value) return row.value;
      await db.prepare(`INSERT INTO app_secrets (key, value, created_at) VALUES ('session_secret', ?, ?) ON CONFLICT DO NOTHING`).bind(randomHex(32), Date.now()).run();
      const again = await db.prepare(`SELECT value FROM app_secrets WHERE key = 'session_secret'`).first<{ value: string }>();
      if (!again?.value) throw new Error("session_secret_missing");
      return again.value;
    })().catch((e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

/**
 * Stored values that must not sit in the database in the clear (the second-factor secret) are written as `enc1:` plus the encrypted value.
 * A value with no such prefix was stored before that and is read as it is, then sealed the next time it is written.
 */
const SEALED = "enc1:";

export async function sealSecret(env: Env, plain: string): Promise<string> {
  return SEALED + (await encryptSecret(await getSessionSecret(env), plain));
}

/** A Gmail or Outlook token as it goes into the accounts table: sealed, or left empty when there is none. */
export async function sealToken(env: Env, plain: string | null | undefined): Promise<string | null> {
  if (!plain) return null;
  // A value read from the table and written back unchanged (a Microsoft refresh that did not rotate) is already sealed.
  return plain.startsWith(SEALED) ? plain : sealSecret(env, plain);
}

export async function openToken(env: Env, stored: string | null | undefined): Promise<string> {
  return stored ? openSecret(env, stored) : "";
}

export async function openSecret(env: Env, stored: string): Promise<string> {
  return stored.startsWith(SEALED) ? decryptSecret(await getSessionSecret(env), stored.slice(SEALED.length)) : stored;
}

/**
 * Tokens stored before they were sealed are read as they are (see `openSecret`); this seals them in the background so an old copy of the
 * table stops holding working ones. It does a few rows a minute until none are left, and does nothing after that.
 */
export async function sealStoredTokens(env: Env): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, access_token, refresh_token FROM accounts
     WHERE (access_token IS NOT NULL AND access_token <> '' AND access_token NOT ILIKE 'enc1:%')
        OR (refresh_token IS NOT NULL AND refresh_token <> '' AND refresh_token NOT ILIKE 'enc1:%')
     LIMIT 25`
  ).all<{ id: string; access_token: string | null; refresh_token: string | null }>();
  for (const r of rows.results) {
    await env.DB.prepare(`UPDATE accounts SET access_token = ?, refresh_token = ? WHERE id = ?`)
      .bind(r.access_token ? await sealToken(env, r.access_token) : r.access_token, r.refresh_token ? await sealToken(env, r.refresh_token) : r.refresh_token, r.id)
      .run();
  }
  return rows.results.length;
}
