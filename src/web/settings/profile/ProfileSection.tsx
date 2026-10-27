import { BrandIcon } from "@/components/BrandIcons";
import { useEffect, useState } from "react";
import { Check, Copy, Globe, Mail, ShieldAlert, Clock, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { UserSettings } from "@shared/types";
import { cn } from "@/lib/utils";
import { useAccount } from "@/context/AccountContext";
import { browserTimezone, useMeMutations } from "@/api";
import { ProfileAvatarUploader } from "@/components/ProfileAvatarUploader";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Row, SavedMark, Section } from "../parts";

export function ProfileSection({ compact, onGoToTab }: { compact?: boolean; onGoToTab?: (tab: string) => void }) {
  const { user, accounts, defaultAccount } = useAccount();
  const { update } = useMeMutations();
  const nav = useNavigate();

  const [name, setName] = useState(user?.name ?? "");
  const [settings, setSettings] = useState<UserSettings>(user?.settings ?? {});
  const [savedField, setSavedField] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setSettings(user.settings ?? {});
    }
  }, [user]);

  if (!user) return null;

  const flashSaved = (field: string) => {
    setSavedField(field);
    window.setTimeout(() => setSavedField((curr) => (curr === field ? null : curr)), 2200);
  };

  const handleSaveName = () => {
    const trimmed = name.trim();
    if (trimmed !== user.name) {
      update.mutate(
        { name: trimmed },
        {
          onSuccess: () => flashSaved("name"),
          onError: (e) => toast.error((e as Error).message),
        }
      );
    }
  };

  const saveSettingsPatch = (patch: Partial<UserSettings>, fieldKey?: string) => {
    const next = { ...(user.settings ?? {}), ...settings, ...patch };
    setSettings(next);
    update.mutate(
      { settings: next },
      {
        onSuccess: () => {
          if (fieldKey) flashSaved(fieldKey);
        },
        onError: (e) => toast.error((e as Error).message),
      }
    );
  };

  const inputCls = cn(
    compact ? "w-full h-11 text-[16px]" : "w-64 sm:w-80",
    "bg-background border border-border/80 hover:border-border focus-visible:border-foreground/40 focus-visible:ring-1 focus-visible:ring-foreground/10 rounded-md px-3 text-sm shadow-2xs transition-all"
  );
  const currentTz = browserTimezone() || "UTC";
  const currentAvatar = user.settings?.avatar_url || accounts.find((a) => a.avatar_url)?.avatar_url || "";
  const connectedAvatars = accounts
    .filter((a) => !!a.avatar_url)
    .map((a) => ({ email: a.email, avatar_url: a.avatar_url, provider: a.provider }));

  const handleTabJump = (tab: string) => {
    if (onGoToTab) {
      onGoToTab(tab);
    } else {
      nav(`/settings/${tab}`);
    }
  };

  const copyEmail = () => {
    if (user?.email) {
      navigator.clipboard.writeText(user.email);
      setCopiedEmail(true);
      toast.success("Email copied to clipboard");
      window.setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Profile Banner Card */}
      <div className="mx-2 rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-muted/20 shadow-xs overflow-hidden">
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-5 sm:gap-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5 min-w-0 flex-1">
            <div className="relative shrink-0">
              <ProfileAvatarUploader
                email={user.email}
                name={user.name}
                avatarUrl={currentAvatar}
                connectedAccountAvatars={connectedAvatars}
                onChange={(url) => saveSettingsPatch({ avatar_url: url, avatar_type: url ? "custom" : "initials" }, "avatar")}
              />
            </div>

            <div className="min-w-0 flex-1 text-center sm:text-left space-y-2">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                  {user.name || "Mail User"}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase bg-muted text-muted-foreground border border-border/70">
                  <BrandIcon name="screener" size={10} className="text-muted-foreground" /> Owner
                </span>
                {user.two_factor_enabled ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <BrandIcon name="let-in" size={12} /> 2FA Active
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleTabJump("security")}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 transition-colors cursor-pointer"
                    title="Configure two-factor authentication in Security"
                  >
                    <ShieldAlert size={12} /> Enable 2FA
                  </button>
                )}
              </div>

              <div className="flex items-center justify-center sm:justify-start gap-1.5">
                <span className="font-mono text-xs sm:text-[13px] text-muted-foreground select-all">
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={copyEmail}
                  className="text-muted-foreground/60 hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted cursor-pointer"
                  title="Copy email address"
                  aria-label="Copy email"
                >
                  {copiedEmail ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-center sm:self-start pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTabJump("security")}
              className="h-9 px-3.5 text-xs font-medium gap-1.5 rounded-xl border-border/80 shadow-2xs hover:bg-muted/80 text-foreground transition-all cursor-pointer"
            >
              <BrandIcon name="screener" size={13} className="text-muted-foreground" /> Security
            </Button>
          </div>
        </div>

        {/* Card Footer Metadata Shelf */}
        <div className="border-t border-border/60 bg-muted/25 px-5 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {user.created_at ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={12} className="text-muted-foreground/70" />
                Member since {fmtDate(user.created_at)}
              </span>
            ) : null}

            {user.created_at ? <span className="text-border select-none hidden sm:inline">•</span> : null}

            <button
              type="button"
              onClick={() => handleTabJump("accounts")}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors group cursor-pointer"
              title="View connected mailboxes"
            >
              <Mail size={12} className="text-muted-foreground/70 group-hover:text-foreground transition-colors" />
              <span className="font-medium text-foreground/80 group-hover:underline underline-offset-2">
                {accounts.length} {accounts.length === 1 ? "mailbox" : "mailboxes"} connected
              </span>
            </button>

            {currentTz ? (
              <>
                <span className="text-border select-none hidden sm:inline">•</span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe size={12} className="text-muted-foreground/70" />
                  {currentTz}
                </span>
              </>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => handleTabJump("accounts")}
            className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Manage mailboxes <ArrowRight size={11} />
          </button>
        </div>
      </div>

      {/* Personal Identity Section */}
      <Section
        title="Personal & Professional Identity"
        collapsible
        defaultOpen
        summary={user.name || "Not named yet"}
        description="Your name and details appear across imbox, outgoing headers and contact cards."
      >
          <Row label="Account name" hint="Your primary system name shown in the sidebar and profile.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "name"} />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSaveName}
                className={inputCls}
                placeholder="e.g. Maya"
                aria-label="Account name"
              />
            </div>
          </Row>

          <Row label="Sender display name" hint="Default display name in outgoing From headers (e.g. 'Maya Chen').">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "display_name"} />
              <Input
                value={settings.display_name ?? ""}
                onChange={(e) => setSettings({ ...settings, display_name: e.target.value })}
                onBlur={() => saveSettingsPatch({ display_name: settings.display_name?.trim() || undefined }, "display_name")}
                className={inputCls}
                placeholder={user.name || "Default sender name"}
                aria-label="Sender display name"
              />
            </div>
          </Row>

          <Row label="Job title" hint="Your professional role or title.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "job_title"} />
              <Input
                value={settings.job_title ?? ""}
                onChange={(e) => setSettings({ ...settings, job_title: e.target.value })}
                onBlur={() => saveSettingsPatch({ job_title: settings.job_title?.trim() || undefined }, "job_title")}
                className={inputCls}
                placeholder="e.g. Lead Engineer, Founder"
                aria-label="Job title"
              />
            </div>
          </Row>

          <Row label="Organization" hint="Company, team, or domain affiliation.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "company"} />
              <Input
                value={settings.company ?? ""}
                onChange={(e) => setSettings({ ...settings, company: e.target.value })}
                onBlur={() => saveSettingsPatch({ company: settings.company?.trim() || undefined }, "company")}
                className={inputCls}
                placeholder="e.g. Acme"
                aria-label="Organization"
              />
            </div>
          </Row>

          <Row label="Phone number" hint="Optional contact phone for signatures or contact cards.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "phone"} />
              <Input
                value={settings.phone ?? ""}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                onBlur={() => saveSettingsPatch({ phone: settings.phone?.trim() || undefined }, "phone")}
                className={inputCls}
                placeholder="+1 555-0199"
                aria-label="Phone number"
              />
            </div>
          </Row>

          <Row label="Short bio" hint="Brief profile status or note.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "bio"} />
              <Input
                value={settings.bio ?? ""}
                onChange={(e) => setSettings({ ...settings, bio: e.target.value })}
                onBlur={() => saveSettingsPatch({ bio: settings.bio?.trim() || undefined }, "bio")}
                className={inputCls}
                placeholder="e.g. Building fast systems"
                aria-label="Short bio"
              />
            </div>
          </Row>
      </Section>
    </div>
  );
}
