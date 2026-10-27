import type { Address } from "@shared/types";
import { parseAddresses } from "./addresses";

/** The fields of a new message that a mailto: link can set. They fit the composer's starting values. */
export interface MailtoMessage {
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject?: string;
  body_html?: string;
}

const MAX_PEOPLE = 50;
const MAX_SUBJECT = 300;
const MAX_BODY = 20_000;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A mailto: link read into the fields of a new message (RFC 6068): the addresses before the "?", then to, cc, bcc, subject and body. A plus sign is a
 * plus sign, not a space. Anything else in the link, such as an attachment, is ignored. The body is plain text, so it is escaped before it becomes
 * HTML. A browser that hands over a mailto: link as a whole encoded address (mailto%3A...) is understood as well.
 */
export function parseMailto(raw: string): MailtoMessage {
  let link = raw.trim();
  if (/^mailto%3a/i.test(link)) link = decode(link);
  link = link.replace(/^mailto:/i, "");
  const q = link.indexOf("?");
  const head = q < 0 ? link : link.slice(0, q);
  const params = new Map<string, string[]>();
  if (q >= 0) {
    for (const pair of link.slice(q + 1).split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = decode(eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
      const value = decode(eq < 0 ? "" : pair.slice(eq + 1));
      params.set(key, [...(params.get(key) ?? []), value]);
    }
  }
  const people = (...lists: (string | string[] | undefined)[]) => parseAddresses(lists.flat().filter((x): x is string => !!x).join(",")).slice(0, MAX_PEOPLE);
  const out: MailtoMessage = { to: people(decode(head), params.get("to")) };
  const cc = people(params.get("cc"));
  const bcc = people(params.get("bcc"));
  if (cc.length) out.cc = cc;
  if (bcc.length) out.bcc = bcc;
  const subject = (params.get("subject")?.[0] ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_SUBJECT);
  if (subject) out.subject = subject;
  const body = (params.get("body")?.[0] ?? "").replace(/\r\n?/g, "\n").slice(0, MAX_BODY);
  if (body.trim()) out.body_html = escapeHtml(body).replace(/\n/g, "<br>");
  return out;
}

export const isMailto = (href: string | null | undefined) => /^\s*mailto:/i.test(href ?? "");
