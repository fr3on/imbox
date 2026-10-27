import { PasswordField } from "@/components/AuthParts";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clearPersistedCache } from "@/lib/persistedCache";
import { AlertTriangle, Check, KeyRound, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMeMutations, api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { PasskeysBlock } from "./PasskeysBlock";
import { TwoFactorBlock } from "./TwoFactorBlock";
import { Row, Section, SectionsContext } from "../parts";

function getPasswordStrength(p: string): { score: number; label: string; color: string; width: string } {
  if (!p) return { score: 0, label: "", color: "bg-muted", width: "w-0" };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/[0-9]/.test(p) || /[^A-Za-z0-9]/.test(p)) score++;

  if (score <= 1) return { score: 1, label: "Weak", color: "bg-amber-500", width: "w-1/3" };
  if (score <= 3) return { score: 2, label: "Good", color: "bg-blue-500", width: "w-2/3" };
  return { score: 3, label: "Strong", color: "bg-emerald-500", width: "w-full" };
}

function getBrowserInfo(): { browser: string; os: string } {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let browser = "Web browser";
  let os = "Desktop";
  if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Microsoft Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";

  if (ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("iPhone")) os = "iOS";
  else if (ua.includes("iPad")) os = "iPadOS";
  else if (ua.includes("Android")) os = "Android";

  return { browser, os };
}

export function SecuritySection({ compact }: { compact?: boolean }) {
  const { password } = useMeMutations();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [all, setAll] = useState<{ all: boolean | null; tick: number }>({ all: null, tick: 0 });
  const [open, setOpen] = useState(false);
  const closeForm = () => {
    setOpen(false);
    setCur("");
    setNext("");
    setConfirm("");
  };

  const strength = getPasswordStrength(next);
  const passwordsMatch = confirm.length > 0 && next === confirm;
  const passwordsMismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = cur && next.length >= 8 && next === confirm && !password.isPending;

  const deviceInfo = useMemo(() => getBrowserInfo(), []);

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    qc.clear();
    clearPersistedCache();
    nav("/login");
  };

  return (
    <SectionsContext.Provider value={all}>
      <div className="mb-3 flex justify-end px-2">
        <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setAll({ all: all.all !== true, tick: all.tick + 1 })}>
          {all.all === true ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <Section title="Password" collapsible defaultOpen summary="Set" description="Use at least 8 characters with a mix of letters and numbers.">
        <Row label="Password" hint="Used with your email address to sign in.">
          <span className="flex items-center gap-3">
            <span className="tracking-[0.2em] text-muted-foreground" aria-hidden="true">{"\u2022".repeat(10)}</span>
            <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls="pw-form" onClick={() => (open ? closeForm() : setOpen(true))}>
              {open ? "Close" : "Change"}
            </Button>
          </span>
        </Row>
        {open && (
        <form
          id="pw-form"
          className={cn("space-y-4 border-t border-border/60 px-4 py-5 sm:px-5", !compact && "max-w-2xl")}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            password.mutate(
              { current: cur, next },
              {
                onSuccess: () => {
                  toast.success("Password changed successfully");
                  closeForm();
                },
                onError: (er) => toast.error((er as Error).message),
              }
            );
          }}
        >
          <Field>
            <FieldLabel htmlFor="pw-cur">Current password</FieldLabel>
            <PasswordField
              id="pw-cur"
              autoFocus
              value={cur}
              onChange={setCur}
              autoComplete="current-password"
              placeholder="Enter current password"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="pw-next">New password</FieldLabel>
              {next && (
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    strength.score === 1 && "text-amber-600 dark:text-amber-400",
                    strength.score === 2 && "text-blue-600 dark:text-blue-400",
                    strength.score === 3 && "text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {strength.label}
                </span>
              )}
            </div>
            <PasswordField
              id="pw-next"
              value={next}
              onChange={setNext}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
            {next && (
              <div className="mt-1.5 space-y-1">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-300", strength.color, strength.width)} />
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-0.5">
                  <span className={next.length >= 8 ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>
                    {next.length >= 8 ? "✓" : "•"} 8+ characters
                  </span>
                  <span className={(/[A-Z]/.test(next) && /[a-z]/.test(next)) ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>
                    {(/[A-Z]/.test(next) && /[a-z]/.test(next)) ? "✓" : "•"} Mixed case
                  </span>
                  <span className={(/[0-9]/.test(next) || /[^A-Za-z0-9]/.test(next)) ? "text-emerald-600 dark:text-emerald-400 font-medium" : ""}>
                    {(/[0-9]/.test(next) || /[^A-Za-z0-9]/.test(next)) ? "✓" : "•"} Numbers/symbols
                  </span>
                </div>
              </div>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="pw-confirm">Confirm new password</FieldLabel>
            <PasswordField
              id="pw-confirm"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              placeholder="Confirm new password"
            />
            {passwordsMatch && (
              <FieldDescription className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                <Check size={13} /> Passwords match
              </FieldDescription>
            )}
            {passwordsMismatch && (
              <FieldDescription className="text-destructive flex items-center gap-1">
                <AlertTriangle size={13} /> Passwords do not match
              </FieldDescription>
            )}
          </Field>
          </div>

          <div className={cn("mt-2 flex items-center gap-2", compact && "flex-col-reverse items-stretch")}>
            <Button
              type="submit"
              size={compact ? "lg" : "sm"}
              className={cn("gap-2", compact && "w-full")}
              disabled={!canSubmit}
            >
              {password.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              Change password
            </Button>
            <Button type="button" variant="outline" size={compact ? "lg" : "sm"} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
        )}
      </Section>

      <PasskeysBlock />

      <TwoFactorBlock compact={compact} />

      <Section title="This device" collapsible summary={`${deviceInfo.browser} on ${deviceInfo.os}`} description="Your current sign-in session.">
        <Row
          label={
            <span className="flex flex-wrap items-center gap-2">
              {deviceInfo.browser} on {deviceInfo.os}
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-500" /> This device
              </span>
            </span>
          }
          hint="The session renews on its own and lasts 30 days."
        >
          <Button type="button" variant="outline" size="sm" onClick={handleLogout} className="gap-1.5 text-muted-foreground hover:text-foreground">
            <LogOut size={13} /> Log out
          </Button>
        </Row>
      </Section>
    </SectionsContext.Provider>
  );
}

/* ---------- Two-factor authentication ---------- */
