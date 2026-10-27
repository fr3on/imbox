import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { html, NOW } from "./render";
import SettingsPage from "@/pages/Settings";
import { AccountsSection } from "@/settings/accounts/AccountsSection";
import { SignInAppsSection } from "@/settings/integrations/SignInApps";
import { DomainsSection } from "@/settings/domains/DomainsSection";
import { IntegrationsSection } from "@/components/IntegrationsSection";
import { PreferencesSection } from "@/settings/preferences/PreferencesSection";
import { ProfileSection } from "@/settings/profile/ProfileSection";
import { WritingSection } from "@/settings/writing/WritingSection";
import { SecuritySection } from "@/settings/security/SecuritySection";

// What each tab of Settings shows on first paint, and the compact sections the phone layout reuses. Written before the file was split into one module per
// area, and kept so a move that changes a screen shows up as a changed snapshot.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const TABS = ["profile", "security", "preferences", "writing", "accounts", "domains", "calendar", "ai", "agents", "integrations"];

describe("the Settings page", () => {
  for (const tab of TABS) {
    it(`shows the ${tab} tab`, () => {
      const out = html(<SettingsPage />, `/settings?tab=${tab}`);
      expect(out.length).toBeGreaterThan(500);
      expect(out).toMatchSnapshot();
    });
  }

  it("keeps the sending defaults, signature and email links under Writing, not Profile or Preferences", () => {
    const writing = html(<WritingSection />);
    for (const t of ["Sending defaults", "Default signature", "Default reply-to", "Auto-BCC"]) expect(writing).toContain(t);
    const profile = html(<ProfileSection />);
    for (const t of ["Sending defaults", "Default signature", "Auto-BCC"]) expect(profile).not.toContain(t);
    expect(html(<PreferencesSection />)).not.toContain("Email links");
  });

  it("lists Writing in the Settings sidebar", () => {
    expect(html(<SettingsPage />, "/settings?tab=writing")).toContain(">Writing<");
  });

  it("starts on the profile tab, and an old link to the Servers page lands on Domains", () => {
    expect(html(<SettingsPage />, "/settings")).toContain("Maya Chen");
    expect(html(<SettingsPage />, "/settings#servers")).toBe(html(<SettingsPage />, "/settings?tab=domains"));
    expect(html(<SettingsPage />, "/settings/calendar")).toBe(html(<SettingsPage />, "/settings?tab=calendar"));
    expect(html(<SettingsPage />, "/settings#calendar")).toBe(html(<SettingsPage />, "/settings/calendar"));
  });

  it("shows nothing before there is a signed-in person", () => {
    expect(html(<SettingsPage />, "/settings").length).toBeGreaterThan(0);
  });
});

describe("the sections the phone layout reuses", () => {
  it("profile, compact", () => expect(html(<ProfileSection compact />)).toMatchSnapshot());
  it("preferences, compact", () => expect(html(<PreferencesSection compact />)).toMatchSnapshot());

  it("keeps the browser extension tokens under Integrations, not Preferences", () => {
    expect(html(<PreferencesSection />)).not.toContain("Browser extension");
    expect(html(<IntegrationsSection onGoToTab={() => {}} />)).toContain("Browser extension");
  });

  it("preferences open on Appearance only, and every other section says how it is set", () => {
    const out = html(<PreferencesSection />);
    expect(out).toContain("Show previews in lists");
    for (const title of ["Mail", "Calendar", "Privacy"]) expect(out).toContain(`>${title}</h2>`);
    expect(out).toContain("2 of 2 on");
    expect(out).not.toContain("Look for new versions");
    expect(out).toContain("Expand all");
  });
  it("security, compact", () => expect(html(<SecuritySection compact />)).toMatchSnapshot());
  it("accounts", () => expect(html(<AccountsSection onNewMailbox={() => {}} />)).toMatchSnapshot());
  it("domains", () => expect(html(<DomainsSection />)).toMatchSnapshot());
  it("sign-in apps, compact", () => expect(html(<SignInAppsSection compact />)).toMatchSnapshot());

  it("puts each provider's steps, redirect address and credentials in one card, under a new name", () => {
    const out = html(<SignInAppsSection />, "/settings", (qc) =>
      qc.setQueryData(["oauth"], [
        { provider: "google", configured: false, source: "none", env_available: false, overriding: false, client_id: "", secret_hint: "" },
        { provider: "microsoft", configured: true, source: "db", env_available: false, overriding: false, client_id: "abc-7c21", secret_hint: "••••" },
      ]));
    expect(out).toContain("Sign-in apps");
    expect(out).not.toContain("Provider credentials");
    expect(out).not.toContain("further down");
    expect(out).toContain("Paste the client ID and secret below.");
    expect(out).toContain("Client ID ends …7c21");
  });
});
