// Lets the window be dragged by the web app's top bar. Tauri's own drag marker only works when the click lands on the
// marked element itself, and the web app's bar is filled by wrapper elements, so almost every click would be ignored.
// Injected into every page by the window (see lib.rs); acts only on the page's sticky top bar, never on its buttons or links.
(function () {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  // Only the Mac window has no title bar of its own to drag by.
  if (!/Macintosh/.test(navigator.userAgent)) return;
  var SKIP = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="combobox"],[contenteditable="true"],[data-no-drag]';
  function invoke(cmd) {
    var i = window.__TAURI_INTERNALS__;
    if (i && i.invoke) i.invoke(cmd).catch(function () {});
  }
  function inTopBar(t) {
    var h = t.closest("header");
    if (!h || getComputedStyle(h).position !== "sticky") return false;
    var r = h.getBoundingClientRect();
    return r.top <= 1 && r.height < 200;
  }
  document.addEventListener(
    "mousedown",
    function (e) {
      if (e.button !== 0 || e.buttons !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      var t = e.target;
      if (!(t instanceof Element) || t.hasAttribute("data-tauri-drag-region") || t.closest(SKIP) || !inTopBar(t)) return;
      invoke(e.detail === 2 ? "plugin:window|internal_toggle_maximize" : "plugin:window|start_dragging");
    },
    true
  );
})();
