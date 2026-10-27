import type { Address, Draft } from "@shared/types";

export interface DraftPerson {
  /** The first recipient's address, lower-case; empty for drafts with nobody on them yet. */
  key: string;
  /** Null for drafts with no recipient yet. */
  person: Address | null;
  /** How many other people are on the newest draft, beyond the first. */
  others: number;
  drafts: Draft[];
}

/** Who a draft is for: its first recipient, else its first cc. */
export function firstRecipient(d: Draft): Address | null {
  return d.to[0] ?? d.cc[0] ?? null;
}

/**
 * Drafts grouped under the person they are for. Drafts (and anything going out later) are ordered by what is next: the most recently
 * touched person first for drafts, the soonest send first for scheduled mail. Drafts with nobody on them sit together at the end.
 */
export function groupDraftsByPerson(drafts: Draft[], mode: "draft" | "scheduled"): DraftPerson[] {
  const byKey = new Map<string, DraftPerson>();
  for (const d of drafts) {
    const p = firstRecipient(d);
    const key = p ? p.email.toLowerCase() : "";
    let g = byKey.get(key);
    if (!g) {
      g = { key, person: p, others: 0, drafts: [] };
      byKey.set(key, g);
    }
    g.drafts.push(d);
  }
  const at = (d: Draft) => (mode === "scheduled" ? d.send_at ?? Number.MAX_SAFE_INTEGER : -d.updated_at);
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.drafts.sort((a, b) => (mode === "scheduled" ? at(a) - at(b) : b.updated_at - a.updated_at));
    const head = g.drafts[0];
    g.others = Math.max(0, head.to.length + head.cc.length - 1);
  }
  return groups.sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    return at(a.drafts[0]) - at(b.drafts[0]);
  });
}

/** The first words of a draft's text, without its signature or the quoted message beneath it. */
export function draftPreview(html: string): string {
  return html
    .replace(/<div class="(?:imbox|hey)-signature"[^>]*>[\s\S]*$/i, "")
    .replace(/<div class="(?:imbox|hey)-quote">[\s\S]*$/i, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
