import type { Address } from "./common";

export type Bucket = "screener" | "imbox" | "feed" | "paper_trail" | "screened_out" | "trash";
export type ScreenStatus = "pending" | "imbox" | "feed" | "paper_trail" | "screened_out";

export interface Label {
  account_id: string;
  id: string;
  name: string;
  color: string;
}

export interface ThreadSummary {
  account_id: string;
  id: string;
  subject: string; // custom_subject ?? subject
  original_subject: string;
  snippet: string;
  bucket: Bucket;
  seen: boolean;
  unread: boolean;
  reply_later: boolean;
  set_aside: boolean;
  bubble_up_at: number | null;
  bubbled: boolean;
  note: string;
  has_attachments: boolean;
  trackers_blocked: number;
  participants: Address[];
  last_from: Address;
  message_count: number;
  first_message_at: number;
  last_message_at: number;
  labels: Label[];
  // Screener-only: status of the sender's contact
  sender_status?: ScreenStatus;
  // Feeds and Paper Trail only: this thread looks like it needs the person. Dismissed or answered hints are left out.
  imbox_hint?: { reason: string; source: "rules" | "ai" } | null;
  // Search results only: where the words were found, and the line of text around them.
  match?: { why: "subject" | "sender" | "body" | "note"; excerpt: string };
  // Search results only: the first few files in the conversation.
  found_files?: { id: string; message_id: string; filename: string; mime_type: string; size: number }[];
}

export interface AutoLetIn {
  id: string;
  email: string;
  name: string;
  reason: string;
  source: "rules" | "ai";
  created_at: number;
}

export interface Attachment {
  account_id: string;
  id: string;
  message_id: string;
  thread_id: string;
  filename: string;
  mime_type: string;
  size: number;
  is_inline: boolean;
  created_at: number;
  // Optional context (Files page)
  thread_subject?: string;
  from?: Address;
}

export interface Message {
  account_id: string;
  id: string;
  thread_id: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  reply_to: string;
  subject: string;
  date: number;
  snippet: string;
  text_body: string;
  html_body: string; // sanitized-ish (tracker pixels removed). Client must still DOMPurify + sandbox.
  is_from_me: boolean;
  unread: boolean;
  has_attachments: boolean;
  trackers: string[]; // blocked tracker hostnames
  /** What the receiving server said about the sender ("spf=pass dkim=pass dmarc=fail"); empty when it said nothing. */
  auth_results?: string;
  list_unsubscribe: string;
  attachments: Attachment[];
}

export interface Clip {
  account_id: string;
  id: string;
  thread_id: string;
  message_id: string | null;
  text: string;
  created_at: number;
  thread_subject?: string;
}

export interface ThreadDetail extends ThreadSummary {
  messages: Message[];
  collections: { id: string; name: string }[];
  clips: Clip[];
  merged_threads: { id: string; subject: string }[];
  /** Whether the latest sender is bundled (for the Bundle / Unbundle toggle). */
  sender_bundled: boolean;
  /** Marked "Not waiting" since its latest message: nothing is expected back, so it stays out of the brief's waiting list. */
  not_waiting?: boolean;
  /** What the owner decided about this sender or its domain before: reported ("bad") or marked fine ("ok"). */
  phish_verdict?: "bad" | "ok" | null;
  /** "Looks fine" was pressed on the phishing warning since its latest message. */
  phish_ok?: boolean;
  /** Whether part of the thread had already been read before this request. Set on the request that opens it, or peeks at it. */
  was_seen?: boolean;
  /** Messages from other people that arrived since it was last read; empty for a thread never opened. */
  new_message_ids?: string[];
}

export interface Contact {
  account_id: string;
  id: string;
  email: string;
  name: string;
  screen_status: ScreenStatus;
  screened_at: number | null;
  first_seen_at: number;
  last_seen_at: number;
  message_count: number;
  notes: string;
  avatar_url: string;
  /** All their mail collapses into one row in the Imbox / Paper Trail. */
  bundled: boolean;
}

/**
 * One person, merged across every account that has heard from them. Contact rows are per (account, email);
 * the list and detail views collapse them so someone who writes to three of your addresses is one entry.
 */
export interface MergedContact extends Contact {
  /** True when the accounts disagree about where this person's mail goes. */
  mixed: boolean;
  accounts: { account_id: string; contact_id: string; screen_status: ScreenStatus; bundled: boolean }[];
}

/** Whether a screening / bundling change applies to every connected account, or only the one it came from. */
export type DecisionScope = "all" | "account";

/** One bundled sender, standing in for all of their threads in a list. */
export interface Bundle {
  id: string;
  contact_id: string;
  account_id: string;
  email: string;
  name: string;
  avatar_url: string;
  status: "open" | "seen";
  thread_count: number;
  message_count: number;
  latest: ThreadSummary;
  first_message_at: number;
  last_message_at: number;
}

export interface BundleDetail {
  bundle: Bundle;
  threads: (ThreadSummary & { latest_message: Message | null })[];
  /** The next page of threads, when the bundle holds more than one page. */
  next_page?: number | null;
}

export interface Collection {
  account_id: string;
  id: string;
  name: string;
  description: string;
  thread_count: number;
  file_count: number;
  created_at: number;
  updated_at: number;
}

export interface Draft {
  account_id: string;
  id: string;
  thread_id: string | null;
  reply_to_message_id: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body_html: string;
  send_at: number | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed";
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface ImboxResponse {
  new_threads: ThreadSummary[];
  seen_threads: ThreadSummary[];
  reply_later: ThreadSummary[];
  set_aside: ThreadSummary[];
  screener_count: number;
  screener_senders: (Address & { account_id: string; thread_count: number })[];
  bundles: Bundle[];
  /** While you are away: mail waiting for you to be back, so it is not in the cards. */
  held_threads?: ThreadSummary[];
  /** Set while you are away. */
  away?: { until: number; replied: number; held: number } | null;
}

export interface Counts {
  screener: number;
  imbox_new: number;
  feed_new: number;
  paper_trail_new: number;
  reply_later: number;
  set_aside: number;
}
