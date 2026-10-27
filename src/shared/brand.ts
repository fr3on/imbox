/**
 * The name this deployment goes by. It comes from the APP_NAME variable, so the same code can be
 * "inbox" for one person and "acme" for another; the server sends it to the browser with the session.
 */

export const DEFAULT_BRAND = "inbox";
const MAX_BRAND = 24;

/** A usable brand name: whitespace tidied, kept to a sensible length, and never empty. */
export function sanitizeBrand(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_BRAND) : "";
  return s || DEFAULT_BRAND;
}

/** The product's own name, which the deploy templates set as APP_NAME; it gets the real logo just like the default. */
const PRODUCT_NAMES = [DEFAULT_BRAND, "imbox"];

export function isDefaultBrand(name: string): boolean {
  return PRODUCT_NAMES.includes(name.trim().toLowerCase());
}

/** One or two characters for the logo tile: the first two letters or digits of the name ("acme" → "ac"). */
export function brandMonogram(name: string): string {
  const chars = [...name].filter((c) => /[\p{L}\p{N}]/u.test(c)).slice(0, 2);
  return chars.join("") || "?";
}
