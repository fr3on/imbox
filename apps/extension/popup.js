import { ApiError, call, ext, getConnection, showBadge, wordmark } from "./lib.js";
import { renderConnect } from "./connect.js";

const root = document.getElementById("root");
// The same page serves the toolbar popup and the browser's side panel (sidepanel.html). The panel stays open, so it lists more senders,
// keeps itself current, and does not close after a link.
const isPopWindow = document.body.classList.contains("pop-window");
// The side panel UI is the default interface across both the side panel and popup.
const SIDE = true;
// The panel shows three senders and the latest Imbox threads on one scroll; the popup only the next three senders.
const LIMIT = 3;
// Which view the panel is on survives its own refreshes (every minute, and when it comes back into view).
let agendaOpen = false;
let notifOpen = false;
let currentPaint = null;
const canDock = isPopWindow && !!(ext.sidePanel?.open || ext.sidebarAction?.open);
const ICON = {
  search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  open: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  gear: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  dock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  cal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4"/></svg>',
  info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  pen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  bell: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  mail: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  sender: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke-dasharray="2.2 3.1"/></svg>',
  sync: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  invite: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M10 16h4M12 14v4"/></svg>',
  agent: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>',
};

/** What the panel looks like before its first answer: grey shapes where the senders, the day and the threads will be. */
const SKELETON = `<div class="skel" role="status" aria-label="Loading">
  <div class="sk-h"><i class="sk" style="width:84px"></i></div>
  ${[0, 1, 2].map((i) => `<div class="sk-row"><i class="sk sk-av"></i><span><i class="sk" style="width:${[46, 58, 38][i]}%"></i><i class="sk" style="width:${[78, 68, 84][i]}%"></i></span></div>`).join("")}
  <div class="sk-h"><i class="sk" style="width:64px"></i></div>
  <i class="sk sk-ev"></i>
  <div class="sk-h"><i class="sk" style="width:96px"></i></div>
  ${[0, 1].map((i) => `<div class="sk-th"><i class="sk" style="width:${[34, 44][i]}%"></i><i class="sk" style="width:${[74, 62][i]}%"></i></div>`).join("")}
</div>`;

