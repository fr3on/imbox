import type { Address } from "@shared/types";

export interface ComposerInitial {
  draft_id?: string;
  /** From account. Defaults to the thread's account for replies, else the default account. */
  account_id?: string | null;
  thread_id?: string | null;
  reply_to_message_id?: string | null;
  to?: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject?: string;
  body_html?: string;
  quoted_html?: string; // appended below the body when sending (collapsed in editor)
  title?: string;
}

export interface ComposerHandle {
  /** Save a draft if there is anything worth saving, then close. */
  saveAndClose: () => Promise<void>;
  isEmpty: () => boolean;
  /** Send now (same as the Send button). */
  send: () => void;
}
