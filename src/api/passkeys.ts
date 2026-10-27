import type { Context } from "hono";
import type { AppEnv, Env } from "./env";
import { getSessionSecret } from "./secrets";
import { appOrigin } from "./routes/auth";
import { now } from "./db";

export interface PasskeyRow {
  id: string;
  user_id: string;
  name: string;
  public_key: string;
  counter: number;
  device_type: string;
  backed_up: number;
  transports_json: string;
  created_at: number;
  last_used_at: number | null;
}

export function getWebAuthnConfig(c: Context<AppEnv>) {
  // The relying party is this deployment's own address, never the `Origin` header the caller sent: that is theirs to choose, and an origin
  // the caller picks is not a check on anything.
  const configured = appOrigin(c);
  let hostname = "localhost";
  try {
    hostname = new URL(configured).hostname;
  } catch {
    // fallback
  }

  const allowed = new Set<string>([configured]);
  // The development servers, and only when the app itself is being served from this machine.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    allowed.add("http://localhost:5173");
    allowed.add("http://127.0.0.1:5173");
    allowed.add("http://localhost:8787");
    allowed.add("http://127.0.0.1:8787");
  }

  return {
    origin: configured,
    rpID: hostname,
    allowedOrigins: Array.from(allowed),
  };
}

/** A credential id for an address that has no passkey: stable for the address, unguessable without the server's secret. */
export async function decoyCredentialId(env: Env, email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await getSessionSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`passkey-decoy:${email}`)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function savePasskeyChallenge(
  db: Db,
  challenge: string,
  type: "register" | "auth",
  userId: string | null = null,
  ttlMs = 5 * 60 * 1000
) {
  const t = now();
  const expiresAt = t + ttlMs;
  await db
    .prepare(
      `INSERT INTO passkey_challenges (challenge, user_id, type, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(challenge, userId, type, t, expiresAt)
    .run();

  // Prune expired challenges
  await db.prepare(`DELETE FROM passkey_challenges WHERE expires_at < ?`).bind(t).run().catch(() => {});
}

export async function consumePasskeyChallenge(
  db: Db,
  challenge: string,
  type: "register" | "auth"
): Promise<{ valid: boolean; userId: string | null }> {
  // Taken in one statement, so a challenge answered twice at once is good for one of them (replay protection).
  const row = await db
    .prepare(`DELETE FROM passkey_challenges WHERE challenge = ? AND type = ? AND expires_at > ? RETURNING user_id`)
    .bind(challenge, type, now())
    .first<{ user_id: string | null }>();
  if (!row) return { valid: false, userId: null };
  return { valid: true, userId: row.user_id };
}
