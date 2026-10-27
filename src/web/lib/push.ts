import { api } from "../api";
import { isNative } from "./native";
import { getNotificationTypePrefs, notifyPermission, notifyPrefEnabled } from "./notifications";

// Web Push: the server sends a notification through the browser's own push service, and the service worker shows it, so it arrives
// with the app closed. The browser keeps a subscription; the server keeps the other half.
const OFF_KEY = "inbox.push.off";

export function pushSupported(): boolean {
  return !isNative && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Turned off on purpose in Settings; never switched back on behind the person's back. */
export function pushDisabledByUser(): boolean {
  return localStorage.getItem(OFF_KEY) === "1";
}

const keyBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Whether this browser is subscribed and the server knows it. */
export async function pushActive(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  try {
    return (await api.post<{ subscribed: boolean }>("/api/push/status", { endpoint: sub.endpoint })).subscribed;
  } catch {
    return false;
  }
}

/** Subscribe this browser (asks nothing of the person beyond the notification permission they already gave) and tell the server. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || notifyPermission() !== "granted") return false;
  const reg = await registration();
  if (!reg) return false;
  const { key } = await api.get<{ key: string }>("/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api.post("/api/push/subscribe", { ...sub.toJSON(), types: getNotificationTypePrefs() });
  localStorage.removeItem(OFF_KEY);
  return true;
}

export async function disablePush(): Promise<void> {
  localStorage.setItem(OFF_KEY, "1");
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Tell the server which kinds this browser wants, after the person changes them. */
export async function syncPushTypes(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await api.put("/api/push/types", { endpoint: sub.endpoint, types: getNotificationTypePrefs() }).catch(() => {});
}

/**
 * Once the person has allowed notifications, make sure this browser is set up for push, unless they turned it off. Safe to call often:
 * a browser that is already subscribed and known to the server does nothing.
 */
export async function ensurePush(): Promise<void> {
  if (!pushSupported() || pushDisabledByUser() || notifyPermission() !== "granted" || !notifyPrefEnabled()) return;
  try {
    if (!(await pushActive())) await enablePush();
  } catch {
    // The browser or its push service said no; the page's own notifications still work.
  }
}

export async function sendTestPush(): Promise<{ delivered: number; devices: number }> {
  return api.post("/api/push/test", {});
}
