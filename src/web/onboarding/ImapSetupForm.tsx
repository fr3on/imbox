import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { ArrowLeft, ChevronDown, ExternalLink, Eye, EyeOff, Info, Loader2, } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useImapMutations } from "@/api";
import { ImportSelect } from "@/stalwart/Resync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { IMAP_PRESETS } from "./presets";

/** Inline IMAP / SMTP setup form tailored for clarity and ease of use */
export function ImapSetupForm({
  initialPreset = "custom",
  onConnected,
  onBack,
}: {
  initialPreset?: string;
  onConnected: (email: string) => void;
  onBack: () => void;
}) {
  const { create } = useImapMutations();
  const [preset, setPreset] = useState(initialPreset);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [smtpPort, setSmtpPort] = useState(465);
  const [imapSecurity, setImapSecurity] = useState<"tls" | "starttls">("tls");
  const [smtpSecurity, setSmtpSecurity] = useState<"tls" | "starttls">("tls");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hostsEdited, setHostsEdited] = useState(false);
  const [importRecent, setImportRecent] = useState(50);
  const [errorMsg, setErrorMsg] = useState("");

  const selectedPreset = IMAP_PRESETS.find((p) => p.id === preset) ?? IMAP_PRESETS[0];

  const applyPreset = (id: string) => {
    setPreset(id);
    setErrorMsg("");
    setHostsEdited(false);
    const p = IMAP_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setImapHost(p.imapHost);
    setSmtpHost(p.smtpHost);
    setImapPort(p.imapPort);
    setSmtpPort(p.smtpPort);
    setImapSecurity("tls");
    setSmtpSecurity(p.smtpPort === 587 ? "starttls" : "tls");
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    setErrorMsg("");
    if (preset !== "gmail" && /@(gmail|googlemail)\.com\s*$/i.test(val)) {
      applyPreset("gmail");
      return;
    }
    if (preset === "custom" && !hostsEdited) {
      const domain = val.split("@")[1]?.trim().toLowerCase();
      const guess = domain?.includes(".") ? `mail.${domain}` : "";
      setImapHost(guess);
      setSmtpHost(guess);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both your email address and password.");
      return;
    }
    if (!imapHost.trim() || !smtpHost.trim()) {
      setErrorMsg("Please provide your IMAP and SMTP server hosts.");
      return;
    }

    create.mutate(
      {
        email: email.trim().toLowerCase(),
        display_name: name.trim() || undefined,
        imap_host: imapHost.trim(),
        imap_port: imapPort,
        imap_security: imapSecurity,
        smtp_host: smtpHost.trim(),
        smtp_port: smtpPort,
        smtp_security: smtpSecurity,
        password,
        import_recent: importRecent,
      },
      {
        onSuccess: (r) => {
          toast.success(`${r.account.email} connected`);
          onConnected(r.account.email);
        },
        onError: (err) => {
          const msg = (err as Error).message;
          setErrorMsg(
            msg.toLowerCase().includes("authentication") || msg.toLowerCase().includes("credentials")
              ? "Login failed: Please verify your email and password / app password."
              : msg
          );
        },
      }
    );
  };

  const isFormValid = email.trim().length > 3 && password.trim().length > 0 && imapHost.trim() && smtpHost.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Back to providers
        </button>
      </div>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">Connect your mailbox</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sign in to your mailbox. Imbox verifies credentials before saving.
        </p>
      </div>

      {/* Preset selection chips */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Provider Preset</Label>
        <div className="flex flex-wrap gap-1.5">
          {IMAP_PRESETS.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background font-semibold"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                )}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preset Guide Callout */}
      {selectedPreset.guide ? (
        <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 text-xs text-foreground space-y-2">
          <div className="flex items-center gap-1.5 font-semibold">
            <Info className="size-3.5 text-foreground shrink-0" />
            <span>{selectedPreset.guide.title}</span>
          </div>
          <ol className="space-y-1.5 pl-5 list-decimal text-muted-foreground leading-relaxed">
            {selectedPreset.guide.steps.map((st, i) => (
              <li key={i}>
                <span>{st.text} </span>
                {st.link ? (
                  <a
                    href={st.link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-2 hover:opacity-80"
                  >
                    {st.link.label} <ExternalLink className="size-2.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : selectedPreset.hint ? (
        <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" /> {selectedPreset.hint}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-email" className="text-xs">
            Email address
          </Label>
          <Input
            id="onboarding-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            required
            autoFocus
            autoComplete="email"
            className="h-10"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onboarding-name" className="text-xs">
            Display name <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="onboarding-name"
            placeholder="e.g. Maya"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="h-10"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="onboarding-password" className="text-xs">
              {preset === "gmail" || preset === "icloud" ? "App password" : "Password"}
            </Label>
            {preset === "gmail" && (
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground inline-flex items-center gap-0.5"
              >
                Create app password <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
          <div className="relative">
            <Input
              id="onboarding-password"
              type={showPassword ? "text" : "password"}
              placeholder={preset === "gmail" ? "16-letter app password" : "Enter password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorMsg) setErrorMsg("");
              }}
              required
              autoComplete="current-password"
              className="h-10 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Import selector */}
        <div className="pt-1">
          <ImportSelect value={importRecent} onChange={setImportRecent} id="onboarding-import" />
        </div>

        {/* Collapsible Advanced Settings */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="pt-1">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")} />
              <span>Advanced Server Settings</span>
              {!showAdvanced && imapHost && (
                <span className="text-[11px] text-muted-foreground/70 font-mono">
                  ({imapHost}:{imapPort})
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="onboarding-imap" className="text-xs">
                IMAP server & port
              </Label>
              <div className="flex gap-2">
                <Input
                  id="onboarding-imap"
                  value={imapHost}
                  onChange={(e) => {
                    setImapHost(e.target.value);
                    setHostsEdited(true);
                  }}
                  placeholder="imap.example.com"
                  className="h-9 flex-1"
                />
                <Input
                  type="number"
                  aria-label="IMAP port"
                  value={imapPort}
                  onChange={(e) => setImapPort(Number(e.target.value))}
                  className="h-9 w-20 text-center"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onboarding-smtp" className="text-xs">
                SMTP server & port
              </Label>
              <div className="flex gap-2">
                <Input
                  id="onboarding-smtp"
                  value={smtpHost}
                  onChange={(e) => {
                    setSmtpHost(e.target.value);
                    setHostsEdited(true);
                  }}
                  placeholder="smtp.example.com"
                  className="h-9 flex-1"
                />
                <Input
                  type="number"
                  aria-label="SMTP port"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))}
                  className="h-9 w-20 text-center"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {errorMsg ? (
          <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive leading-5">
            {errorMsg}
          </div>
        ) : null}

        <Button type="submit" disabled={!isFormValid || create.isPending} className="h-10 w-full font-medium">
          {create.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              Testing & connecting…
            </>
          ) : (
            "Connect Mailbox"
          )}
        </Button>
      </form>
    </div>
  );
}
