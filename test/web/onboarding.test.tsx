import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { StalwartDomain, StalwartMailbox, StalwartServer } from "@shared/types";
import { html, NOW, USER } from "./render";
import { Onboarding } from "@/components/Onboarding";
import { AppearanceStep } from "@/onboarding/AppearanceStep";
import { ImapSetupForm } from "@/onboarding/ImapSetupForm";
import { FeatureBenefit, ProviderOption } from "@/onboarding/parts";
import { StalwartMailboxStep } from "@/onboarding/StalwartMailboxStep";
import type { Step } from "@/onboarding/steps";
import { StepperHeader } from "@/onboarding/StepperHeader";

// The first-run wizard (choose a provider, set it up, pick an appearance, done), pinned before the file was split: the whole wizard at each step, and
// each step's own screen with the props it is given. Steps are drawn as the first paint; clicks and typing are not part of this.

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const noop = () => {};
const SERVER: StalwartServer = { id: "s-1", name: "Home server", base_url: "https://mail.chen.studio", imap_host: "mail.chen.studio", imap_port: 993, smtp_host: "mail.chen.studio", smtp_port: 465, api_key_hint: "••••k3y9", last_checked_at: NOW, last_error: null, mailboxes: 2 };
const DOMAINS: StalwartDomain[] = [{ id: "sd-1", name: "chen.studio", isEnabled: true, description: null }];
const MAILBOXES: StalwartMailbox[] = [
  { id: "sm-1", name: "maya", domain_id: "sd-1", domain: "chen.studio", email: "maya@chen.studio", description: null, account_id: null, is_admin: false, is_agent: false },
  { id: "sm-2", name: "admin", domain_id: "sd-1", domain: "chen.studio", email: "admin@chen.studio", description: null, account_id: null, is_admin: true, is_agent: false },
];
const withServer = (qc: QueryClient) => {
  qc.setQueryData(["stalwart", "s-1", "domains"], DOMAINS);
  qc.setQueryData(["stalwart", "s-1", "mailboxes"], MAILBOXES);
};
const googleOff = (qc: QueryClient) => qc.setQueryData(["me"], { user: USER, accounts: [], setup_required: false, google_configured: false, microsoft_configured: true, app_name: "Imbox" });
const noName = (qc: QueryClient) => qc.setQueryData(["me"], { user: { ...USER, name: "" }, accounts: [], setup_required: false, google_configured: true, microsoft_configured: false, app_name: "Imbox" });

describe("the wizard", () => {
  const STEPS: Step[] = ["choose", "setup", "appearance", "done"];
  for (const step of STEPS) it(`at the ${step} step`, () => expect(html(<Onboarding initialStep={step} />, "/welcome")).toMatchSnapshot());
  it("starts at the first step", () => expect(html(<Onboarding />, "/welcome")).toBe(html(<Onboarding initialStep="choose" />, "/welcome")));
  it("offers Microsoft and an app password for Gmail where no Google sign-in is set up", () => expect(html(<Onboarding />, "/welcome", googleOff)).toMatchSnapshot());
  it("greets nobody by name when there is none", () => expect(html(<Onboarding initialStep="done" />, "/welcome", noName)).toMatchSnapshot());
});

describe("the progress header", () => {
  for (const step of ["choose", "setup", "appearance", "done"] as Step[]) {
    it(`at ${step}, with and without links back`, () => {
      expect(html(<StepperHeader currentStep={step} />, "/welcome")).toMatchSnapshot();
      expect(html(<StepperHeader currentStep={step} onStepClick={noop} />, "/welcome")).toMatchSnapshot();
    });
  }
});

describe("the steps on their own", () => {
  it("a provider choice", () => expect(html(<ProviderOption icon={<i />} title="Standard Mailbox" description="Any provider" badge="Any Provider" badgeVariant="outline" onClick={noop} />, "/welcome")).toMatchSnapshot());
  it("a benefit line", () => expect(html(<FeatureBenefit icon={<i />} title="Quiet by default" description="Only approved mail." />, "/welcome")).toMatchSnapshot());
  for (const preset of ["custom", "gmail", "fastmail", "icloud", "zoho", "migadu"]) {
    it(`the mailbox form for ${preset}`, () => expect(html(<ImapSetupForm initialPreset={preset} onConnected={noop} onBack={noop} />, "/welcome")).toMatchSnapshot());
  }
  it("the mailbox form for a preset it does not know", () => expect(html(<ImapSetupForm initialPreset="nope" onConnected={noop} onBack={noop} />, "/welcome")).toMatchSnapshot());
  it("the Stalwart mailbox step with its domains and mailboxes", () => expect(html(<StalwartMailboxStep server={SERVER} onDone={noop} onBack={noop} />, "/welcome", withServer)).toMatchSnapshot());
  it("the Stalwart mailbox step while loading", () => expect(html(<StalwartMailboxStep server={SERVER} onDone={noop} onBack={noop} />, "/welcome")).toMatchSnapshot());
  it("the appearance step", () => expect(html(<AppearanceStep onContinue={noop} onBack={noop} />, "/welcome")).toMatchSnapshot());
});
