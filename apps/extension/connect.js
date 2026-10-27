import { ext, call, clearConnection, normalizeServer, refreshBadge, saveConnection } from "./lib.js";

/**
 * The form that connects the extension to a server: its address and a token made in Settings. Pressing Connect asks the browser for permission
 * to reach that one address (never every site), checks the token with a real call, and only then saves it.
 */
export function renderConnect(root, onDone) {
  root.innerHTML = `
    <form class="form" id="connect">
      <h1>Connect to your imbox</h1>
      <ol class="steps">
        <li>In imbox, open <b>Settings</b>, then <b>Integrations</b>, then <b>Browser extension</b>.</li>
        <li>Copy your server address and make a token.</li>
      </ol>
      <p class="fine">The token can read your counts and decide about new senders, and nothing else.</p>
      <div class="error" id="err" hidden role="alert"></div>
      <label class="fld"><span>Server address</span><input id="server" type="text" inputmode="url" placeholder="https://imbox.example.com" autocomplete="off" required></label>
      <label class="fld"><span>Token</span><input id="token" type="password" placeholder="imx_…" autocomplete="off" spellcheck="false" required><small>Stored in this browser only. You can remove it in imbox at any time.</small></label>
      <button class="btn p" type="submit" id="go">Connect</button>
    </form>`;
  const form = root.querySelector("#connect");
  const err = root.querySelector("#err");
  const fail = (m) => {
    err.textContent = m;
    err.hidden = false;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const server = normalizeServer(root.querySelector("#server").value);
    const token = root.querySelector("#token").value.trim();
    if (!server) return fail("Enter the address of your server, starting with https://.");
    if (!/^imx_[0-9a-f]{40}$/.test(token)) return fail("That does not look like an imbox token. It starts with imx_.");
    const go = root.querySelector("#go");
    go.disabled = true;
    go.textContent = "Connecting…";
    try {
      // The permission has to be asked for from this click.
      const granted = await ext.permissions.request({ origins: [`${server}/*`] });
      if (!granted) throw new Error("The browser did not allow access to that address.");
      await call("/api/counts", { conn: { server, token } });
      await saveConnection(server, token);
      await refreshBadge();
      onDone();
    } catch (x) {
      fail(x.status === 401 ? "imbox does not know that token. Check that you copied all of it." : x.message || "Could not connect.");
      go.disabled = false;
      go.textContent = "Connect";
    }
  });
}

export async function disconnect() {
  await clearConnection();
  await refreshBadge();
}
