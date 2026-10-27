import { useEffect, useState } from "react";
import { safeNext } from "../lib/safeNext";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Fingerprint, Loader2 } from "lucide-react";
import { api } from "../api";
import { useAccount } from "../context/AccountContext";
import { AuthLayout } from "./AuthLayout";
import { AuthError, AuthHint, PasswordField } from "../components/AuthParts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);
  // Email first, then the password: the second step is only asked for once the address is in.
  const [step, setStep] = useState<"email" | "password">("email");
  // Second factor step
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const { setupRequired, loading } = useAccount();

  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    nav(safeNext(sp.get("next")), { replace: true });
  };

  useEffect(() => {
    let active = true;
    async function initAutofill() {
      try {
        const { browserSupportsWebAuthnAutofill, startAuthentication } = await import("@simplewebauthn/browser");
        const supported = await browserSupportsWebAuthnAutofill();
        if (!supported || !active) return;
        const options = await api.post<any>("/auth/passkey/login-options", {});
        if (!active) return;
        const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: true });
        if (!active) return;
        await api.post("/auth/passkey/login-verify", { response });
        await finish();
      } catch {
        // Conditional autofill dismissed or not used
      }
    }
    initAutofill();
    return () => {
      active = false;
    };
  }, []);

  if (!loading && setupRequired) return <Navigate to="/signup" replace />;

  const submitPasskey = async () => {
    setBusy(true);
    setErr("");
    try {
      const { startAuthentication, browserSupportsWebAuthn } = await import("@simplewebauthn/browser");
      if (!browserSupportsWebAuthn()) {
        setErr("Your browser doesn't support passkeys.");
        return;
      }
      const options = await api.post<any>("/auth/passkey/login-options", { email: email.trim() || undefined });
      const response = await startAuthentication({ optionsJSON: options });
      await api.post("/auth/passkey/login-verify", { response });
      await finish();
    } catch (ex: any) {
      if (ex.name === "NotAllowedError") {
        // User closed or cancelled TouchID / prompt
        return;
      }
      setErr(ex.message || "Passkey authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<{ mfa_required?: boolean; ticket?: string }>("/auth/login", { email: email.trim(), password });
      if (r.mfa_required && r.ticket) {
        setTicket(r.ticket);
        setCode("");
        return;
      }
      await finish();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/login/2fa", { ticket, code });
      await finish();
    } catch (ex) {
      const msg = (ex as Error).message;
      setErr(/ticket expired/i.test(msg) ? "That took too long. Sign in again." : /too many/i.test(msg) ? "Too many attempts. Sign in again." : "That code isn't right.");
      if (/expired|too many/i.test(msg)) {
        setTicket(null);
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (ticket) {
    return (
      <AuthLayout title="Two-step verification" subtitle={recoveryMode ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}>
        <form onSubmit={submitCode} className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="code">{recoveryMode ? "Recovery code" : "Verification code"}</Label>
            <Input
              id="code"
              inputMode={recoveryMode ? "text" : "numeric"}
              autoComplete="one-time-code"
              placeholder={recoveryMode ? "xxxx-xxxx" : "123456"}
              value={code}
              onChange={(e) => { setCode(e.target.value); if (err) setErr(""); }}
              required
              autoFocus
              spellCheck={false}
              aria-invalid={!!err || undefined}
              className={recoveryMode ? "h-10 font-mono" : "h-11 text-[20px] tracking-[0.35em] font-mono"}
            />
          </div>
          {err ? <AuthError>{err}</AuthError> : null}
          <Button type="submit" className="h-10 w-full" disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Verifying…" : "Verify"}
          </Button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => { setRecoveryMode((v) => !v); setCode(""); setErr(""); }}>
              {recoveryMode ? "Use my authenticator app" : "Use a recovery code"}
            </button>
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => { setTicket(null); setCode(""); setErr(""); }}>
              <ArrowLeft size={12} /> Back
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  const toPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setErr("");
    setStep("password");
  };

  const passkeyButton = (
    <Button type="button" variant="outline" className="h-10 w-full gap-2 font-medium" disabled={busy} onClick={submitPasskey}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Fingerprint className="size-4" />}
      Sign in with a passkey
    </Button>
  );

  const steps = (
    <div className="mb-6 flex gap-1.5" aria-hidden>
      <span className="h-[3px] w-6 rounded-full bg-foreground" />
      <span className={`h-[3px] w-6 rounded-full ${step === "password" ? "bg-foreground" : "bg-border"}`} />
    </div>
  );

  if (step === "password") {
    return (
      <AuthLayout title="Enter your password" subtitle="Then you are in.">
        {steps}
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{email.trim()}</span>
            <button type="button" className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setStep("email"); setPassword(""); setErr(""); }}>
              Change
            </button>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordField id="password" value={password} onChange={(v) => { setPassword(v); if (err) setErr(""); }} autoComplete="current-password" invalid={!!err} onCapsChange={setCaps} autoFocus />
            {caps ? <AuthHint>Caps Lock is on.</AuthHint> : null}
          </div>
          {err ? <AuthError>{err}</AuthError> : null}
          <Button type="submit" className="h-10 w-full" disabled={busy || !password}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/60" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground font-medium">or</span>
            </div>
          </div>
          {passkeyButton}
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" subtitle="Enter your email to continue.">
      {steps}
      <form onSubmit={toPassword} className="space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (err) setErr(""); }}
            required
            autoFocus
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            className="h-10"
          />
        </div>
        {err ? <AuthError>{err}</AuthError> : null}
        <Button type="submit" className="h-10 w-full" disabled={busy || !email.trim()}>
          Continue
        </Button>
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground font-medium">or</span>
          </div>
        </div>
        {passkeyButton}
      </form>
    </AuthLayout>
  );
}
