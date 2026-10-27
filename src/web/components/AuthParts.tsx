import { useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

/** A password input with a show/hide button, and hooks for the Caps Lock warning. */
export function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  placeholder = "Password",
  invalid,
  autoFocus,
  onCapsChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Called on key events with whether Caps Lock is on, so the form can warn before a wrong password. */
  onCapsChange?: (on: boolean) => void;
}) {
  const [show, setShow] = useState(false);
  const caps = (e: React.KeyboardEvent<HTMLInputElement>) => onCapsChange?.(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
        spellCheck={false}
        autoCapitalize="none"
        aria-invalid={invalid || undefined}
        onKeyDown={caps}
        onKeyUp={caps}
        onBlur={() => onCapsChange?.(false)}
        className="h-10 pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

/** A form-level problem, announced to screen readers, in words rather than a code. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-[13px] leading-5 text-destructive">
      <AlertCircle size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** A gentle heads-up that is not an error. */
export function AuthHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
