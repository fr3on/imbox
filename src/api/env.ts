import type { UserRow, AccountRow } from "./db";

export interface Env {
  DB: Db;
  /** The database executor the server binds (see server/pggateway.mjs). `DB` is built from it by withDatabase(). */
  PG?: import("./database").Executor;
  /** Tells windows when a person's mail changed (server/changes.mjs). Absent on a host that cannot listen; /api/events then answers 404 and the app polls. */
  EVENTS?: { subscribe: (userId: string, fn: (reason: "change" | "accounts" | "resync" | "down" | "up") => void) => () => void; readonly connected: boolean; readonly syncs?: boolean };
  /** Answers DNS questions for the domain records check. Absent on a normal server, which asks the system resolver; tests give canned answers. */
  DNS?: import("../node/dns").Lookup;
  ASSETS: Fetcher;
  /** Public origin, e.g. https://mail.example.com. Optional: falls back to the request origin. */
  APP_URL?: string;
  APP_NAME: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Microsoft Entra app registration (`/common` authority): Outlook.com and Microsoft 365 mailboxes. */
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  /** Turns on POST /inbound/mail, the way mail for a domain mailbox arrives. */
  INBOUND_SECRET?: string;
  /** Resend API key: outbound fallback for custom-domain mailboxes. */
  RESEND_API_KEY?: string;
  /** "1" enables the hidden mock AI provider (local testing only). */
  AI_MOCK?: string;
  /** Where TypeSafe AI's API is, when it is not the usual place (a test, or a proxy). */
  TYPESAFE_API_URL?: string;
}

export type Variables = {
  user: UserRow;
  /** Primary account: the specific one when `X-Account-Id` names one, else the user's first account. Null only when the user has no accounts (routes then 400). */
  account: AccountRow | null;
  /** Account ids in scope for list/count queries: `[id]` for a specific account, all of the user's ids for unified scope. */
  accountIds: string[];
  /** Every account id the user owns, regardless of the requested scope (ownership checks for cross-account labels/collections). */
  allAccountIds: string[];
};

export type AppEnv = { Bindings: Env; Variables: Variables };
