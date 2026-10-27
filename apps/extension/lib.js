// Shared by the popup, the settings page and the background worker: the saved connection, the calls to the server, and the toolbar count.

export const ext = globalThis.browser ?? globalThis.chrome;

/** What is saved: the address of the server and the token. Kept in this browser only (storage.local, never synced). */
export async function getConnection() {
  const { server, token } = await ext.storage.local.get(["server", "token"]);
  return server && token ? { server, token } : null;
}
export const saveConnection = (server, token) => ext.storage.local.set({ server, token });
export const clearConnection = () => ext.storage.local.remove(["server", "token", "lastNotifiedScreenerAt", "lastNotifiedImboxAt", "notifiedKeys"]);

/** A server address as an origin: https, or http for this computer. Returns null for anything else. */
export function normalizeServer(input) {
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** One call to the server with the saved token. A 401 means the token was removed; the connection is dropped so the popup asks again. */
export async function call(path, { method = "GET", body, conn } = {}) {
  const c = conn ?? (await getConnection());
  if (!c) throw new ApiError(0, "Not connected");
  let res;
  try {
    res = await fetch(c.server + path, {
      method,
      headers: { authorization: `Bearer ${c.token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(-1, "Can’t reach your server");
  }
  if (res.status === 401) {
    if (!conn) await clearConnection();
    throw new ApiError(401, "This token no longer works");
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j.message || j.error || `Error ${res.status}`);
  }
  return res.json();
}

/** The count on the toolbar icon: the Screener queue. Nothing when it is empty; "!" when the server can't be reached; "–" when not connected. */
export async function showBadge(state) {
  const text = state === "off" ? "–" : state === "error" ? "!" : state > 0 ? (state > 99 ? "99+" : String(state)) : "";
  await ext.action.setBadgeText({ text });
  await ext.action.setBadgeBackgroundColor({ color: typeof state === "number" && state > 0 ? "#c2410c" : "#6b6b6b" });
}

/** Ask the server for the counts and put the Screener number on the icon. Returns the counts, or null when it could not. */
export async function refreshBadge() {
  const conn = await getConnection();
  if (!conn) {
    await showBadge("off");
    return null;
  }
  try {
    const counts = await call("/api/counts", { conn });
    await showBadge(counts.screener ?? 0);
    return counts;
  } catch (e) {
    await showBadge(e.status === 401 ? "off" : "error");
    return null;
  }
}

/** The imbox wordmark as inline SVG, in the current text colour. `h` is its height in px. The same drawing as src/web/components/TypoLogo.tsx. */
export const wordmark = (h = 17) =>
  `<svg class="wm" role="img" aria-label="imbox" height="${h}" width="${Math.round(h * 3.36)}" viewBox="-3 3 134.5 40"><defs><clipPath id="wl"><rect x="61.5" y="0" width="28.4" height="46"/></clipPath><clipPath id="wr"><rect x="93.1" y="0" width="30" height="46"/></clipPath></defs><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><circle cx="3" cy="9" r="3.1" fill="currentColor" stroke="none"/><path d="M3 20V40"/><path d="M14 40V28a7 7 0 0 1 14 0V40M28 28a7 7 0 0 1 14 0V40"/><path d="M52 6V40"/><circle cx="62" cy="30" r="10"/><circle cx="91.5" cy="30" r="12.5" fill="currentColor" stroke="none" clip-path="url(#wl)"/><circle cx="91.5" cy="30" r="10" clip-path="url(#wr)"/><path d="M111 20L129 40M129 20L111 40"/></g></svg>`;

const svg = (body, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** The brand icons (see src/web/components/BrandIcons.tsx), as strings for the extension pages. */
export const brandIcon = {
  screener: (n) => svg('<circle cx="12" cy="12" r="8" stroke-dasharray="2.2 3.1"/>', n),
  letIn: (n) => svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>', n),
  feed: (n) => svg('<circle cx="5.5" cy="6.5" r="1.6" fill="currentColor" stroke="none"/><path d="M10 6.5h9M5 12h14M5 17.5h9"/>', n),
  imbox: (n) => svg('<path d="M10.5 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/><path d="M13.5 4a8 8 0 0 1 0 16z"/>', n),
};
