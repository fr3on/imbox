export type AutoAgentMemoryKind = "rule" | "faq" | "fact" | "tone" | "contact";

export interface AgentKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ("read" | "send")[];
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export interface AgentEvent {
  id: string;
  message_id: string;
  created_at: number;
  attempts: number;
  delivered_at: number | null;
  last_error: string | null;
}

/** An agent mailbox as the app shows it. Keys appear by prefix only; the full key is shown once, when made. */
export interface AgentMailbox {
  account_id: string;
  email: string;
  display_name: string;
  webhook_url: string;
  webhook_secret_set: boolean;
  keys: AgentKey[];
  recent_events: AgentEvent[];
}

export interface AgentKeyCreated {
  id: string;
  name: string;
  prefix: string;
  scopes: ("read" | "send")[];
  created_at: number;
  expires_at: number | null;
  /** The full key. Present only in this response. */
  key: string;
}
