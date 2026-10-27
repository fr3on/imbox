import { PasswordField } from "@/components/AuthParts";
import { useState } from "react";
import { AlertTriangle, Check, Copy, Download, Plus, RefreshCw, Unplug, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTwoFactor, useTwoFactorMutations } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FormShell, Row, Section } from "../parts";

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  const downloadCodes = () => {
    const text = `Imbox Backup Recovery Codes\nGenerated: ${new Date().toISOString()}\n\nEach code can be used once to sign in if you lose your authenticator:\n\n` + codes.join("\n") + "\n";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "imbox-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/60 border border-border/60 p-3.5 font-mono text-[13px] tnum text-center">
        {codes.map((c) => (
          <span key={c} className="py-1 px-2 rounded bg-background border border-border/40 font-medium select-all">
            {c}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5 text-xs"
          onClick={() => {
            navigator.clipboard.writeText(codes.join("\n")).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy all codes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5 text-xs"
          onClick={downloadCodes}
        >
          <Download size={13} /> Download .txt
        </Button>
      </div>
      <p className="text-[11.5px] text-muted-foreground leading-relaxed">
        Save these recovery codes in your password manager or safe storage. Each code works once and they will not be shown again.
      </p>
    </div>
  );
}

export function TwoFactorBlock({ compact }: { compact?: boolean }) {
  const status = useTwoFactor();
  const { setup, enable, regenerate, disable } = useTwoFactorMutations();
  const variant = compact ? "drawer" : "dialog";
  const inputCls = compact ? "h-11 text-[16px]" : undefined;

  // Enable flow
  const [enableOpen, setEnableOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Regenerate / disable flows
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [dPassword, setDPassword] = useState("");
  const [dCode, setDCode] = useState("");

  const startEnable = () => {
    setCode(""); setCodes(null); setQr(""); setSecret("");
    setEnableOpen(true);
    setup.mutate(undefined, {
      onSuccess: async (r) => {
        setSecret(r.secret);
        try {
          const { default: QRCode } = await import("qrcode");
          setQr(await QRCode.toDataURL(r.otpauth_url, { margin: 1, width: 200, color: { dark: "#000000", light: "#ffffff" } }));
        } catch {
          setQr("");
        }
      },
      onError: (e) => { toast.error((e as Error).message); setEnableOpen(false); },
    });
  };

  const enabled = !!status.data?.enabled;
  const left = status.data?.recovery_left ?? 0;

  return (
    <Section
      title="Two-factor authentication"
      collapsible
      defaultOpen
      summary={status.isLoading ? "…" : enabled ? `On, ${left} recovery code${left === 1 ? "" : "s"} left` : "Off"}
      description="A second step at sign-in from an authenticator app: 1Password, Google Authenticator, Authy or Apple Passwords."
    >
      {enabled ? (
        <>
          <Row label="Authenticator app" hint={`${left} recovery code${left === 1 ? "" : "s"} left. Each works once if you lose your authenticator.`}>
            <Button type="button" variant="outline" size="sm" onClick={() => { setRegenCode(""); setRegenOpen(true); }} className="gap-1.5 text-xs">
              <RefreshCw size={13} /> Regenerate codes
            </Button>
          </Row>
          {left <= 3 && (
            <div className="flex items-start gap-2.5 border-b border-border/60 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300 sm:px-5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>You only have {left} recovery code{left === 1 ? "" : "s"} left. Make new ones so you can't be locked out.</span>
            </div>
          )}
          <Row label="Turn off two-factor" hint="Asks for your password and a code.">
            <Button type="button" variant="outline" size="sm" onClick={() => { setDPassword(""); setDCode(""); setDisableOpen(true); }} className="gap-1.5 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive">
              <Unplug size={13} /> Turn off
            </Button>
          </Row>
        </>
      ) : (
        <Row label="Authenticator app" hint="Codes are checked on your own server. No SMS, no phone network.">
          <Button type="button" size="sm" onClick={startEnable} disabled={status.isLoading} className="gap-1.5">
            <Plus size={14} /> Set up
          </Button>
        </Row>
      )}

      {/* Enable: QR + verify, then recovery codes */}
      <FormShell
        open={enableOpen}
        onClose={() => { if (!codes) setEnableOpen(false); }}
        variant={variant}
        title={codes ? "Save your recovery codes" : "Set up your authenticator"}
        description={codes ? "Each code works once if you lose your authenticator. Keep them somewhere safe — they won't be shown again." : "Scan the code with your authenticator app, then enter the 6-digit code it shows."}
        footer={
          codes ? (
            <Button type="button" size={compact ? "lg" : "default"} onClick={() => { setEnableOpen(false); setCodes(null); }}>I've saved these</Button>
          ) : (
            <>
              <Button type="button" variant="outline" size={compact ? "lg" : "default"} onClick={() => setEnableOpen(false)}>Cancel</Button>
              <Button
                type="button"
                size={compact ? "lg" : "default"}
                disabled={!secret || code.replace(/\s/g, "").length !== 6 || enable.isPending}
                onClick={() => enable.mutate({ code }, { onSuccess: (r) => { setCodes(r.recovery_codes); toast.success("Two-factor authentication is on"); }, onError: (e) => toast.error(/invalid code/i.test((e as Error).message) ? "That code isn't right. Try the next one." : (e as Error).message) })}
              >
                {enable.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
                Verify & turn on
              </Button>
            </>
          )
        }
      >
        {codes ? (
          <RecoveryCodes codes={codes} />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-muted/30 border border-border/60">
              {qr ? (
                <img src={qr} alt="Authenticator QR code" width={180} height={180} className="rounded-lg bg-white p-2 border border-border shadow-xs" />
              ) : (
                <Skeleton className="size-44 rounded-lg" />
              )}
              <span className="text-[11px] text-muted-foreground mt-2">Scan with your authenticator app</span>
            </div>

            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Can't scan? Enter this key manually:</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-2.5 py-2 font-mono text-[12px] tracking-wider border border-border/60 select-all">
                  {secret ? secret.replace(/(.{4})/g, "$1 ").trim() : "…"}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy key"
                  disabled={!secret}
                  onClick={() => navigator.clipboard.writeText(secret).then(() => { setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 1500); })}
                >
                  {copiedSecret ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                </Button>
              </div>
            </div>

            <Field>
              <FieldLabel htmlFor="tfa-code">6-digit verification code</FieldLabel>
              <Input
                id="tfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000 000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={cn("font-mono tracking-[0.35em] text-center text-lg h-11", inputCls)}
                autoFocus={!compact}
              />
            </Field>
          </div>
        )}
      </FormShell>

      {/* Regenerate recovery codes */}
      <FormShell
        open={regenOpen}
        onClose={() => { if (!codes) setRegenOpen(false); else { setRegenOpen(false); setCodes(null); } }}
        variant={variant}
        title={codes ? "Your new recovery codes" : "Regenerate recovery codes"}
        description={codes ? "The old codes no longer work." : "Enter a code from your authenticator to confirm. Your old codes stop working."}
        footer={
          codes ? (
            <Button type="button" size={compact ? "lg" : "default"} onClick={() => { setRegenOpen(false); setCodes(null); }}>I've saved these</Button>
          ) : (
            <>
              <Button type="button" variant="outline" size={compact ? "lg" : "default"} onClick={() => setRegenOpen(false)}>Cancel</Button>
              <Button
                type="button"
                size={compact ? "lg" : "default"}
                disabled={regenCode.replace(/\s/g, "").length !== 6 || regenerate.isPending}
                onClick={() => regenerate.mutate({ code: regenCode }, { onSuccess: (r) => setCodes(r.recovery_codes), onError: (e) => toast.error(/invalid code/i.test((e as Error).message) ? "That code isn't right." : (e as Error).message) })}
              >
                {regenerate.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
                Regenerate
              </Button>
            </>
          )
        }
      >
        {codes ? (
          <RecoveryCodes codes={codes} />
        ) : (
          <Field>
            <FieldLabel htmlFor="tfa-regen">Authenticator code</FieldLabel>
            <Input
              id="tfa-regen"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000 000"
              value={regenCode}
              onChange={(e) => setRegenCode(e.target.value)}
              className={cn("font-mono tracking-[0.35em] text-center text-lg h-11", inputCls)}
              autoFocus={!compact}
            />
          </Field>
        )}
      </FormShell>

      {/* Disable */}
      <FormShell
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        variant={variant}
        title="Turn off two-factor authentication"
        description="Confirm with your password and a code from your authenticator (or a recovery code)."
        footer={
          <>
            <Button type="button" variant="outline" size={compact ? "lg" : "default"} onClick={() => setDisableOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="outline"
              size={compact ? "lg" : "default"}
              disabled={!dPassword || !dCode.trim() || disable.isPending}
              onClick={() => disable.mutate({ password: dPassword, code: dCode }, { onSuccess: () => { setDisableOpen(false); toast.success("Two-factor authentication is off"); }, onError: (e) => toast.error((e as Error).message) })}
            >
              {disable.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Turn off
            </Button>
          </>
        }
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="tfa-dpw">Current password</FieldLabel>
            <PasswordField
              id="tfa-dpw"
              value={dPassword}
              onChange={setDPassword}
              autoComplete="current-password"
              placeholder="Enter your password"
              autoFocus={!compact}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tfa-dcode">Authenticator or recovery code</FieldLabel>
            <Input
              id="tfa-dcode"
              autoComplete="one-time-code"
              placeholder="123456 or xxxx-xxxx"
              value={dCode}
              onChange={(e) => setDCode(e.target.value)}
              className={cn("font-mono tracking-wider", inputCls)}
            />
          </Field>
        </FieldGroup>
      </FormShell>
    </Section>
  );
}

/* ---------- Passkeys ---------- */
