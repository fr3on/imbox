import { brandIcon, call, ext, getConnection, wordmark } from "./lib.js";
import { disconnect, renderConnect } from "./connect.js";

const root = document.getElementById("root");
document.getElementById("wm").innerHTML = wordmark(22);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function draw() {
  const conn = await getConnection();
  if (!conn) {
    root.innerHTML = '<section class="card" id="form"></section>';
    return renderConnect(root.querySelector("#form"), draw);
  }
  const host = new URL(conn.server).host;
  const { dock, notifyScreener, notifyImbox } = await ext.storage.local.get(["dock", "notifyScreener", "notifyImbox"]);
  root.innerHTML = `
    <section class="card status">
      <div class="st-top"><span class="dot" aria-hidden="true">${brandIcon.letIn(20)}</span>
        <div><h1>Connected</h1><p class="host" title="${esc(conn.server)}">${esc(host)}</p></div>
        <span class="live" id="live" aria-live="polite"></span></div>
      <p class="lead">The number on the toolbar icon is how many senders are waiting in your Screener.</p>
    </section>

    <section class="card">
      <h2>Notifications</h2>
      <p>Get notified on your desktop when new messages or senders arrive, even when imbox is not open.</p>
      <label class="tog"><input type="checkbox" id="notify-screener"${notifyScreener !== false ? " checked" : ""}><span>New senders waiting in the Screener</span></label>
      <label class="tog"><input type="checkbox" id="notify-imbox"${notifyImbox !== false ? " checked" : ""}><span>New emails in your Imbox</span></label>
    </section>

    <section class="card">
      <h2>What it does</h2>
      <ul class="feat">
        <li>${brandIcon.screener(18)}<div><b>Counts the door</b><span>The Screener number sits on the toolbar icon and updates on its own.</span></div></li>
        <li>${brandIcon.letIn(18)}<div><b>Decide from any tab</b><span>Let a sender in, or keep them out, without opening imbox.</span></div></li>
        <li>${brandIcon.feed(18)}<div><b>Stays out of your browsing</b><span>It talks only to your server. It cannot read other sites or the pages you visit.</span></div></li>
      </ul>
    </section>

    <section class="card">
      <h2>In the popup</h2>
      <dl class="keys"><div><dt><kbd>/</kbd></dt><dd>Search your mail</dd></div><div><dt><kbd>c</kbd></dt><dd>Write a message</dd></div><div><dt><kbd>o</kbd></dt><dd>Open imbox</dd></div></dl>
    </section>

    ${
      ext.sidePanel?.setPanelBehavior
        ? `<section class="card">
      <h2>Side panel</h2>
      <p>The popup can also stay open beside the page, with more senders and a count that keeps itself current. Use the panel button in the popup to open it once.</p>
      <label class="tog"><input type="checkbox" id="dock"${dock !== false ? " checked" : ""}><span>Open the side panel when I click the icon</span></label>
    </section>`
        : ""
    }

    <section class="card off">
      <div><h2>Disconnect this browser</h2>
      <p>This only forgets the token here. To make it stop working everywhere, remove it in imbox under Settings, Integrations, Browser extension.</p></div>
      <div class="offact" id="offact"><button class="btn" id="off" type="button">Disconnect</button></div>
    </section>`;
  root.querySelector("#dock")?.addEventListener("change", (e) => ext.storage.local.set({ dock: e.target.checked }));
  root.querySelector("#notify-screener")?.addEventListener("change", (e) => ext.storage.local.set({ notifyScreener: e.target.checked }));
  root.querySelector("#notify-imbox")?.addEventListener("change", (e) => ext.storage.local.set({ notifyImbox: e.target.checked }));
  const offact = root.querySelector("#offact");
  offact.addEventListener("click", async (e) => {
    const id = e.target.closest("button")?.id;
    if (id === "off") {
      offact.innerHTML = '<button class="btn danger" id="yes" type="button">Yes, disconnect</button><button class="btn" id="no" type="button">Cancel</button>';
      offact.querySelector("#yes").focus();
    } else if (id === "no") {
      offact.innerHTML = '<button class="btn" id="off" type="button">Disconnect</button>';
    } else if (id === "yes") {
      await disconnect();
      draw();
    }
  });
  // Show that the connection works, with the live number.
  const live = root.querySelector("#live");
  try {
    const c = await call("/api/counts");
    const n = c.screener ?? 0;
    live.textContent = n === 0 ? "Nobody waiting" : `${n} waiting`;
    live.classList.toggle("hot", n > 0);
  } catch (e) {
    live.textContent = e.status === 401 ? "Token not accepted" : "Can\u2019t reach it";
    live.classList.add("bad");
  }
}
draw();
