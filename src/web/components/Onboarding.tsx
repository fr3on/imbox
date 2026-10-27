import { BrandIcon } from "@/components/BrandIcons";
import { useState } from "react";
import { Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Mail, Newspaper, Server } from "lucide-react";
import type { StalwartServer } from "@shared/types";
import { cn } from "@/lib/utils";
import { useAccount } from "@/context/AccountContext";
import { useMenuPreset } from "@/lib/menuPresets";
import { startGoogleConnect, startMicrosoftConnect } from "@/lib/connect";
import { AuthLayout } from "@/pages/AuthLayout";
import { ConnectServerForm } from "@/stalwart/ConnectServerForm";
import { Button } from "@/components/ui/button";
import { AppearanceStep } from "../onboarding/AppearanceStep";
import { ImapSetupForm } from "../onboarding/ImapSetupForm";
import { StalwartMailboxStep } from "../onboarding/StalwartMailboxStep";
import { StepperHeader } from "../onboarding/StepperHeader";
import { FeatureBenefit, ProviderOption } from "../onboarding/parts";
import type { ProviderMode, Step } from "../onboarding/steps";

/**
 * Onboarding component rendered within AuthLayout to give a cohesive,
 * split-screen aesthetic matching Login and Setup.
 */
export function Onboarding({ initialStep = "choose" }: { initialStep?: Step } = {}) {
  const nav = useNavigate();
  const { googleConfigured, microsoftConfigured, user, accounts } = useAccount();
  const [step, setStep] = useState<Step>(initialStep);
  const [providerMode, setProviderMode] = useState<ProviderMode>("imap");
  const [initialImapPreset, setInitialImapPreset] = useState("custom");
  const [stalwartServer, setStalwartServer] = useState<StalwartServer | null>(null);
  const [connectedEmail, setConnectedEmail] = useState("");
  const menuPreset = useMenuPreset();

  const firstName = user?.name ? user.name.split(" ")[0] : "";
  const activeTheme = user?.settings?.theme ?? "system";

  const handleDone = (addr: string) => {
    setConnectedEmail(addr);
    setStep("appearance");
  };

  // Without a mailbox there is nothing to open, so the last step sends the person back to connect one.
  const hasMailbox = accounts.length > 0 || Boolean(connectedEmail);

  const handleOpenImbox = () => {
    if (hasMailbox) nav("/", { replace: true });
    else {
      setStalwartServer(null);
      setStep("choose");
    }
  };

  return (
    <AuthLayout allowAuthenticated maxWidth="max-w-[500px]">
      <StepperHeader currentStep={step} onStepClick={(s) => setStep(s)} />

      {step === "choose" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em]">
              {firstName ? `Let's connect your mail, ${firstName}` : "Let's connect your mail"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Choose your mail service to begin. Imbox starts fresh from this moment — past mail is only imported if you choose.
            </p>
          </div>

          <div className="grid gap-3">
            {/* Stalwart Server */}
            <ProviderOption
              icon={<Server className="size-5" />}
              badge="Self-Hosted"
              badgeVariant="secondary"
              title="Stalwart Mail Server"
              description="Connect your private mail server via API key. Imbox manages domains and mailboxes automatically."
              onClick={() => {
                setProviderMode("stalwart");
                setStep("setup");
              }}
            />

            {/* Standard IMAP/SMTP */}
            <ProviderOption
              icon={<Mail className="size-5" />}
              badge="Any Provider"
              badgeVariant="outline"
              title="Standard Mailbox (IMAP & SMTP)"
              description="Fastmail, iCloud, Zoho, Migadu, cPanel, or your own custom domain."
              onClick={() => {
                setProviderMode("imap");
                setInitialImapPreset("custom");
                setStep("setup");
              }}
            />

            {/* Gmail */}
            <ProviderOption
              icon={<Mail className="size-5" />}
              badge={googleConfigured ? "1-Click" : "App Password"}
              badgeVariant={googleConfigured ? "default" : "secondary"}
              title="Gmail / Google Workspace"
              description={
                googleConfigured
                  ? "Sign in directly with your Google account."
                  : "Quick setup using a 16-character Google App Password."
              }
              onClick={() => {
                if (googleConfigured) {
                  startGoogleConnect();
                } else {
                  setProviderMode("imap");
                  setInitialImapPreset("gmail");
                  setStep("setup");
                }
              }}
            />

            {/* Microsoft Outlook */}
            <ProviderOption
              icon={<Mail className="size-5" />}
              badge={microsoftConfigured ? "1-Click" : "IMAP"}
              badgeVariant={microsoftConfigured ? "default" : "outline"}
              title="Microsoft Outlook / 365"
              description={
                microsoftConfigured
                  ? "Sign in directly with your Microsoft account."
                  : "Connect with your Outlook or Microsoft 365 credentials."
              }
              onClick={() => {
                if (microsoftConfigured) {
                  startMicrosoftConnect();
                } else {
                  setProviderMode("imap");
                  setInitialImapPreset("custom");
                  setStep("setup");
                }
              }}
            />
          </div>

          <div className="flex flex-col items-center gap-2 pt-2 text-center text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setStep("appearance")}
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4 hover:opacity-80 transition-opacity cursor-pointer"
            >
              Skip mailbox setup & customize appearance <ArrowRight className="size-3.5" />
            </button>
            <p className="text-[11px] text-muted-foreground">
              You can connect additional mailboxes later anytime under Settings → Accounts.
            </p>
          </div>
        </div>
      )}

      {step === "setup" && (
        <>
          {providerMode === "imap" && (
            <ImapSetupForm
              initialPreset={initialImapPreset}
              onConnected={handleDone}
              onBack={() => setStep("choose")}
            />
          )}

          {providerMode === "stalwart" && !stalwartServer && (
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => setStep("choose")}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <ArrowLeft className="size-3.5" /> Back to providers
              </button>

              <div>
                <h2 className="text-xl font-semibold tracking-tight">Connect your Stalwart server</h2>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Imbox uses an administrator API key to configure domains and mailboxes automatically.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <ConnectServerForm
                  autoFocus
                  onConnected={(s) => {
                    setStalwartServer(s);
                  }}
                />
              </div>
            </div>
          )}

          {providerMode === "stalwart" && stalwartServer && (
            <StalwartMailboxStep
              server={stalwartServer}
              onDone={handleDone}
              onBack={() => setStalwartServer(null)}
            />
          )}
        </>
      )}

      {step === "appearance" && (
        <AppearanceStep
          onContinue={() => setStep("done")}
          onBack={() => setStep(connectedEmail ? "setup" : "choose")}
        />
      )}

      {step === "done" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="size-6 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {firstName ? `You're all set, ${firstName}!` : "You're all set!"}
              </h1>
              <p className="text-xs text-muted-foreground">
                Your workspace and preferences are configured.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3.5 space-y-2.5">
            {connectedEmail ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Mail className="size-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs font-semibold truncate">{connectedEmail}</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </span>
              </div>
            ) : null}

            <div className={cn("flex items-center justify-between text-xs", connectedEmail && "pt-2 border-t border-border/60")}>
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Palette className="size-3.5 text-muted-foreground" /> Appearance & Style
              </span>
              <span className="font-medium text-foreground">
                {menuPreset.label} · <span className="capitalize">{activeTheme}</span>
              </span>
            </div>
          </div>

          <div className="space-y-2.5">
            <FeatureBenefit
              icon={<BrandIcon name="screener" className="size-4" />}
              title="First-time senders wait in the Screener"
              description="You choose who enters your Imbox. When someone new writes, you give a quick yes or no."
            />
            <FeatureBenefit
              icon={<Newspaper className="size-4" />}
              title="Receipts and newsletters sort themselves"
              description="Feed keeps automated mail out of the way until you want to browse."
            />
            <FeatureBenefit
              icon={<BrandIcon name="imbox" className="size-4" />}
              title="Only approved conversations reach your Imbox"
              description="A calm, quiet inbox on infrastructure you control."
            />
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
            <Button
              size="lg"
              className="w-full sm:flex-1 h-11 font-medium cursor-pointer"
              onClick={handleOpenImbox}
            >
              {hasMailbox ? "Open my Imbox" : "Connect a mailbox"} <ArrowRight className="size-4 ml-1.5" />
            </Button>
            {hasMailbox && (
              <Button
                variant="outline"
                size="lg"
                className="w-full sm:w-auto h-11 cursor-pointer"
                onClick={() => {
                  setStalwartServer(null);
                  setStep("choose");
                }}
              >
                Connect another account
              </Button>
            )}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
