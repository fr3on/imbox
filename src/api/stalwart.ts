/**
 * A small client for Stalwart's management API.
 *
 * Since v0.16 there is no REST management API: every setting and every management action is a JMAP
 * object reachable at `/jmap` under the `urn:stalwart:jmap` capability, with type names prefixed `x:`
 * on the wire (`x:Domain`, `x:Account`). An API key is sent as a Bearer token. It cannot be used for
 * IMAP or SMTP, which is why every mailbox created here also gets a password of its own.
 *
 * Only what inbox needs is here: domains (with the DNS zone Stalwart generates for them) and user
 * accounts (create, change password, delete). Everything takes an injectable `fetch` so it can be
 * tested without a server.
 */

import { isPrivateHost } from "./netguard";

const USING = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];
const TIMEOUT_MS = 20_000;
/** Plenty for one person's mail; a hosting provider would want paging, and would say so here. */
const PAGE = 200;

export type StalwartErrorKind = "auth" | "forbidden" | "network" | "protocol" | "rejected";

export class StalwartError extends Error {
  kind: StalwartErrorKind;
  constructor(kind: StalwartErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface StalwartConn {
  /** Origin only, e.g. https://mail.example.com — see normalizeBaseUrl. */
  baseUrl: string;
  apiKey: string;
}

export type Fetch = typeof fetch;

export interface StalwartDomain {
  id: string;
  name: string;
  isEnabled: boolean;
  description: string | null;
}

export interface StalwartUser {
  id: string;
  name: string;
  domainId: string;
  description: string | null;
  /** An account with the Admin role. inbox never resets or deletes these: that is how you would lock yourself out. */
  isAdmin: boolean;
}

/** https only, origin only, no embedded credentials. Throws a StalwartError(protocol) otherwise. */
export function normalizeBaseUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new StalwartError("protocol", "That is not a valid URL.");
  }
  if (u.protocol !== "https:") throw new StalwartError("protocol", "The server URL must start with https://.");
  if (u.username || u.password) throw new StalwartError("protocol", "Do not put credentials in the URL.");
  if (!u.hostname.includes(".")) throw new StalwartError("protocol", "Use the server's full host name, e.g. mail.example.com.");
  if (isPrivateHost(u.hostname)) throw new StalwartError("protocol", "That address is on a private network. Use the server's public host name.");
  return u.origin;
}

type Call = [string, Record<string, unknown>, string];
type Responses = Record<string, Record<string, any>>;

