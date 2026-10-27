import type { Message } from "@shared/types";
import type { useThreadAction } from "@/api";
import type { ReplyMode } from "@/lib/reply";

/** Runs a thread action and says what happened. */
export type Run = (a: Parameters<ReturnType<typeof useThreadAction>["mutate"]>[0], msg?: string) => void;
/** The reply box that is open, if one is. */
export type ReplyState = { mode: ReplyMode; m: Message; key: number; body_html?: string };
export type OpenReply = (mode: ReplyMode, m?: Message) => void;
