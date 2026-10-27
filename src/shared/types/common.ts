import type { ScreenStatus } from "./mail";

export interface Address {
  email: string;
  name: string;
  avatar_url?: string;
}

/**
 * Being away. While it is on, people who write to you get one reply, the Imbox lets through only the people you write to and anything that
 * reads as urgent, and the rest waits in "Back to work". The notices are written once (by the model, if one is set up) and approved by you; the
 * text that is sent is exactly the text you saw, filled in with nothing but the sender's first name.
 */
export interface VacationSettings {
  /** Switched on. It only does anything once the notices are approved and while `from` to `until` includes now. */
  on: boolean;
  approved: boolean;
  from: number;
  until: number;
  /** What the person asked for in a line, for the model: "Friendly. Urgent things go to Sofia." */
  guidance: string;
  /** Who urgent things go to, as the person typed it. Used in the notices. */
  contact: string;
  /** The wording for three kinds of sender: someone at your own domain, someone you have written to, and anyone else. */
  notices: { team: string; contact: string; other: string };
  letThrough: { correspondents: boolean; urgent: boolean };
}

export interface UserSettings {
  vacation?: VacationSettings;
  /** Two things the app does on its own that reach outside. Both are on unless switched off here. */
  privacy?: {
    /** The browser asks GitHub for the newest release. */
    updateCheck?: boolean;
    /** The server asks Gravatar, a sender's site and DNS for a picture or brand logo of each sender. */
    senderPictures?: boolean;
  };
  theme?: "light" | "dark" | "system";
  sidebarLayout?: "expanded" | "collapsed" | "top";
  // Default place for new screened-in senders. Not a rule, just the default selection.
  defaultScreenTarget?: Exclude<ScreenStatus, "pending" | "screened_out">;
  // People in your address book, or answering a mail you sent, skip the Screener (and, with AI, so does anyone it is sure is a person writing to you). Off by default.
  autoLetIn?: boolean;
  // Put deadlines and renewals found in your mail into your calendar as all-day events. Needs AI. Off by default.
  autoCalendar?: boolean;
  // Offer to move a single Feeds or Paper Trail thread to the Imbox when it looks like it needs you. On by default.
  rescueMail?: boolean;
  undoSendSeconds?: number; // 0 disables
  showPreviews?: boolean;
  // How the Imbox shows new mail: one card at a time ("deck", the default) or as a list.
  imboxLayout?: "deck" | "list";
  // Senders whose remote images load without asking. Everyone else's stay blocked until the reader shows them.
  imageSenders?: string[];

  // Profile & identity
  avatar_url?: string;
  avatar_type?: "custom" | "gravatar" | "initials";
  job_title?: string;
  company?: string;
  phone?: string;
  bio?: string;
  display_name?: string;

  // Mail sending & defaults
  defaultAccountId?: string;
  replyToEmail?: string;
  autoBcc?: string;
  // Grey words that finish the sentence in a reply as you type. Off until switched on, since it sends what you write to your AI provider.
  aiComplete?: boolean;
  defaultSignature?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
  settings: UserSettings;
  created_at: number;
  two_factor_enabled?: boolean;
}

export interface Account {
  id: string;
  email: string;
  display_name: string;
  provider: "gmail" | "domain" | "outlook" | "imap";
  domain_id: string | null;
  initial_sync_done: boolean;
  initial_sync_count: number;
  sync_status: "idle" | "syncing" | "error" | "disconnected";
  sync_error: string | null;
  last_synced_at: number | null;
  signature: string;
  cover_art: string;
  avatar_url: string;
  photos_synced_at: number | null;
  created_at: number;
  /** An agent mailbox: used by an AI agent through the agent API, and kept out of the unified inbox. */
  is_agent?: boolean;
  /** A mailbox bringing in a long backlog (a re-sync, or a first import): how many messages are left, and how many there were at the start. */
  import_remaining?: number;
  import_total?: number;
}

export interface ApiError {
  error: string;
  /** A sentence written for a person; preferred over the code when present. */
  message?: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  recovery_left: number;
}
