export const CHANNEL: string;
export const CHANNELS: Record<string, string>;
export type Reason = "change" | "accounts" | "resync" | "down" | "up";
export interface ChangeBus {
  start(): Promise<void>;
  subscribe(userId: string, fn: (reason: Reason) => void): () => void;
  readonly connected: boolean;
  readonly syncs: boolean;
  readonly subscribers: number;
  close(): Promise<void>;
}
export function createChangeBus(options: {
  connect: () => Promise<{ query: (sql: string) => Promise<unknown>; on: (event: string, fn: (...args: any[]) => void) => unknown; end: () => Promise<unknown> }>;
  debounceMs?: number;
  pingMs?: number;
  retryMs?: number[];
  log?: { warn: (...a: unknown[]) => void };
  syncs?: boolean;
}): ChangeBus;
