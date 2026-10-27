import type { MergedContact, ScreenStatus } from "@shared/types";
import { contactKind } from "./contactKind";

/** A sender who has written this many times is loud enough to be worth a suggestion. */
export const NOISY_FROM = 15;

export type InsightKind = "noisy" | "misfiled";
export type MoveTo = "imbox" | "feed" | "paper_trail";

export interface Insight {
  /** Stable, so a dismissal can be remembered: "noisy:sentry@x.com". */
  key: string;
  kind: InsightKind;
  contact: MergedContact;
  /** For a misfiled sender: where the mail should go instead. */
  to?: MoveTo;
  reason: string;
  /** Who worked it out: plain rules, or the AI's review. */
  source: "rules" | "ai";
}

const routed = (s: ScreenStatus) => s === "imbox" || s === "feed" || s === "paper_trail";

/** Whether every mailbox already bundles this sender, so the suggestion to bundle them would be moot. */
const fullyBundled = (c: MergedContact) => c.accounts.length > 0 && c.accounts.every((a) => a.bundled);

const label = (c: MergedContact) => c.name || c.email.split("@")[0];

/** Senders that write far more than the rest: offered a bundle, or the door. Loudest first. */
export function noisySenders(list: MergedContact[], limit = 3): Insight[] {
  return list
    .filter((c) => routed(c.screen_status) && c.message_count >= NOISY_FROM && !fullyBundled(c))
    .sort((a, b) => b.message_count - a.message_count)
    .slice(0, limit)
    .map((c) => ({
      key: `noisy:${c.email.toLowerCase()}`,
      kind: "noisy" as const,
      contact: c,
      reason: `${label(c)} has written ${c.message_count} times`,
      source: "rules" as const,
    }));
}

const MAIL_SYSTEM = /^(mailer[-_.]?daemon|postmaster|bounces?)\b/i;

/**
 * Where plain rules can tell mail has been filed in the wrong place: a machine sitting in the Imbox, or the mail system's own notices
 * anywhere but the Paper Trail. The AI's review (see the server) catches the subtler cases.
 */
export function misfiledByRules(list: MergedContact[]): Insight[] {
  const out: Insight[] = [];
  for (const c of list) {
    if (!routed(c.screen_status) || c.mixed) continue;
    const local = c.email.split("@")[0] ?? "";
    if (MAIL_SYSTEM.test(local) && c.screen_status !== "paper_trail") {
      out.push({ key: `misfiled:${c.email.toLowerCase()}`, kind: "misfiled", contact: c, to: "paper_trail", reason: "Delivery notices belong with the paperwork", source: "rules" });
    } else if (c.screen_status === "imbox" && contactKind(c) === "service") {
      out.push({ key: `misfiled:${c.email.toLowerCase()}`, kind: "misfiled", contact: c, to: "feed", reason: "Looks automated, not a person writing to you", source: "rules" });
    }
  }
  return out;
}

export interface AiReviewed {
  email: string;
  to: MoveTo;
  reason: string;
}

/** The AI's review and the rules combined, one entry per sender, the AI's word winning; what has been dismissed or already fixed is left out. */
export function combineInsights(list: MergedContact[], ai: AiReviewed[], dismissed: Set<string>, limit = 4): Insight[] {
  const byEmail = new Map(list.map((c) => [c.email.toLowerCase(), c]));
  const misfiled = new Map<string, Insight>();
  for (const i of misfiledByRules(list)) misfiled.set(i.contact.email.toLowerCase(), i);
  for (const r of ai) {
    const c = byEmail.get(r.email.toLowerCase());
    if (!c || !routed(c.screen_status) || c.screen_status === r.to) continue;
    misfiled.set(c.email.toLowerCase(), { key: `misfiled:${c.email.toLowerCase()}`, kind: "misfiled", contact: c, to: r.to, reason: r.reason, source: "ai" });
  }
  // A sender already suggested a move is not also suggested a bundle.
  const noisy = noisySenders(list, 6).filter((i) => !misfiled.has(i.contact.email.toLowerCase()));
  return [...misfiled.values(), ...noisy].filter((i) => !dismissed.has(i.key)).slice(0, limit);
}
