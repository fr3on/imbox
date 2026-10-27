/**
 * Where to go after signing in. The address comes from the link (`/login?next=...`), so anyone can write it, and a link that signs you in and then
 * sends you to another site is a good way to make a fake page look real. Only a path inside this app is followed.
 */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/")) return fallback;
  // "//host" and "/\host" are addresses on another host to a browser; control characters are never part of a path we made.
  if (v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f\u007f]/.test(v)) return fallback;
  // The sign-in pages themselves would only bounce the person back.
  if (/^\/(login|register)(\/|\?|#|$)/.test(v)) return fallback;
  return v;
}