/** Send one JMAP request and return the responses keyed by call id. Method-level errors throw. */
export async function jmap(conn: StalwartConn, calls: Call[], f: Fetch = fetch): Promise<Responses> {
  let res: Response;
  try {
    res = await f(`${conn.baseUrl}/jmap`, {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ using: USING, methodCalls: calls }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new StalwartError("network", `Could not reach the server: ${(e as Error).message?.slice(0, 160) ?? "unknown error"}`);
  }
  if (res.status === 401) throw new StalwartError("auth", "The server rejected the API key.");
  if (res.status === 403) throw new StalwartError("forbidden", "The API key is not allowed to do that.");
  if (!res.ok) throw new StalwartError("protocol", `The server answered ${res.status}.`);

  let body: { methodResponses?: [string, Record<string, any>, string][] };
  try {
    body = await res.json();
  } catch {
    throw new StalwartError("protocol", "The server did not answer with JSON — is that URL Stalwart's?");
  }
  if (!Array.isArray(body.methodResponses)) throw new StalwartError("protocol", "Unexpected response: not a JMAP reply.");

  const out: Responses = {};
  for (const [name, args, id] of body.methodResponses) {
    if (name === "error") {
      const type = String(args?.type ?? "error");
      const detail = args?.description ? `: ${String(args.description).slice(0, 200)}` : "";
      throw new StalwartError(type === "forbidden" ? "forbidden" : "rejected", `${type}${detail}`);
    }
    out[id] = args;
  }
  return out;
}

/** The message for a single failed create/update/destroy inside an otherwise successful /set. */
function rejection(map: Record<string, any> | undefined, key: string): StalwartError | null {
  const r = map?.[key];
  if (!r) return null;
  const props = Array.isArray(r.properties) && r.properties.length ? ` (${r.properties.join(", ")})` : "";
  const desc = r.description ? `: ${String(r.description).slice(0, 200)}` : "";
  return new StalwartError("rejected", `${r.type ?? "rejected"}${props}${desc}`);
}

/** Cheapest call that proves the URL is Stalwart and the key can manage domains. */
export async function verifyConnection(conn: StalwartConn, f: Fetch = fetch): Promise<void> {
  await jmap(conn, [["x:Domain/query", { limit: 1 }, "q"]], f);
}

export async function listDomains(conn: StalwartConn, f: Fetch = fetch): Promise<StalwartDomain[]> {
  const r = await jmap(
    conn,
    [
      ["x:Domain/query", { limit: PAGE }, "q"],
      [
        "x:Domain/get",
        { "#ids": { resultOf: "q", name: "x:Domain/query", path: "/ids" }, properties: ["name", "isEnabled", "description"] },
        "g",
      ],
    ],
    f
  );
  return ((r.g?.list ?? []) as any[])
    .map((d) => ({ id: String(d.id), name: String(d.name), isEnabled: d.isEnabled !== false, description: d.description ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The zone file Stalwart would publish for this domain: MX, SPF, DKIM, DMARC, autoconfig. */
export async function getDomainZone(conn: StalwartConn, domainId: string, f: Fetch = fetch): Promise<string> {
  const r = await jmap(conn, [["x:Domain/get", { ids: [domainId], properties: ["name", "dnsZoneFile"] }, "g"]], f);
  const d = r.g?.list?.[0];
  if (!d) throw new StalwartError("rejected", "notFound: that domain does not exist on the server");
  return String(d.dnsZoneFile ?? "");
}

export async function createDomain(conn: StalwartConn, name: string, f: Fetch = fetch): Promise<string> {
  const r = await jmap(conn, [["x:Domain/set", { create: { d1: { name } } }, "s"]], f);
  const err = rejection(r.s?.notCreated, "d1");
  if (err) throw err;
  const id = r.s?.created?.d1?.id;
  if (!id) throw new StalwartError("protocol", "The server did not return the new domain's id.");
  return String(id);
}

export async function setDomainEnabled(conn: StalwartConn, domainId: string, isEnabled: boolean, f: Fetch = fetch): Promise<void> {
  const r = await jmap(conn, [["x:Domain/set", { update: { [domainId]: { isEnabled } } }, "s"]], f);
  const err = rejection(r.s?.notUpdated, domainId);
  if (err) throw err;
}

export async function deleteDomain(conn: StalwartConn, domainId: string, f: Fetch = fetch): Promise<void> {
  const r = await jmap(conn, [["x:Domain/set", { destroy: [domainId] }, "s"]], f);
  const err = rejection(r.s?.notDestroyed, domainId);
  if (err) throw err;
}

export async function listUsers(conn: StalwartConn, f: Fetch = fetch): Promise<StalwartUser[]> {
  const r = await jmap(
    conn,
    [
      ["x:Account/query", { limit: PAGE }, "q"],
      [
        "x:Account/get",
        { "#ids": { resultOf: "q", name: "x:Account/query", path: "/ids" }, properties: ["name", "domainId", "description", "roles"] },
        "g",
      ],
    ],
    f
  );
  return ((r.g?.list ?? []) as any[])
    .filter((a) => !a["@type"] || a["@type"] === "User")
    .map((a) => ({
      id: String(a.id),
      name: String(a.name),
      domainId: String(a.domainId),
      description: a.description ?? null,
      isAdmin: a.roles?.["@type"] === "Admin",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createUser(
  conn: StalwartConn,
  u: { name: string; domainId: string; description?: string; password: string },
  f: Fetch = fetch
): Promise<string> {
  const account: Record<string, unknown> = {
    "@type": "User",
    name: u.name,
    domainId: u.domainId,
    credentials: { "0": { "@type": "Password", secret: u.password } },
  };
  if (u.description) account.description = u.description;
  const r = await jmap(conn, [["x:Account/set", { create: { u1: account } }, "s"]], f);
  const err = rejection(r.s?.notCreated, "u1");
  if (err) throw err;
  const id = r.s?.created?.u1?.id;
  if (!id) throw new StalwartError("protocol", "The server did not return the new account's id.");
  return String(id);
}

/**
 * Replace the account's password. If it already has a password credential that one is patched in
 * place (so any OTP or expiry on it is kept); otherwise a fresh one is added.
 */
export async function setUserPassword(conn: StalwartConn, accountId: string, password: string, f: Fetch = fetch): Promise<void> {
  const got = await jmap(conn, [["x:Account/get", { ids: [accountId], properties: ["credentials"] }, "g"]], f);
  const acc = got.g?.list?.[0];
  if (!acc) throw new StalwartError("rejected", "notFound: that account does not exist on the server");
  const creds = (acc.credentials ?? {}) as Record<string, { "@type"?: string }>;
  const existing = Object.keys(creds).find((k) => creds[k]?.["@type"] === "Password");
  const patch: Record<string, unknown> = existing
    ? { [`credentials/${existing}/secret`]: password }
    : { "credentials/new": { "@type": "Password", secret: password } };
  const r = await jmap(conn, [["x:Account/set", { update: { [accountId]: patch } }, "s"]], f);
  const err = rejection(r.s?.notUpdated, accountId);
  if (err) throw err;
}

export async function deleteUser(conn: StalwartConn, accountId: string, f: Fetch = fetch): Promise<void> {
  const r = await jmap(conn, [["x:Account/set", { destroy: [accountId] }, "s"]], f);
  const err = rejection(r.s?.notDestroyed, accountId);
  if (err) throw err;
}

// Shared with the browser so what the form promises is what the server enforces.
