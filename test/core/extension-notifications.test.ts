import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(__dirname, "../../apps/extension");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const bgSrc = fs.readFileSync(path.join(dir, "background.js"), "utf8");
const optSrc = fs.readFileSync(path.join(dir, "options.js"), "utf8");
const libSrc = fs.readFileSync(path.join(dir, "lib.js"), "utf8");

const popupSrc = fs.readFileSync(path.join(dir, "popup.js"), "utf8");
import { extensionMayCall } from "../../src/api/extensionTokens";

describe("extension notifications", () => {
  it("declares notifications permission in manifest.json", () => {
    expect(manifest.permissions).toContain("notifications");
  });

  it("checks notifications and handles clicks in background.js", () => {
    expect(bgSrc).toContain("checkNotifications");
    expect(bgSrc).toContain("ext.notifications.onClicked.addListener");
    expect(bgSrc).toContain("/screener");
    expect(bgSrc).toContain("/t/");
    expect(bgSrc).toContain("/api/screener/waiting");
    expect(bgSrc).toContain("/api/imbox/recent");
  });

  it("provides user preference toggles in options.js", () => {
    expect(optSrc).toContain("notifyScreener");
    expect(optSrc).toContain("notifyImbox");
  });

  it("clears notification tracking state on disconnect in lib.js", () => {
    expect(libSrc).toContain("lastNotifiedScreenerAt");
    expect(libSrc).toContain("lastNotifiedImboxAt");
    expect(libSrc).toContain("notifiedKeys");
  });

  it("shows bell icon, badge, and notifications list in popup.js", () => {
    expect(popupSrc).toContain("notif-btn");
    expect(popupSrc).toContain("nbadge");
    expect(popupSrc).toContain("/api/notifications");
    expect(popupSrc).toContain("/api/notifications/seen");
    expect(popupSrc).toContain("data-notif");
  });

  it("permits extension tokens to read and mark notifications seen", () => {
    expect(extensionMayCall("GET", "/api/notifications")).toBe(true);
    expect(extensionMayCall("POST", "/api/notifications/seen")).toBe(true);
  });

  it("defaults to side panel UI and openPanelOnActionClick", () => {
    expect(bgSrc).toContain("dock !== false");
    expect(optSrc).toContain('dock !== false ? " checked" : ""');
    expect(popupSrc).toContain("const SIDE = true;");
    const popupHtml = fs.readFileSync(path.join(dir, "popup.html"), "utf8");
    expect(popupHtml).toContain('class="side pop-window"');
  });
});

