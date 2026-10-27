import type { MiddlewareHandler } from "hono";

/** A plain JSON object: not null, not an array. */
export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** An id from a request: a non-empty string of sane length. Anything else (a number, an object, a megabyte of text) is not an id. */
export const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;

/** The ids in a request's list: strings only, each once, at most `max` of them. Anything that is not a list is no ids at all. */
export function idList(v: unknown, max = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (!isId(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** A string field, trimmed and cut to `max`; "" when the field is missing or is not a string. */
export const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** `?page=` as a page number: whole, not below 0, not so large that `page * size` leaves the range a database can count in. */
export function pageParam(v: string | undefined | null, max = 100_000): number {
  const n = parseInt(v ?? "0", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
}

const DEFAULT_LIMIT = 1_000_000;

/**
 * What a request body may be before any route reads it. Every JSON route in this app takes an object; a body that is `null`, a number or an
 * array used to reach `body.field` and come back as a 500, and an unbounded one was read whole into memory. Here a JSON body that is
 * too large is a 413, one that does not parse is a 400, and one that is not an object is a 400. Bodies that are not JSON (an image, an
 * .ics file) are not looked at. An empty body is left alone: some routes take no input at all.
 *
 * `limits` are exact request paths that may be larger than `max`.
 */
export function jsonBodyGuard(max = DEFAULT_LIMIT, limits: Record<string, number> = {}): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
    if (!/json/i.test(c.req.header("content-type") ?? "")) return next();
    const limit = limits[new URL(c.req.url).pathname] ?? max;
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > limit) return c.json({ error: "too_large", message: "That request is too large." }, 413);
    const raw = await c.req.text();
    if (raw.length > limit) return c.json({ error: "too_large", message: "That request is too large." }, 413);
    if (!raw.trim()) return next();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_json", message: "The request body is not valid JSON." }, 400);
    }
    if (!isObject(value)) return c.json({ error: "invalid_body", message: "The request body must be a JSON object." }, 400);
    return next();
  };
}

/**
 * A search word cut to a length a person could mean. A pasted URL or paragraph in the search box would otherwise be one clause per word to the database. Cut by
 * bytes, never in the middle of a character.
 */
export function searchTerm(s: string, maxBytes = 200): string {
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/**
 * Whether an exception message describes the server's own insides (a database error, or a bug) rather than something a caller can act on. Routes
 * that pass an error's text on to the person (an upstream's refusal is useful to them) use this to keep the other kind to the log.
 */
export function looksInternal(message: string): boolean {
  return /\bat [\w.$<>]+ \(|Cannot read prop|is not a function|is not iterable|is not defined|violates .* constraint|duplicate key value|syntax error at|relation ".*" does not exist|column ".*" does not exist/i.test(message);
}
