import { BrandIcon } from "@/components/BrandIcons";
import { useNavigate } from "react-router-dom";
import { PasswordField } from "@/components/AuthParts";
import { useMemo, useState } from "react";
import { ChevronRight, Server, Loader2, ArrowLeft, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAccount } from "@/context/AccountContext";
import { useImapMutations } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ImportSelect } from "@/stalwart/Resync";
import { GoogleBrandIcon, ICloudBrandIcon, IMAP_PRESETS, MicrosoftBrandIcon, PRESET_META, ProviderBrandIcon, ProviderTile } from "./providers";
import { FormShell } from "../parts";

export function AddImapDialog({ open, onOpenChange, variant = "dialog", onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; variant?: "dialog" | "drawer"; onConnected?: (email: string) => void }) {
  const nav = useNavigate();
  const { create } = useImapMutations();
  const { googleConfigured, microsoftConfigured } = useAccount();
  const [preset, setPreset] = useState("custom");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [smtpPort, setSmtpPort] = useState(465);
  const [imapSecurity, setImapSecurity] = useState<"tls" | "starttls">("tls");
  const [smtpSecurity, setSmtpSecurity] = useState<"tls" | "starttls">("tls");
  const [advanced, setAdvanced] = useState(true);
  const [hostsEdited, setHostsEdited] = useState(false);
  const [importRecent, setImportRecent] = useState(50);
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "cloud" | "domain" | "server">("all");

  const onEmailChange = (value: string) => {
    setEmail(value);
    // Auto-detect common domains
    if (preset !== "gmail" && /@(gmail|googlemail)\.com\s*$/i.test(value)) {
      pickPreset("gmail");
      setAdvanced(false);
      return;
    }
    if (preset !== "outlook" && /@(outlook|hotmail|live|msn)\.com\s*$/i.test(value)) {
      pickPreset("outlook");
      setAdvanced(false);
      return;
    }
    if (preset !== "icloud" && /@(icloud|me|mac)\.com\s*$/i.test(value)) {
      pickPreset("icloud");
      setAdvanced(false);
      return;
    }
    if ((preset === "custom" || preset === "other") && !hostsEdited) {
      const domain = value.split("@")[1]?.trim().toLowerCase();
      const guess = domain?.includes(".") ? `mail.${domain}` : "";
      setImapHost(guess);
      setSmtpHost(guess);
    }
  };

  const pickPreset = (id: string) => {
    setPreset(id);
    setHostsEdited(false);
    const pr = IMAP_PRESETS.find((x) => x.id === id);
    if (!pr) return;
    setImapHost(pr.imap_host);
    setSmtpHost(pr.smtp_host);
    setImapPort(pr.imap_port ?? 993);
    setSmtpPort(pr.smtp_port ?? 465);
    setImapSecurity("tls");
    setSmtpSecurity(pr.smtp_port === 587 ? "starttls" : "tls");
  };

  const close = () => {
    onOpenChange(false);
    setEmail("");
    setName("");
    setPassword("");
    pickPreset("custom");
    setAdvanced(true);
    setStep("pick");
    setSearch("");
    setCategory("all");
  };

  const choose = (id: string) => {
    pickPreset(id);
    setAdvanced(id === "custom" || id === "other");
    setStep("details");
  };

  const submit = () =>
    create.mutate(
      {
        email: email.trim().toLowerCase(),
        display_name: name.trim(),
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
        onSuccess: (r: { account: { email: string } }) => {
          toast(`${r.account.email} is connected`);
          close();
          onConnected?.(r.account.email);
        },
        onError: (e: unknown) =>
          toast.error("Couldn't connect", { description: (e as Error).message, duration: 12000 }),
      }
    );

  const mobile = variant === "drawer";
  const selectedPresetObj = IMAP_PRESETS.find((x) => x.id === preset);
  const note = selectedPresetObj?.note;
  const meta = PRESET_META[preset] ?? PRESET_META.custom;
  const ready = email.trim() && password && imapHost.trim() && smtpHost.trim();
  const inputCls = cn(mobile && "h-11 text-[16px]");
  const size = mobile ? "lg" : "default";
  const pw16 = password.replace(/\s+/g, "").length;

  const filtered = useMemo(() => {
    return IMAP_PRESETS.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.hint.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [category, search]);

  return (
    <FormShell
      open={open}
      onClose={close}
      variant={variant}
      title="Add a mailbox"
      description={step === "pick" ? "Where does this mailbox live?" : "Sign in, and Imbox checks the login before saving anything."}
      className="sm:max-w-[620px]"
      footer={
        step === "pick" ? (
          <Button type="button" variant="outline" size={size} onClick={close}>Cancel</Button>
        ) : (
          <>
            <Button type="button" variant="ghost" size={size} onClick={() => setStep("pick")} disabled={create.isPending}>
              <ArrowLeft /> Back
            </Button>
            <Button type="button" size={size} disabled={!ready || create.isPending} onClick={submit}>
              {create.isPending ? <><Loader2 className="animate-spin" /> Checking your login…</> : "Connect"}
            </Button>
          </>
        )
      }
    >
      {step === "pick" ? (
        <div className="space-y-3.5">
          {/* Search bar & filter pills */}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="relative w-full min-w-0">
              <BrandIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mail providers (Gmail, Fastmail, Stalwart...)"
                className="pl-9 pr-8 h-9 text-xs bg-muted/20 border-border/70 focus-visible:ring-1"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/60 self-start max-w-full overflow-x-auto no-scrollbar">
              {[
                { id: "all", label: "All" },
                { id: "cloud", label: "Major" },
                { id: "domain", label: "Domains" },
                { id: "server", label: "Self-Hosted" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategory(tab.id as typeof category)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 cursor-pointer",
                    category === tab.id
                      ? "bg-background text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cards grid */}
          <div className="grid min-w-0 gap-2.5 sm:grid-cols-2 max-h-[min(380px,52dvh)] overflow-y-auto pr-1">
            {filtered.map((pr) => {
              const isGoogle = pr.id === "gmail";
              const isMs = pr.id === "outlook";
              const badgeLabel = (isGoogle && googleConfigured) || (isMs && microsoftConfigured)
                ? "1-Click OAuth"
                : pr.badge;
              const isRecommended = (isGoogle && googleConfigured) || (isMs && microsoftConfigured) || pr.id === "custom";

              return (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => choose(pr.id)}
                  className="group relative flex min-w-0 items-start gap-3 rounded-xl border border-border/80 bg-card/60 p-3 text-left transition-all duration-150 hover:border-foreground/35 hover:bg-muted/40 hover:shadow-xs active:scale-[0.99] cursor-pointer"
                >
                  <div className="flex size-9.5 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background shadow-2xs group-hover:scale-105 group-hover:border-foreground/25 transition-all">
                    <ProviderBrandIcon id={pr.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[13px] font-semibold tracking-tight text-foreground leading-snug truncate">
                        {pr.name}
                      </span>
                      {badgeLabel && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] font-normal py-0 px-1.5 h-4 shrink-0 border-border/60",
                            isRecommended ? "bg-primary/5 text-primary border-primary/20 font-medium" : "text-muted-foreground"
                          )}
                        >
                          {badgeLabel}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground line-clamp-2">
                      {pr.hint}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 transition-all self-center" />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="sm:col-span-2 py-8 text-center text-xs text-muted-foreground">
                <p>No providers matching “{search}”.</p>
                <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => choose("other")}>
                  Configure Custom IMAP Server
                </Button>
              </div>
            )}
          </div>

          {/* Stalwart Server banner callout */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/30 p-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background border border-border/60 text-foreground shadow-2xs">
                <Server className="size-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <span>Running your own Stalwart server?</span>
                  <Badge variant="secondary" className="text-[9px] py-0 px-1.5 h-3.5 font-normal">Self-Hosted</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  Connect it under Domains and servers to manage mailboxes, DNS, and domains automatically.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0 cursor-pointer hover:bg-background"
              onClick={() => {
                close();
                nav("/settings/domains");
              }}
            >
              Domains and servers <ArrowRight className="size-3 ml-1" />
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (ready) submit(); }}>
          <FieldGroup>
            {/* Header Selected Provider */}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <ProviderTile id={preset} className="bg-background" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground leading-snug">{meta.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {imapHost ? `${imapHost}:${imapPort}` : meta.hint}
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs cursor-pointer" onClick={() => setStep("pick")}>
                Change
              </Button>
            </div>

            {/* 1-Click OAuth options if available */}
            {preset === "gmail" && googleConfigured && (
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/80 bg-primary/5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <GoogleBrandIcon className="size-4.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">1-Click Google Sign In</p>
                    <p className="text-[11px] text-muted-foreground truncate">OAuth is active. Connect directly without an app password.</p>
                  </div>
                </div>
                <Button size="sm" asChild className="h-8 text-xs shrink-0 cursor-pointer">
                  <a href="/auth/google/start">Sign in</a>
                </Button>
              </div>
            )}
            {preset === "outlook" && microsoftConfigured && (
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/80 bg-primary/5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <MicrosoftBrandIcon className="size-4.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">1-Click Microsoft Sign In</p>
                    <p className="text-[11px] text-muted-foreground truncate">OAuth is active. Connect directly with Microsoft 365.</p>
                  </div>
                </div>
                <Button size="sm" asChild className="h-8 text-xs shrink-0 cursor-pointer">
                  <a href="/auth/microsoft/start">Sign in</a>
                </Button>
              </div>
            )}

            {/* Step-by-step guidance */}
            {preset === "gmail" ? (
              <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <GoogleBrandIcon className="size-3.5" />
                  <span>Google App Password Guide</span>
                </div>
                <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                  <li>Turn on 2-Step Verification in your Google Account.</li>
                  <li>Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">myaccount.google.com/apppasswords</a> and create an app password called <span className="font-medium text-foreground">Imbox</span>.</li>
                  <li>Paste the 16 letters into the password field below.</li>
                </ol>
              </div>
            ) : preset === "icloud" ? (
              <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <ICloudBrandIcon className="size-3.5" />
                  <span>Apple App-Specific Password</span>
                </div>
                <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                  <li>Go to <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">appleid.apple.com</a> under Sign-In & Security.</li>
                  <li>Generate an <span className="font-medium text-foreground">App-Specific Password</span> for Imbox.</li>
                  <li>Use your full @icloud.com, @me.com, or @mac.com address below.</li>
                </ol>
              </div>
            ) : note ? (
              <p className="text-xs leading-5 text-muted-foreground">{note}</p>
            ) : null}

            {/* Email field */}
            <Field>
              <FieldLabel htmlFor="imap-email">Email address</FieldLabel>
              <Input
                id="imap-email"
                type="email"
                autoComplete="off"
                autoFocus
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
                required
              />
            </Field>

            {/* Password field */}
            <Field>
              <FieldLabel htmlFor="imap-pass">
                {preset === "gmail" || preset === "icloud" ? "App password" : "Password"}
              </FieldLabel>
              <PasswordField
                id="imap-pass"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder={preset === "gmail" ? "16 letters" : "App password"}
              />
              {preset === "gmail" && password.length > 0 ? (
                <p className={cn("text-xs tnum", pw16 === 16 ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500")}>
                  {pw16} of 16 characters{pw16 !== 16 && " · a Google app password is exactly 16 letters"}
                </p>
              ) : (
                <FieldDescription>
                  Stored encrypted on your server and never shown again. Use an app-specific password where your provider offers one.
                </FieldDescription>
              )}
            </Field>

            {/* Display name */}
            <Field>
              <FieldLabel htmlFor="imap-name">Display name <span className="font-normal text-muted-foreground">· optional</span></FieldLabel>
              <Input
                id="imap-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shown on mail you send"
                className={inputCls}
              />
            </Field>

            <ImportSelect value={importRecent} onChange={setImportRecent} id="imap-import" />

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">Server settings</div>
                <div className="truncate text-xs text-muted-foreground tnum">
                  {imapHost ? `IMAP ${imapHost}:${imapPort}` : "IMAP not set"} · {smtpHost ? `SMTP ${smtpHost}:${smtpPort}` : "SMTP not set"}
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => setAdvanced((v) => !v)}>{advanced ? "Hide" : "Edit"}</Button>
            </div>

            {advanced ? (
              <>
                <Field>
                  <FieldLabel htmlFor="imap-host">IMAP server</FieldLabel>
                  <div className="flex gap-2">
                    <Input id="imap-host" value={imapHost} onChange={(e) => { setHostsEdited(true); setImapHost(e.target.value); }} placeholder="imap.example.com" className={cn("flex-1", mobile && "h-11 text-[16px]")} />
                    <Input aria-label="IMAP port" type="number" value={imapPort} onChange={(e) => { const v = Number(e.target.value); setImapPort(v); setImapSecurity(v === 143 ? "starttls" : "tls"); }} className={cn("w-24", mobile && "h-11 text-[16px]")} />
                  </div>
                  <FieldDescription>993 for implicit TLS, or 143 for STARTTLS.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="smtp-host">SMTP server</FieldLabel>
                  <div className="flex gap-2">
                    <Input id="smtp-host" value={smtpHost} onChange={(e) => { setHostsEdited(true); setSmtpHost(e.target.value); }} placeholder="smtp.example.com" className={cn("flex-1", mobile && "h-11 text-[16px]")} />
                    <Input aria-label="SMTP port" type="number" value={smtpPort} onChange={(e) => { const v = Number(e.target.value); setSmtpPort(v); setSmtpSecurity(v === 587 ? "starttls" : "tls"); }} className={cn("w-24", mobile && "h-11 text-[16px]")} />
                  </div>
                  <FieldDescription>
                    465 for implicit TLS, or 587 for STARTTLS. Port 25 is for mail between servers and cannot be used.
                  </FieldDescription>
                </Field>
              </>
            ) : null}
          </FieldGroup>
        </form>
      )}
    </FormShell>
  );
}
