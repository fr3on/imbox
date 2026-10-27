/**
 * Rules for creating a mailbox, shared by the API (which enforces them) and the browser (which
 * explains them as you type), so the two can never disagree about what is allowed.
 */

export const MIN_MAILBOX_PASSWORD = 10;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** A random password with no ambiguous shapes to mistype; rejection-sampled so no character is favoured. */
export function generatePassword(length = 24): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b >= limit) continue;
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Local part rules kept conservative: what mail clients and Stalwart both accept without quoting. */
export function validLocalPart(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/.test(s);
}

export interface Strength {
  /** 0 nothing typed · 1 weak · 2 okay · 3 good · 4 strong */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/**
 * An honest, cheap gauge — length first, then variety. It advises; only the minimum length is enforced.
 * Below the minimum it is always "Too short", and a password of a few repeated characters never rates
 * as okay however long it is.
 */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < MIN_MAILBOX_PASSWORD) return { score: 1, label: "Too short" };
  if (new Set(pw).size < 5) return { score: 1, label: "Too repetitive" };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = 2;
  if (pw.length >= 14) score++;
  if (classes >= 3 || pw.length >= 20) score++;
  const s = Math.min(4, score) as 2 | 3 | 4;
  return { score: s, label: s === 2 ? "Okay" : s === 3 ? "Good" : "Strong" };
}
