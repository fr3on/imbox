// This worker shows push notifications and handles their clicks. It caches nothing on purpose: installBuildWatcher in src/web/lib/update.ts
// polls /api/version and calls location.reload() when the server reports a new build. If this worker cached index.html or the JS bundle, that
// reload would serve the stale cached shell, the version would still look new, and the app would reload in a loop forever. The empty fetch
// listener below never calls respondWith, so every request falls through to the network exactly as if no worker were installed; it is there
// because Chrome has asked for a registered fetch handler before offering to install the app.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
// Push: the server sends a notification here when mail arrives and the app is not open. If a window of the app is in front, it
// announces things itself, so this stays quiet rather than showing the same thing twice.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "Imbox", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (wins.some((w) => w.focused)) return;
      await self.registration.showNotification(d.title || "Imbox", {
        body: d.body || "",
        tag: d.tag || undefined,
        icon: "/icon-192.png",
        badge: "/favicon-32.png",
        data: { link: d.link || "/" },
      });
    })(),
  );
});

// Where a notification may lead: a page of this app. Anything else (another site, a scheme that is not http) opens the front page instead.
function ownPage(link) {
  try {
    const url = new URL(link, self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

// A click brings the app forward at the right page, or opens it if it is closed.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = ownPage(event.notification.data && event.notification.data.link);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((w) => "focus" in w);
      if (win) {
        await win.focus();
        if ("navigate" in win) await win.navigate(link).catch(() => {});
        return;
      }
      await self.clients.openWindow(link);
    })(),
  );
});

// The browser may swap a subscription for a new one (the push service rotated it). Subscribe again the same way and tell the server which one
// it replaces, so mail keeps arriving without the person opening the app. This needs the person to be signed in; if not, the app asks again
// the next time it opens.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      if (!key) return;
      const sub = event.newSubscription || (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), replaces: old.endpoint }),
      });
    })().catch(() => {}),
  );
});
