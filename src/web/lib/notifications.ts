import { isNative, isDesktop, native } from "./native";

// Browser notifications for new mail and alerts. The browser's own permission (granted/denied/default) is
// the real gate and can only ever be loosened by the person, never by us — this only adds a
// second, softer on/off switch on top of it (localStorage) so someone who granted permission once
// can still turn the feature off without having to dig into browser settings to revoke it.
const ENABLED_KEY = "inbox.notify.enabled";
const SOUND_KEY = "inbox.notify.sound";
const TYPES_KEY = "inbox.notify.types";

export interface NotificationTypePrefs {
  mail: boolean;
  sender: boolean;
  sync: boolean;
  agent: boolean;
  invite: boolean;
}

const DEFAULT_TYPE_PREFS: NotificationTypePrefs = {
  mail: true,
  sender: true,
  sync: true,
  agent: true,
  invite: true,
};

export function notifySupported(): boolean {
  return typeof window !== "undefined" && ("Notification" in window || isNative);
}

export function notifyPermission(): NotificationPermission | "unsupported" {
  if (isNative) return "granted";
  return notifySupported() && "Notification" in window ? Notification.permission : "unsupported";
}

/** The soft switch: on by default once permission is granted, until someone turns it off here. */
export function notifyPrefEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== "0";
}

export function setNotifyPref(on: boolean) {
  localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
}

export function notifySoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) !== "0";
}

export function setNotifySound(on: boolean) {
  localStorage.setItem(SOUND_KEY, on ? "1" : "0");
}

export function getNotificationTypePrefs(): NotificationTypePrefs {
  try {
    const raw = localStorage.getItem(TYPES_KEY);
    if (!raw) return DEFAULT_TYPE_PREFS;
    return { ...DEFAULT_TYPE_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TYPE_PREFS;
  }
}

export function setNotificationTypePref<K extends keyof NotificationTypePrefs>(key: K, enabled: boolean) {
  const current = getNotificationTypePrefs();
  current[key] = enabled;
  localStorage.setItem(TYPES_KEY, JSON.stringify(current));
}

/** Whether a notification would actually fire right now. */
export function notifyActive(): boolean {
  if (isNative) return notifyPrefEnabled();
  return notifySupported() && "Notification" in window && Notification.permission === "granted" && notifyPrefEnabled();
}

export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (isNative) {
    setNotifyPref(true);
    return "granted";
  }
  if (!notifySupported() || !("Notification" in window)) return "denied";
  const p = await Notification.requestPermission();
  if (p === "granted") setNotifyPref(true);
  return p;
}

/** Clean synthesized two-tone chime via Web Audio API. Requires no external audio assets. */
let audioCtx: AudioContext | null = null;
export function playNotificationSound() {
  if (typeof window === "undefined" || !notifySoundEnabled()) return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    const t = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, t); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, t + 0.09); // A5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(880, t + 0.08);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start(t);
    osc1.stop(t + 0.32);
    osc2.start(t + 0.08);
    osc2.stop(t + 0.32);
  } catch {
    /* ignore audio policy blocks */
  }
}

/** Synchronize unread count to macOS Dock and browser PWA badge. */
export function syncAppBadge(count: number) {
  const safeCount = Math.max(0, Math.floor(count));
  if (isDesktop) {
    native.setBadge(safeCount);
  }
  if (typeof navigator !== "undefined" && "setAppBadge" in navigator) {
    if (safeCount > 0) {
      navigator.setAppBadge(safeCount).catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
  }
}

/**
 * Deliver a notification for any item (mail, sender, sync, agent, invite).
 * Respects sound, active window focus, native shell bridge, and granular type preferences.
 */
export function notifyNewItem(
  kind: "mail" | "sender" | "sync" | "invite" | "agent",
  title: string,
  body: string,
  onOpen?: () => void,
  tag = `inbox-${kind}`,
  link?: string
) {
  const typePrefs = getNotificationTypePrefs();
  if (typePrefs[kind] === false) return;
  if (!notifyActive()) return;

  // Always play soft sound chime if window is not focused or if native
  if (!document.hasFocus() || isNative) {
    playNotificationSound();
  }

  // Native macOS Tauri app delivery
  if (isNative) {
    native.notify(title, body, link);
    return;
  }

  // Web Browser delivery: skip only when looking directly at the window
  if (document.hasFocus()) return;
  try {
    const n = new Notification(title, { body, tag, icon: "/logo.svg" });
    n.onclick = () => {
      window.focus();
      onOpen?.();
      n.close();
    };
  } catch {
    /* safe to ignore */
  }
}

/** Convenience wrapper for new mail notifications. */
export function notifyNewMail(title: string, body: string, onOpen?: () => void, tag = "inbox-mail") {
  notifyNewItem("mail", title, body, onOpen, tag);
}