const TICK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const CROSS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const initials = (n) => (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const open = (server, path) => ext.tabs.create({ url: server + path }).then(() => isPopWindow && window.close());

/** Move from the popup to the side panel. Both calls must run straight from the click. */
async function dock() {
  try {
    if (ext.sidePanel?.open) {
      const win = await ext.windows.getCurrent();
      await ext.sidePanel.open({ windowId: win.id });
    } else {
      await ext.sidebarAction.open();
    }
    window.close();
  } catch {
    /* the browser refused; the popup simply stays */
  }
}

/** Which build this copy is: the version in its manifest, and the build id the zip was packed with. A copy loaded straight from the source folder has no id. */
async function installed() {
  const version = ext.runtime.getManifest().version;
  try {
    const res = await fetch(ext.runtime.getURL("build.json"));
    if (res.ok) return { version, build: String((await res.json()).build ?? "") };
  } catch {
    /* no build.json: not from a packed zip */
  }
  return { version, build: "" };
}

/** The build the server holds. Asks the server this copy is connected to, and nobody else. */
async function onServer(server) {
  const res = await fetch(`${server}/downloads/imbox-extension.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const j = await res.json();
  return { version: String(j.version ?? ""), build: String(j.build ?? "") };
}

const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** The About card: which version this is, which server it talks to, and a button that asks the server whether it holds a newer build. */
async function showAbout(server) {
  root.querySelector(".aboutscrim")?.remove();
  const mine = await installed();
  const { aboutCheckedAt } = await ext.storage.local.get("aboutCheckedAt");
  const scrim = document.createElement("div");
  scrim.className = "aboutscrim";
  let status = { kind: "idle" };
  const close = () => {
    scrim.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => e.key === "Escape" && (e.stopPropagation(), close());
  const label = `${mine.version}${mine.build ? ` (${mine.build})` : ""}`;
  const line = () => {
    if (status.kind === "check") return `<div class="abst"><i class="spin" role="status" aria-label="Checking"></i>Checking the server\u2026</div>`;
    if (status.kind === "ok") return `<div class="abst ok">\u2713 You have the latest build.</div>`;
    if (status.kind === "dev") return `<div class="abst">This copy was loaded from the source folder, so it can\u2019t be compared. The server has build ${esc(status.latest.build)}.</div>`;
    if (status.kind === "up") return `<div class="abst up">A newer build is available${status.latest.version ? ` (${esc(label)} \u2192 ${esc(status.latest.version)} ${esc(status.latest.build)})` : ""}.</div><div class="how"><b>To update</b><span>1. Download the zip and unzip it over the old folder.</span><span>2. Open the extensions page and press Reload on imbox.</span></div>`;
    if (status.kind === "err") return `<div class="abst">Couldn\u2019t reach ${esc(server.replace(/^https?:\/\//, ""))}. ${esc(status.message)}</div>`;
    return `<div class="abst">${aboutCheckedAt ? `Last checked ${ago(aboutCheckedAt)}.` : "Not checked yet."}</div>`;
  };
  const draw = () => {
    scrim.innerHTML = `<div class="about" role="dialog" aria-modal="true" aria-label="About imbox">
      <div class="abh"><b>imbox extension</b><button class="ghost" type="button" id="abx" aria-label="Close">${CROSS}</button></div>
      <div class="kv"><span>Version</span><span>${esc(label)}</span></div>
      <div class="kv"><span>Server</span><span>${esc(server.replace(/^https?:\/\//, ""))}</span></div>
      ${line()}
      <div class="abb"><button type="button" class="${status.kind === "up" ? "" : "pri"}" id="abchk"${status.kind === "check" ? " disabled" : ""}>Check for updates</button>${status.kind === "up" ? `<button type="button" class="pri" id="abdl">Download</button>` : ""}</div></div>`;
    scrim.querySelector("#abx").onclick = close;
    scrim.querySelector("#abchk").onclick = check;
    const dl = scrim.querySelector("#abdl");
    if (dl) dl.onclick = () => open(server, "/downloads/imbox-extension.zip");
  };
  async function check() {
    status = { kind: "check" };
    draw();
    try {
      const latest = await onServer(server);
      await ext.storage.local.set({ aboutCheckedAt: Date.now() });
      status = !mine.build ? { kind: "dev", latest } : latest.build && latest.build !== mine.build ? { kind: "up", latest } : { kind: "ok", latest };
    } catch (e) {
      status = { kind: "err", message: e?.message && !/failed to fetch|networkerror/i.test(e.message) ? e.message : "Check your connection." };
    }
    draw();
  }
  scrim.addEventListener("click", (e) => e.target === scrim && close());
  document.addEventListener("keydown", onKey, true);
  root.append(scrim);
  draw();
  scrim.querySelector("#abchk").focus();
}

async function draw() {
  const conn = await getConnection();
  if (!conn) {
    root.innerHTML = `<div class="head">${wordmark()}</div><div id="form"></div>`;
    return renderConnect(root.querySelector("#form"), draw);
  }
  // Once the panel has shown its content, a refresh keeps it on screen and swaps in the new numbers, instead of starting over with a placeholder.
  if (!root.querySelector("#body[data-ready]")) root.innerHTML = `
    <div class="head">${wordmark()}<span class="sp"></span><button class="ghost notif-bell" type="button" id="notif-btn" aria-label="Notifications" title="Notifications">${ICON.bell}<span class="nbadge" id="nbadge" hidden></span></button>${canDock ? `<button class="ghost" type="button" id="dock" aria-label="Open in side panel" title="Open in side panel">${ICON.dock}</button>` : ""}<button class="ghost" type="button" id="about" aria-label="About imbox" title="About imbox">${ICON.info}</button><button class="ghost" type="button" id="settings" aria-label="Settings">${ICON.gear}</button></div>
    <div id="body" aria-busy="true">${SKELETON}</div>
    <form class="find" id="find" role="search" hidden>${ICON.search}<input id="q" type="search" placeholder="Search your mail" aria-label="Search your mail"><button class="ghost" type="button" id="findx" aria-label="Close search">${CROSS}</button></form>
    <div class="cmd" id="cmd">
      <button type="button" id="dosearch">${ICON.search}Search<kbd>/</kbd></button>
      <button type="button" id="write">${ICON.pen}Write<kbd>c</kbd></button>
      ${SIDE ? `<button type="button" id="event">${ICON.cal}Event</button>` : `<button type="button" id="home">${ICON.open}Open<kbd>o</kbd></button>`}
    </div>`;
  const { server } = conn;
  const cmd = root.querySelector("#cmd");
  const find = root.querySelector("#find");
  const q = root.querySelector("#q");
  const showSearch = (on) => {
    find.hidden = !on;
    cmd.hidden = on;
    if (on) q.focus();
  };
  const homeBtn = root.querySelector("#home");
  if (homeBtn) homeBtn.onclick = () => open(server, "/");
  const eventBtn = root.querySelector("#event");
  if (eventBtn) eventBtn.onclick = () => open(server, "/calendar?new=1");
  root.querySelector("#write").onclick = () => open(server, "/compose");
  root.querySelector("#settings").onclick = () => ext.runtime.openOptionsPage();
  root.querySelector("#about").onclick = () => showAbout(server);
  const notifBtn = root.querySelector("#notif-btn");
  if (notifBtn) {
    notifBtn.onclick = () => {
      notifOpen = !notifOpen;
      if (notifOpen) agendaOpen = false;
      currentPaint?.();
    };
  }
  const dockBtn = root.querySelector("#dock");
  if (dockBtn) dockBtn.onclick = dock;
  root.querySelector("#dosearch").onclick = () => showSearch(true);
  root.querySelector("#findx").onclick = () => showSearch(false);
  // Handlers are set as properties, not added: the panel keeps these elements across its refreshes, and an added listener would pile up, one more each minute.
  find.onsubmit = (e) => {
    e.preventDefault();
    const term = q.value.trim();
    if (term) open(server, `/search?q=${encodeURIComponent(term)}`);
  };
  q.onkeydown = (e) => e.key === "Escape" && (e.preventDefault(), showSearch(false));
  // One key each, when nothing is being typed.
  document.onkeydown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea")) return;
    const k = { "/": () => showSearch(true), c: () => open(server, "/compose"), o: () => open(server, "/") }[e.key];
    if (k) {
      e.preventDefault();
      k();
    }
  };
  const body = root.querySelector("#body");
  try {
    const [counts, waiting, recent, agenda, notifs] = await Promise.all([
      call("/api/counts"),
      call(`/api/screener/waiting?limit=${LIMIT}`),
      // The panel lists the latest Imbox threads too. An older server, or a token made before this existed, answers without them.
      SIDE ? call("/api/imbox/recent?limit=4").catch(() => ({ threads: [] })) : Promise.resolve({ threads: [] }),
      // And the next days of the calendar, the same way: left out when the server cannot answer.
      SIDE ? call("/api/calendar/agenda?days=14").catch(() => null) : Promise.resolve(null),
      call("/api/notifications").catch(() => null),
    ]);
    const notifData = getNotificationItems(notifs, waiting, recent.threads);
    const badge = root.querySelector("#nbadge");
    if (badge) {
      const u = notifData.unread ?? 0;
      if (u > 0) {
        badge.hidden = false;
        badge.textContent = u > 9 ? "9+" : String(u);
        badge.classList.add("has-num");
      } else {
        badge.hidden = true;
        badge.textContent = "";
        badge.classList.remove("has-num");
      }
    }
    await showBadge(counts.screener ?? 0);
    paint(body, server, counts, waiting, recent.threads, agenda, notifData);
    body.dataset.ready = "1";
    body.removeAttribute("aria-busy");
  } catch (e) {
    delete body.dataset.ready;
    if (e instanceof ApiError && e.status === 401) return draw();
    body.innerHTML = `<div class="note">${esc(e.message || "Something went wrong.")} <button class="ghost" id="retry" type="button">Try again</button></div>`;
    body.querySelector("#retry").onclick = draw;
    await showBadge("error");
  }
}

/** Build unified notification items from server /api/notifications or synthesize from waiting senders + threads */
function getNotificationItems(notifs, waiting, threads) {
  if (notifs && Array.isArray(notifs.items)) {
    return {
      items: notifs.items,
      unread: notifs.unread ?? 0,
      seen_at: notifs.seen_at ?? 0,
    };
  }
  const items = [];
  if (waiting && Array.isArray(waiting.senders)) {
    for (const s of waiting.senders) {
      items.push({
        id: `sender:${s.email}`,
        kind: "sender",
        title: s.name ? `${s.name} (${s.email})` : s.email,
        body: s.subject || "Waiting in the Screener",
        link: "/screener",
        at: s.at || Date.now(),
        mailbox: "",
        unread: true,
      });
    }
  }
  if (Array.isArray(threads)) {
    for (const t of threads) {
      items.push({
        id: `mail:${t.id}`,
        kind: "mail",
        title: t.name || t.email,
        body: t.subject || "(no subject)",
        link: `/t/${t.id}`,
        at: t.at || Date.now(),
        mailbox: "",
        unread: !!t.unread,
      });
    }
  }
  items.sort((a, b) => b.at - a.at);
  const unread = items.filter((i) => i.unread).length;
  return { items, unread, seen_at: 0 };
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
const dayName = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
};
const span = (e) => (e.all_day ? "All day" : `${clock(e.starts_at)} \u2013 ${clock(e.ends_at)}`);
/** One event. Joining opens its call link; anywhere else opens that day in imbox. */
const eventHtml = (e, date, now, next) => {
  const live = !e.all_day && e.starts_at <= now && now < e.ends_at;
  const past = !e.all_day && e.ends_at <= now;
  const color = /^#[0-9a-f]{3,8}$/i.test(e.color || "") ? e.color : "";
  return `<div class="ev${e.all_day ? " allday" : ""}${e.tentative ? " maybe" : ""}${live ? " now" : ""}${past ? " past" : ""}" role="button" tabindex="0" data-day="${esc(date)}"${color ? ` style="--c:${color}"` : ""}><i></i><span class="evt"><b>${esc(e.title || "(no title)")}</b><span>${live ? "Now \u00b7 " : next ? "Next \u00b7 " : ""}${esc(span(e))}</span></span>${e.join && /^https?:/i.test(e.join) && !past ? `<button class="evj" type="button" data-join="${esc(e.join)}">Join</button>` : ""}</div>`;
};

function paint(body, server, counts, waiting, threads, agenda, notifData) {
  const state = { counts: { ...counts }, senders: [...waiting.senders], total: waiting.total };
  const render = () => {
    currentPaint = render;
    const notifBtn = root.querySelector("#notif-btn");
    if (notifBtn) notifBtn.classList.toggle("active", notifOpen);

    if (notifOpen) {
      const unreadCount = notifData.unread ?? 0;
      const seenAt = notifData.seen_at ?? 0;
      const items = notifData.items ?? [];
      body.innerHTML = `
        <div class="sec"><h2>Notifications</h2><button type="button" data-notif="0">\u2190 Back</button></div>
        ${unreadCount > 0 ? `<div class="notif-bar"><span>${unreadCount} unread</span><button type="button" id="mark-seen">Mark all seen</button></div>` : ""}
        ${
          items.length
            ? items
                .map((n) => {
                  const unread = n.unread ?? (n.at > seenAt);
                  const ic = ICON[n.kind] || ICON.mail;
                  return `<button type="button" class="nth" data-go="${esc(n.link)}"><span class="dot${unread ? "" : " r"}" aria-hidden="true"></span><span class="nic">${ic}</span><span class="ninfo"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><small>${esc(ago(n.at))}${n.mailbox ? ` \u00b7 ${esc(n.mailbox)}` : ""}</small></span></button>`;
                })
                .join("")
            : '<p class="empty">You\u2019re all caught up.</p>'
        }`;
      const markBtn = body.querySelector("#mark-seen");
      if (markBtn) {
        markBtn.onclick = async () => {
          try {
            await call("/api/notifications/seen", { method: "POST" });
          } catch {}
          notifData.unread = 0;
          notifData.seen_at = Date.now();
          for (const item of notifData.items) item.unread = false;
          const badge = root.querySelector("#nbadge");
          if (badge) {
            badge.hidden = true;
            badge.textContent = "";
            badge.classList.remove("has-num");
          }
          render();
        };
      }
      return;
    }
    const c = state.counts;
    const waitingN = c.screener ?? 0;
    const updates = (c.feed_new ?? 0) + (c.paper_trail_new ?? 0);
    const note = `<button type="button" data-go="/">${c.imbox_new ?? 0} new in Imbox</button><span aria-hidden="true"> · </span><button type="button" data-go="/updates">${updates} updates</button>`;
    const senderRows = state.senders
      .map(
        (s) => `<div class="row" data-id="${esc(s.contact_id)}"><span class="av" aria-hidden="true">${esc(initials(s.name || s.email))}</span>
                  <div class="who"><b>${esc(s.name || s.email)}</b><span>${esc(s.subject || s.email)}</span></div>
                  <span class="quick"><button class="ib p" type="button" data-decide="imbox" aria-label="Let in ${esc(s.name || s.email)}" title="Let in">${TICK}</button><button class="ib" type="button" data-decide="screened_out" aria-label="Keep out ${esc(s.name || s.email)}" title="Keep out">${CROSS}</button></span></div>`,
      )
      .join("");
    if (SIDE && agendaOpen && agenda) {
      // The full agenda: every day with something on it (and today, even when empty), each event a way to that day in imbox.
      const now = Date.now();
      body.innerHTML = `<div class="sec"><h2>Agenda</h2><button type="button" data-agenda="0">\u2190 Back</button></div>${agenda.days
        .filter((d, i) => i === 0 || d.events.length)
        .map((d, i) => `<div class="day${d.date === agenda.today ? " today" : ""}">${esc(dayName(d.date))}${d.date === agenda.today ? "<small>Today</small>" : ""}</div>${d.events.length ? d.events.map((e) => eventHtml(e, d.date, now, false)).join("") : '<p class="empty">Nothing on.</p>'}`)
        .join("")}`;
      return;
    }
    if (SIDE) {
      // One scroll: the door, today's events, the latest Imbox threads, notifications, then a count for each place left.
      const now = Date.now();
      const today = agenda?.days[0] ? agenda.days[0] : null;
      const nextId = today ? today.events.find((e) => !e.all_day && e.ends_at > now && e.starts_at > now)?.id : null;
      const todaySection = today
        ? `<div class="sec"><h2>Today \u00b7 ${today.events.length} ${today.events.length === 1 ? "event" : "events"}</h2><button type="button" data-agenda="1">See agenda</button></div>${today.events.length ? today.events.map((e) => eventHtml(e, today.date, now, e.id === nextId && !today.events.some((x) => !x.all_day && x.starts_at <= now && now < x.ends_at))).join("") : '<p class="empty">Nothing on today.</p>'}`
        : "";
      body.innerHTML = `
        <div class="sec"><h2>At the door \u00b7 <span class="${waitingN > 0 ? "hot" : ""}">${waitingN}</span></h2><button type="button" data-go="${waitingN > 0 ? "/screener" : "/"}">${waitingN > 0 ? "Review all" : "Open"}</button></div>
        ${senderRows ? `<div class="stack">${senderRows}</div>` : `<p class="empty">Nobody is waiting at the door.</p>`}
        ${todaySection}
        <div class="sec"><h2>Imbox \u00b7 latest</h2><button type="button" data-go="/">Open</button></div>
        ${
          threads.length
            ? threads
                .map(
                  (t) => `<button type="button" class="th" data-go="/t/${esc(t.id)}"><span class="dot${t.unread ? "" : " r"}" aria-hidden="true"></span><span class="who"><b>${esc(t.name || t.email)}</b><span>${esc(t.subject)}</span><em>${esc(t.snippet)}</em></span></button>`,
                )
                .join("")
            : `<p class="empty">${(c.imbox_new ?? 0) > 0 ? `${c.imbox_new} new in Imbox.` : "Nothing new in Imbox."}</p>`
        }`;
      return;
    }
    body.innerHTML = `
      <div class="hero">
        <div class="big${waitingN > 0 ? " hot" : ""}">${waitingN}</div>
        <div class="lab">${waitingN === 0 ? "Nobody is waiting at the door" : waitingN === 1 ? "sender is waiting at the door" : "senders are waiting at the door"}</div>
        <div class="sub">${note}</div>
      </div>
      ${
        state.senders.length
          ? `<div class="stack">${state.senders
              .map(
                (s) => `<div class="row" data-id="${esc(s.contact_id)}"><span class="av" aria-hidden="true">${esc(initials(s.name || s.email))}</span>
                  <div class="who"><b>${esc(s.name || s.email)}</b><span>${esc(s.subject || s.email)}</span></div>
                  <span class="quick"><button class="ib p" type="button" data-decide="imbox" aria-label="Let in ${esc(s.name || s.email)}" title="Let in">${TICK}</button><button class="ib" type="button" data-decide="screened_out" aria-label="Keep out ${esc(s.name || s.email)}" title="Keep out">${CROSS}</button></span></div>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="act"><button class="btn p" type="button" data-go="${waitingN > 0 ? "/screener" : "/"}">${waitingN > 0 ? (waitingN === 1 ? "Review sender" : `Review all ${waitingN}`) : "Open imbox"}</button></div>`;
  };
  render();
  const openEvent = (e) => {
    const join = e.target.closest("[data-join]");
    if (join) {
      ext.tabs.create({ url: join.getAttribute("data-join") });
      return true;
    }
    const ev = e.target.closest(".ev[data-day]");
    if (ev) {
      open(server, `/calendar?d=${encodeURIComponent(ev.getAttribute("data-day"))}&v=day`);
      return true;
    }
    return false;
  };
  // As above: set once per paint, replacing the last, so one click opens one tab however long the panel has been open.
  body.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && e.target.matches?.(".ev") && (e.preventDefault(), openEvent(e));
  body.onclick = async (e) => {
    const no = e.target.closest("[data-notif]");
    if (no) {
      notifOpen = no.getAttribute("data-notif") === "1";
      if (notifOpen) agendaOpen = false;
      return render();
    }
    const ag = e.target.closest("[data-agenda]");
    if (ag) {
      agendaOpen = ag.getAttribute("data-agenda") === "1";
      if (agendaOpen) notifOpen = false;
      return render();
    }
    if (openEvent(e)) return;
    const go = e.target.closest("[data-go]");
    if (go) return open(server, go.getAttribute("data-go"));
    const btn = e.target.closest("[data-decide]");
    if (!btn) return;
    const row = btn.closest(".row");
    const id = row.getAttribute("data-id");
    row.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await call("/api/screener/decide", { method: "POST", body: { contact_id: id, decision: btn.getAttribute("data-decide"), scope: "all" } });
      state.senders = state.senders.filter((s) => s.contact_id !== id);
      state.counts.screener = Math.max(0, (state.counts.screener ?? 1) - 1);
      render();
      await showBadge(state.counts.screener);
      // The list is a few long: bring up the next senders now that room has been made.
      if (state.senders.length < Math.min(LIMIT, state.counts.screener)) {
        const more = await call(`/api/screener/waiting?limit=${LIMIT}`);
        state.senders = more.senders;
        state.counts.screener = more.total;
        render();
        await showBadge(more.total);
      }
    } catch (x) {
      row.querySelectorAll("button").forEach((b) => (b.disabled = false));
      body.insertAdjacentHTML("afterbegin", `<div class="note">${esc(x.message || "That did not work.")}</div>`);
    }
  };
}

draw();

// The panel stays open: look again every minute, and when it comes back into view, unless a search is being typed.
if (SIDE) {
  const again = () => !document.hidden && !document.querySelector("#q:focus") && draw();
  setInterval(again, 60_000);
  document.addEventListener("visibilitychange", again);
}
