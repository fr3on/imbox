import { Globe, Server } from "lucide-react";
import { cn } from "@/lib/utils";

/** Brand icons for email providers */
export function GoogleBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-5 shrink-0", className)} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

export function MicrosoftBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-5 shrink-0", className)} viewBox="0 0 21 21">
      <path fill="#f25022" d="M1 1h9v9H1z" />
      <path fill="#7fba00" d="M11 1h9v9H11z" />
      <path fill="#00a4ef" d="M1 11h9v9H1z" />
      <path fill="#ffb900" d="M11 11h9v9H11z" />
    </svg>
  );
}

export function ICloudBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-5 shrink-0 text-sky-500 fill-current", className)} viewBox="0 0 24 24">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
    </svg>
  );
}

function FastmailBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("size-5 shrink-0 text-blue-500", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function ZohoBrandIcon({ className }: { className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-0.5 size-4.5 shrink-0", className)}>
      <span className="rounded-[2px] bg-[#e42527]" />
      <span className="rounded-[2px] bg-[#22aa3b]" />
      <span className="rounded-[2px] bg-[#008bd3]" />
      <span className="rounded-[2px] bg-[#f89e22]" />
    </div>
  );
}

function MigaduBrandIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center font-mono font-bold text-[12px] tracking-tight text-amber-600 dark:text-amber-400", className)}>
      M.
    </span>
  );
}

function ServerBrandIcon({ className }: { className?: string }) {
  return <Server className={cn("size-5 shrink-0 text-emerald-600 dark:text-emerald-400", className)} />;
}

function WebmailBrandIcon({ className }: { className?: string }) {
  return <Globe className={cn("size-5 shrink-0 text-purple-600 dark:text-purple-400", className)} />;
}

export function ProviderBrandIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case "gmail":
      return <GoogleBrandIcon className={className} />;
    case "outlook":
      return <MicrosoftBrandIcon className={className} />;
    case "icloud":
      return <ICloudBrandIcon className={className} />;
    case "fastmail":
      return <FastmailBrandIcon className={className} />;
    case "zoho":
    case "zoho-pro":
      return <ZohoBrandIcon className={className} />;
    case "migadu":
      return <MigaduBrandIcon className={className} />;
    case "custom":
      return <ServerBrandIcon className={className} />;
    default:
      return <WebmailBrandIcon className={className} />;
  }
}

export function ProviderTile({ id, className }: { id: string; className?: string }) {
  return (
    <span className={cn("flex size-9.5 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 shadow-2xs", className)}>
      <ProviderBrandIcon id={id} />
    </span>
  );
}

export interface ImapPresetDef {
  id: string;
  name: string;
  category: "cloud" | "domain" | "server";
  badge?: string;
  hint: string;
  imap_host: string;
  smtp_host: string;
  imap_port?: number;
  smtp_port?: number;
  note?: string;
}

export const IMAP_PRESETS: ImapPresetDef[] = [
  {
    id: "gmail",
    name: "Gmail or Google Workspace",
    category: "cloud",
    badge: "App Password",
    hint: "Personal @gmail.com or business Google Workspace accounts.",
    imap_host: "imap.gmail.com",
    smtp_host: "smtp.gmail.com",
    note: "Turn on 2-Step Verification in your Google Account, then generate a 16-letter App Password at myaccount.google.com/apppasswords.",
  },
  {
    id: "outlook",
    name: "Microsoft Outlook / 365",
    category: "cloud",
    badge: "IMAP & SMTP",
    hint: "Personal Outlook.com, Hotmail, or Microsoft 365 business accounts.",
    imap_host: "outlook.office365.com",
    smtp_host: "smtp.office365.com",
    note: "For Microsoft 365 or Outlook, use your full email address and account password (or an app password if MFA is enforced).",
  },
  {
    id: "icloud",
    name: "Apple iCloud Mail",
    category: "cloud",
    badge: "App Password",
    hint: "@icloud.com, @me.com, or @mac.com addresses.",
    imap_host: "imap.mail.me.com",
    smtp_host: "smtp.mail.me.com",
    smtp_port: 587,
    note: "Generate an app-specific password at appleid.apple.com under Sign-In & Security → App-Specific Passwords.",
  },
  {
    id: "fastmail",
    name: "Fastmail",
    category: "cloud",
    badge: "App Password",
    hint: "Fastmail personal or custom domain mailboxes.",
    imap_host: "imap.fastmail.com",
    smtp_host: "smtp.fastmail.com",
    note: "Create an app password in Fastmail under Settings → Privacy & Security.",
  },
  {
    id: "custom",
    name: "Your own server",
    category: "server",
    badge: "Self-Hosted",
    hint: "Stalwart, Dovecot, Postfix (auto-detected as mail.domain).",
    imap_host: "",
    smtp_host: "",
    note: "Type your email address and the server names fill in as mail.<your-domain> on ports 993 and 465. Change them below if your server uses other names.",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    category: "domain",
    badge: "Personal",
    hint: "Personal @zohomail.com accounts on Zoho standard servers.",
    imap_host: "imap.zoho.com",
    smtp_host: "smtp.zoho.com",
    note: "Enable IMAP under Settings → Mail Accounts, and use an app password if two-factor is on. IMAP requires a paid Zoho plan.",
  },
  {
    id: "zoho-pro",
    name: "Zoho, your own domain",
    category: "domain",
    badge: "Organisation",
    hint: "Organisation accounts on Zoho Pro servers.",
    imap_host: "imappro.zoho.com",
    smtp_host: "smtppro.zoho.com",
    note: "Organisation accounts on a custom domain use the 'pro' servers. On a non-US data centre swap .com for .eu, .in or .com.au.",
  },
  {
    id: "migadu",
    name: "Migadu",
    category: "domain",
    badge: "Swiss Host",
    hint: "Your standard Migadu mailbox address and password.",
    imap_host: "imap.migadu.com",
    smtp_host: "smtp.migadu.com",
    note: "Use your standard Migadu mailbox address and password.",
  },
  {
    id: "other",
    name: "Other or webmail",
    category: "server",
    badge: "Manual Setup",
    hint: "cPanel and custom hosts: enter your hostnames directly.",
    imap_host: "",
    smtp_host: "",
    note: "For cPanel-style hosting this is usually mail.yourdomain.com on ports 993 and 465.",
  },
];

export const PRESET_META: Record<string, { name: string; hint: string }> = Object.fromEntries(
  IMAP_PRESETS.map((p) => [p.id, { name: p.name, hint: p.hint }])
);
