import type { Account } from "./common";

/** A Stalwart mail server inbox can provision domains and mailboxes on. The API key never leaves the server. */
export interface StalwartServer {
  id: string;
  name: string;
  base_url: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  api_key_hint: string;
  last_checked_at: number | null;
  last_error: string | null;
  mailboxes: number;
}

export interface StalwartDomain {
  id: string;
  name: string;
  isEnabled: boolean;
  description: string | null;
}

/** One record a domain should publish, and what DNS says about it. unchecked: a type this check does not look up. unknown: the lookup failed. */
export interface DnsCheckResult {
  id: string;
  type: string;
  name: string;
  value: string;
  purpose: string;
  essential: boolean;
  status: "ok" | "missing" | "mismatch" | "unchecked" | "unknown";
  /** What the name holds now for this type, for the user to compare. */
  found: string[];
}

export interface StalwartMailbox {
  id: string;
  name: string;
  domain_id: string;
  domain: string;
  email: string;
  description: string | null;
  /** The connected inbox account, or null when the mailbox exists on the server but is not connected here. */
  account_id: string | null;
  /** An administrator account: shown, but inbox will not connect, reset or delete it. */
  is_admin: boolean;
  /** A mailbox an AI agent uses through the agent API. */
  is_agent: boolean;
}

/** `password` is present only when inbox chose it, and is shown exactly once. */
export interface StalwartMailboxCreated {
  ok: boolean;
  account: Account;
  email: string;
  password?: string;
}

export interface Domain {
  id: string;
  name: string;
  /** Active once a message has arrived on one of its mailboxes. */
  status: "pending" | "active" | "error";
  sending: "resend" | "none";
  catch_all_account_id: string | null;
  error: string | null;
  /** Where the owner's mail server delivers mail for this domain, and whether the server accepts it. */
  inbound: { enabled: boolean; url: string; last_received_at: number | null };
  instructions: string[];
  mailboxes: Account[];
  created_at: number;
}
