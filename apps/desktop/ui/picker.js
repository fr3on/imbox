// The Mac app's connect and sign-in steps. The window injects this as an initialization script (see lib.rs),
// because scripts inside the bundled page do not run in this webview. It does nothing on any other page.
(function () {
  if (location.protocol !== "tauri:" && location.hostname !== "tauri.localhost") return;

  function start() {
    var ipc = window.__TAURI_INTERNALS__;
    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var steps = {};
    document.querySelectorAll("[data-step]").forEach(function (el) { steps[el.getAttribute("data-step")] = el; });
    if (!steps.server) return;
    if (!ipc) {
      steps.server.hidden = false;
      $(".msg", steps.server).textContent = "This page needs the imbox app to run.";
      return;
    }
    var call = function (cmd, args) { return ipc.invoke(cmd, args || {}); };
    var text = function (e) { return typeof e === "string" ? e : (e && e.message) || "Something went wrong."; };

    var state = { server: null, email: "", ticket: null, recovery: false };

    function setBusy(form, busy, label, idle) {
      var b = $(".primary", form);
      b.disabled = busy;
      b.textContent = busy ? label : idle;
    }
    function say(form, message) { $(".msg", form).textContent = message || ""; }
    function show(name, message) {
      Object.keys(steps).forEach(function (k) { steps[k].hidden = k !== name; });
      var form = $("form", steps[name]);
      say(form, message);
      var field = $("input", steps[name]);
      if (field) setTimeout(function () { field.focus(); field.select(); }, 0);
      if (name === "email") $("[data-server-name]").textContent = state.server ? new URL(state.server).host : "";
      if (name === "password") $("[data-email-name]").textContent = state.email;
    }

    // Typing clears a shown error.
    document.querySelectorAll("input").forEach(function (i) {
      i.addEventListener("input", function () { say($("form", i.closest("section")), ""); });
    });

    document.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () {
        var to = b.getAttribute("data-go");
        if (to === "email") $("#password").value = "";
        if (to === "password") $("#code").value = "";
        show(to);
      });
    });

    // Passkeys need a page on the server's own origin, so they continue on the website's sign-in page.
    document.querySelectorAll("[data-passkey]").forEach(function (b) {
      b.addEventListener("click", function () {
        call("open_web_login").catch(function (e) { say($("form", b.closest("section")), text(e)); });
      });
    });

    // Show or hide the password.
    var eye = $("[data-eye]");
    eye.addEventListener("click", function () {
      var pw = $("#password");
      var visible = pw.type === "password";
      pw.type = visible ? "text" : "password";
      $(".slash", eye).hidden = !visible;
      eye.setAttribute("aria-label", visible ? "Hide password" : "Show password");
      pw.focus();
    });
    var caps = function (e) { $("[data-caps]").hidden = !(e.getModifierState && e.getModifierState("CapsLock")); };
    $("#password").addEventListener("keydown", caps);
    $("#password").addEventListener("keyup", caps);

    // 1. Server
    $("[data-form=server]").addEventListener("submit", async function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      say(form, "");
      setBusy(form, true, "Checking", "Connect");
      try {
        var url = await call("probe_server", { url: $("#server").value });
        await call("save_server", { url: url });
        state.server = url;
        show("email");
      } catch (err) {
        say(form, text(err));
      } finally {
        setBusy(form, false, "Checking", "Connect");
      }
    });

    // 2. Email
    $("[data-form=email]").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = $("#email").value.trim();
      if (!v) return say(e.currentTarget, "Enter your email.");
      state.email = v;
      show("password");
    });

    // 3. Password
    $("[data-form=password]").addEventListener("submit", async function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var password = $("#password").value;
      if (!password) return say(form, "Enter your password.");
      say(form, "");
      setBusy(form, true, "Signing in…", "Sign in");
      try {
        var r = await call("sign_in", { email: state.email, password: password });
        if (r.status === "mfa") {
          state.ticket = r.ticket;
          state.recovery = false;
          $("#code").value = "";
          setRecovery(false);
          show("code");
        }
        // Otherwise the window is already opening the server.
      } catch (err) {
        say(form, text(err));
      } finally {
        setBusy(form, false, "Signing in…", "Sign in");
      }
    });

    // 4. Code
    function setRecovery(on) {
      state.recovery = on;
      var code = $("#code");
      code.inputMode = on ? "text" : "numeric";
      code.placeholder = on ? "xxxx-xxxx" : "123456";
      code.classList.toggle("codefield", !on);
      $("[data-code-sub]").textContent = on ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app.";
      $("[data-code-label]").textContent = on ? "Recovery code" : "Verification code";
      $("[data-recovery]").textContent = on ? "Use my authenticator app" : "Use a recovery code";
    }
    $("[data-recovery]").addEventListener("click", function () {
      setRecovery(!state.recovery);
      $("#code").value = "";
      say($("[data-form=code]"), "");
      $("#code").focus();
    });
    $("[data-form=code]").addEventListener("submit", async function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var code = $("#code").value.trim();
      if (!code) return say(form, "Enter your code.");
      say(form, "");
      setBusy(form, true, "Verifying…", "Verify");
      try {
        await call("sign_in_code", { ticket: state.ticket, code: code });
      } catch (err) {
        var m = text(err);
        if (m.indexOf("reset:") === 0) {
          $("#password").value = "";
          state.ticket = null;
          show("password", m.slice(6));
        } else {
          say(form, m);
        }
      } finally {
        setBusy(form, false, "Verifying…", "Verify");
      }
    });

    // Start at the sign-in steps when a server is saved, unless "Change Server" asked for the first step.
    call("get_server")
      .then(function (u) {
        state.server = u || null;
        if (u) $("#server").value = u;
        show(u && location.hash !== "#server" ? "email" : "server");
      })
      .catch(function () { show("server"); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
