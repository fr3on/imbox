import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api } from "../api";
import { useAccount } from "../context/AccountContext";
import { passwordStrength } from "../lib/passwordStrength";
import { AuthLayout } from "./AuthLayout";
import { AuthError, PasswordField } from "../components/AuthParts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STRENGTH = ["", "Too short or easy to guess.", "Fine. A longer one is better.", "Good.", "Strong."];

// First run only: creates the single owner of this Imbox instance.
export default function Signup() {
  const { setupRequired, loading, user } = useAccount();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const strength = passwordStrength(password);

  if (user) return <Navigate to="/" replace />;
  if (!loading && !setupRequired) return <Navigate to="/login" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/signup", { email, name, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/welcome", { replace: true });
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="This is a private, single-owner inbox. You only do this once.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="name" className="h-10" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="h-10" />
          <div className="text-xs text-muted-foreground">Used to sign in here. It can be any address.</div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordField id="password" value={password} onChange={setPassword} placeholder="At least 8 characters" autoComplete="new-password" invalid={!!err} />
          <div className="mt-1 flex gap-1" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={`h-[3px] flex-1 rounded-full ${n <= strength ? "bg-foreground" : "bg-border"}`} />
            ))}
          </div>
          <div className="text-xs text-muted-foreground" aria-live="polite">
            {strength ? STRENGTH[strength] : "At least 8 characters."}
          </div>
        </div>
        {err ? <AuthError>{err}</AuthError> : null}
        <Button type="submit" className="h-10 w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Create account
        </Button>
        <p className="text-xs text-muted-foreground">Next you connect a mailbox: your own mail server, Gmail, Outlook or any IMAP account.</p>
      </form>
    </AuthLayout>
  );
}
