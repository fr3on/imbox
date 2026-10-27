// Web Push from the server, with only WebCrypto: VAPID (RFC 8292) to say who is sending, and aes128gcm (RFC 8291) to encrypt the message
// so the push service in between can carry it but not read it.

import type { Env } from "./env";

const enc = new TextEncoder();

export const b64u = (buf: ArrayBuffer | Uint8Array): string => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64u = (s: string): Uint8Array => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

export interface Ephemeral {
  privateKey: CryptoKey;
  /** The uncompressed public point, 65 bytes. */
  publicRaw: Uint8Array;
}

/**
 * Encrypt one push message for a browser's subscription (RFC 8291). `uaPublic` is the subscription's p256dh key and `authSecret` its
 * auth secret. The salt and the one-time key are random unless a test supplies them.
 */
export async function encryptPayload(payload: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, opts: { salt?: Uint8Array; ephemeral?: Ephemeral } = {}): Promise<Uint8Array> {
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  let eph = opts.ephemeral;
  if (!eph) {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    eph = { privateKey: pair.privateKey, publicRaw: new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer) };
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // The standard calls this field `public`; the TypeScript typings spell it `$public`, and the runtime takes the standard name.
  const ecdh = { name: "ECDH", public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0];
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, eph.privateKey, 256));
  const prk = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, eph.publicRaw), 32);
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12);
  // One record: the message, then 0x02 to say it is the last.
  const record = concat(payload, new Uint8Array([2]));
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, record as BufferSource));
  const header = new Uint8Array(21 + eph.publicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = eph.publicRaw.length;
  header.set(eph.publicRaw, 21);
  return concat(header, cipher);
}

/* ---------- VAPID: this server's own signing key, made once and kept ---------- */

export interface Vapid {
  /** The public key a browser subscribes with (applicationServerKey), base64url. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

let cachedVapid: Promise<Vapid> | null = null;

export function getVapid(env: Env): Promise<Vapid> {
  if (!cachedVapid) {
    cachedVapid = (async () => {
      const db = env.DB;
      const row = await db.prepare(`SELECT value FROM app_secrets WHERE key = 'vapid'`).first<{ value: string }>();
      if (row?.value) return JSON.parse(row.value) as Vapid;
      const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const v: Vapid = { publicKey: b64u((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer), privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey };
      await db.prepare(`INSERT INTO app_secrets (key, value, created_at) VALUES ('vapid', ?, ?) ON CONFLICT DO NOTHING`).bind(JSON.stringify(v), Date.now()).run();
      const again = await db.prepare(`SELECT value FROM app_secrets WHERE key = 'vapid'`).first<{ value: string }>();
      return JSON.parse(again!.value) as Vapid;
    })().catch((e) => {
      cachedVapid = null;
      throw e;
    });
  }
  return cachedVapid;
}

async function vapidHeader(vapid: Vapid, endpoint: string, subject: string): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** The browser has dropped this subscription; it should be forgotten. */
  gone: boolean;
}

/** Send one message to one subscription. Never throws: a failure is a result. */
export async function sendPush(env: Env, target: PushTarget, message: unknown, subject: string): Promise<PushResult> {
  try {
    const vapid = await getVapid(env);
    const body = await encryptPayload(enc.encode(JSON.stringify(message)), fromB64u(target.p256dh), fromB64u(target.auth));
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidHeader(vapid, target.endpoint, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "normal",
      },
      body: body as BodyInit,
      // A slow push service must not hold up delivering the mail that triggered it.
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    console.error("push failed", (e as Error).message);
    return { ok: false, status: 0, gone: false };
  }
}
