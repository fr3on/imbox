import type * as T from "@shared/types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getAccountId(): string | null {
  try {
    return localStorage.getItem("hey.accountId");
  } catch {
    return null;
  }
}

/** Current scope: a specific account id, or "all" for the unified inbox (default). */
export function getScope(): string {
  return getAccountId() ?? "all";
}

export function storeAccountId(id: string | null) {
  try {
    if (id) localStorage.setItem("hey.accountId", id);
    else localStorage.removeItem("hey.accountId");
  } catch {
    /* ignore */
  }
}

/** The zone this browser is in. Sent with every request, so no endpoint has to ask for it. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export async function request<R>(method: string, path: string, body?: unknown): Promise<R> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  headers["X-Account-Id"] = getScope();
  const zone = browserTimezone();
  if (zone) headers["X-Timezone"] = zone;
  const res = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    const p = location.pathname;
    if (!p.startsWith("/login") && !p.startsWith("/register")) {
      location.href = "/login?next=" + encodeURIComponent(p + location.search);
    }
    throw new ApiError(401, "Please log in");
  }
  const text = await res.text();
  // An error page from the platform in front of the app (Cloudflare's own, say) is HTML meant for a browser tab, not a sentence for a person.
  if (!res.ok && /^\s*<(!doctype|html)/i.test(text)) {
    throw new ApiError(res.status, res.status >= 500 ? "The server is too busy right now. Try again in a moment." : `The request didn't go through (${res.status}).`);
  }
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const body = data as T.ApiError | null;
    // A route that took the trouble to write a sentence for the person gets to say it.
    throw new ApiError(res.status, body?.message || humanize(body?.error || res.statusText || "Request failed"));
  }
  return data as R;
}

export function humanize(code: string): string {
  const map: Record<string, string> = {
    no_account: "Connect a Gmail account first.",
    account_disabled: "This account has been disabled.",
    invalid_credentials: "Wrong email or password.",
    setup_done: "This inbox already has an owner. Sign in instead.",
    unauthorized: "Please log in.",
    forbidden: "You don't have permission to do that.",
    not_found: "Not found.",
  };
  return map[code] || code.replace(/_/g, " ");
}

export const api = {
  get: <R>(path: string) => request<R>("GET", path),
  post: <R>(path: string, body?: unknown) => request<R>("POST", path, body ?? {}),
  put: <R>(path: string, body?: unknown) => request<R>("PUT", path, body ?? {}),
  patch: <R>(path: string, body?: unknown) => request<R>("PATCH", path, body ?? {}),
  del: <R>(path: string) => request<R>("DELETE", path),
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
