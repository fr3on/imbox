import { call, ext, getConnection, refreshBadge } from "./lib.js";

// The toolbar count: asked for again every two minutes, whenever the browser starts, and whenever the connection changes.
const ALARM = "imbox-counts";

/** "Open the side panel when I click the icon" (Chrome and Edge; set on the settings page). On by default; off, the icon opens the popup. */
async function applyPanelBehavior() {
  if (!ext.sidePanel?.setPanelBehavior) return;
  const { dock } = await ext.storage.local.get("dock");
  await ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: dock !== false }).catch(() => {});
}
void applyPanelBehavior();


/** Show a native browser notification if the notifications API is available. */
async function showNotification(id, title, message) {
  if (!ext.notifications?.create) return;
  try {
    const iconUrl = ext.runtime?.getURL ? ext.runtime.getURL("icons/icon-128.png") : "icons/icon-128.png";
    const options = {
      type: "basic",
      iconUrl,
      title,
      message: message || " ",
    };
    await new Promise((resolve) => {
      try {
        const res = ext.notifications.create(id, options, (notifId) => resolve(notifId));
        if (res && typeof res.then === "function") {
          res.then(resolve).catch(() => resolve(null));
        }
      } catch {
        resolve(null);
      }
    });
  } catch (e) {
    console.warn("Could not display notification:", e);
  }
}

/** Check for new senders in the Screener and new mail in the Imbox, and notify. */
export async function checkNotifications() {
  const conn = await getConnection();
  if (!conn) return;

  const prefs = await ext.storage.local.get([
    "notifyScreener",
    "notifyImbox",
    "lastNotifiedScreenerAt",
    "lastNotifiedImboxAt",
    "notifiedKeys",
  ]);

  const screenerEnabled = prefs.notifyScreener !== false;
  const imboxEnabled = prefs.notifyImbox !== false;
  if (!screenerEnabled && !imboxEnabled) return;

  const isFirstRun = prefs.lastNotifiedScreenerAt == null && prefs.lastNotifiedImboxAt == null;
  let maxScreenerAt = prefs.lastNotifiedScreenerAt || 0;
  let maxImboxAt = prefs.lastNotifiedImboxAt || 0;
  const keys = new Set(Array.isArray(prefs.notifiedKeys) ? prefs.notifiedKeys : []);

  if (screenerEnabled) {
    try {
      const data = await call("/api/screener/waiting?limit=5", { conn });
      const senders = data?.senders || [];
      let count = 0;
      for (const s of senders) {
        const at = s.at || 0;
        const key = `screener:${s.email}:${at}`;
        if (isFirstRun) {
          if (at > maxScreenerAt) maxScreenerAt = at;
          keys.add(key);
        } else if (at > (prefs.lastNotifiedScreenerAt || 0) && !keys.has(key)) {
          keys.add(key);
          if (at > maxScreenerAt) maxScreenerAt = at;
          if (count < 3) {
            count++;
            const senderName = s.name ? `${s.name} (${s.email})` : s.email;
            const subject = s.subject || "(no subject)";
            await showNotification(`screener:${encodeURIComponent(s.email)}:${Date.now()}`, `New sender: ${senderName}`, subject);
          }
        }
      }
    } catch {
      /* ignore offline or network errors */
    }
  }

  if (imboxEnabled) {
    try {
      const data = await call("/api/imbox/recent?limit=5", { conn });
      const threads = data?.threads || [];
      let count = 0;
      for (const t of threads) {
        const at = t.at || 0;
        const key = `thread:${t.id}:${at}`;
        if (isFirstRun) {
          if (at > maxImboxAt) maxImboxAt = at;
          keys.add(key);
        } else if (t.unread && at > (prefs.lastNotifiedImboxAt || 0) && !keys.has(key)) {
          keys.add(key);
          if (at > maxImboxAt) maxImboxAt = at;
          if (count < 3) {
            count++;
            const senderName = t.name || t.email;
            const subject = t.subject || "(no subject)";
            await showNotification(`thread:${t.id}:${Date.now()}`, senderName, subject);
          }
        }
      }
    } catch {
      /* ignore offline or network errors */
    }
  }

  const boundedKeys = Array.from(keys).slice(-100);
  await ext.storage.local.set({
    lastNotifiedScreenerAt: maxScreenerAt || Date.now(),
    lastNotifiedImboxAt: maxImboxAt || Date.now(),
    notifiedKeys: boundedKeys,
  });
}

async function update() {
  await refreshBadge();
  await checkNotifications();
}

function setup() {
  ext.alarms.create(ALARM, { periodInMinutes: 2 });
  ext.contextMenus.removeAll(() => {
    // A mailto: link on any page: write to it here, or look through what they have sent.
    ext.contextMenus.create({ id: "write", title: "Write to this address in imbox", contexts: ["link"], targetUrlPatterns: ["mailto:*"] });
    ext.contextMenus.create({ id: "mail", title: "Show their mail in imbox", contexts: ["link"], targetUrlPatterns: ["mailto:*"] });
  });
  void update();
  void applyPanelBehavior();
}

ext.runtime.onInstalled.addListener(setup);
ext.runtime.onStartup.addListener(setup);
ext.alarms.onAlarm.addListener((a) => a.name === ALARM && void update());
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.server || changes.token) void update();
  if (changes.dock) void applyPanelBehavior();
});

/** The address in a mailto: link, without its query. */
function addressOf(link) {
  try {
    return decodeURIComponent(link.replace(/^mailto:/i, "").split("?")[0]).split(",")[0].trim();
  } catch {
    return "";
  }
}

ext.contextMenus.onClicked.addListener(async (info) => {
  const conn = await getConnection();
  if (!conn) return ext.runtime.openOptionsPage();
  const link = info.linkUrl ?? "";
  const address = addressOf(link);
  if (!address) return;
  const url = info.menuItemId === "write" ? `${conn.server}/compose?mailto=${encodeURIComponent(link)}` : `${conn.server}/search?q=${encodeURIComponent(`from:${address}`)}`;
  await ext.tabs.create({ url });
});

if (ext.notifications?.onClicked) {
  ext.notifications.onClicked.addListener(async (notificationId) => {
    const conn = await getConnection();
    if (!conn) return;
    let path = "/";
    if (notificationId.startsWith("screener:")) {
      path = "/screener";
    } else if (notificationId.startsWith("thread:")) {
      const parts = notificationId.split(":");
      const threadId = parts[1];
      path = threadId ? `/t/${threadId}` : "/";
    }
    await ext.tabs.create({ url: conn.server + path });
    try {
      await ext.notifications.clear(notificationId);
    } catch {}
  });
}

