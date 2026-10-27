import { sanitizeEmailHtml } from "@/lib/sanitizeHtml";
import { useNavigate } from "react-router-dom";
import { canRegisterMailto, registerMailtoHandler } from "@/lib/mailtoHandler";
import { isNative } from "@/lib/native";
import { useEffect, useState } from "react";
import { ArrowRight, PenTool } from "lucide-react";
import { toast } from "sonner";
import type { UserSettings } from "@shared/types";
import { cn } from "@/lib/utils";
import { useAccount } from "@/context/AccountContext";
import { useMeMutations } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VacationSection } from "@/components/VacationSection";
import { Row, SavedMark, Section, SectionsProvider } from "../parts";

/** Everything about the mail you write: who it is sent from, how it ends, what answers it while you are away, and what opens a new message. */
export function WritingSection({ compact, onGoToTab }: { compact?: boolean; onGoToTab?: (tab: string) => void }) {
  const { user, accounts, defaultAccount } = useAccount();
  const { update } = useMeMutations();
  const nav = useNavigate();
  const [settings, setSettings] = useState<UserSettings>(user?.settings ?? {});
  const [savedField, setSavedField] = useState<string | null>(null);

  useEffect(() => {
    if (user) setSettings(user.settings ?? {});
  }, [user]);

  if (!user) return null;

  const flashSaved = (field: string) => {
    setSavedField(field);
    window.setTimeout(() => setSavedField((curr) => (curr === field ? null : curr)), 2200);
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
      },
    );
  };
  const inputCls = cn(
    compact ? "w-full h-11 text-[16px]" : "w-64 sm:w-80",
    "bg-background border border-border/80 hover:border-border focus-visible:border-foreground/40 focus-visible:ring-1 focus-visible:ring-foreground/10 rounded-md px-3 text-sm shadow-2xs transition-all",
  );
  const handleTabJump = (tab: string) => {
    if (onGoToTab) onGoToTab(tab);
    else nav(`/settings/${tab}`);
  };

  const sendingId = settings.defaultAccountId || defaultAccount?.id || accounts[0]?.id;
  const sendingFrom = accounts.find((a) => a.id === sendingId)?.email ?? "No mailbox yet";

  return (
    <SectionsProvider>
      {/* Mail Sending Defaults */}
      <Section
        title="Sending defaults"
        collapsible
        defaultOpen
        summary={sendingFrom}
        description="Preferred account and address options when creating new messages and drafts."
      >
          <Row label="Default sending mailbox" hint="Preselected 'From' account when drafting new messages.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "defaultAccountId"} />
              {accounts.length === 0 ? (
                <span className="text-xs text-muted-foreground">No mailboxes connected.</span>
              ) : (
                <Select
                  value={settings.defaultAccountId || defaultAccount?.id || accounts[0]?.id || ""}
                  onValueChange={(val) => saveSettingsPatch({ defaultAccountId: val }, "defaultAccountId")}
                >
                  <SelectTrigger className={inputCls}>
                    <SelectValue placeholder="Select default mailbox" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <div className="flex items-center gap-2">
                          <span className="truncate">{a.email}</span>
                          <Badge variant="outline" className="text-[10px] py-0 px-1 font-normal text-muted-foreground">
                            {a.provider === "domain" ? "Mailbox" : a.provider === "gmail" ? "Gmail" : a.provider === "outlook" ? "Outlook" : "IMAP"}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </Row>

          <Row label="Default reply-to" hint="Optional. Replies to your outgoing messages will be sent here instead.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "replyToEmail"} />
              <Input
                type="email"
                value={settings.replyToEmail ?? ""}
                onChange={(e) => setSettings({ ...settings, replyToEmail: e.target.value })}
                onBlur={() => saveSettingsPatch({ replyToEmail: settings.replyToEmail?.trim() || undefined }, "replyToEmail")}
                className={inputCls}
                placeholder="e.g. replies@example.com"
                aria-label="Default reply-to"
              />
            </div>
          </Row>

          <Row label="Auto-BCC" hint="Optional. Automatically add this address to BCC on outgoing messages.">
            <div className="flex items-center gap-2">
              <SavedMark show={savedField === "autoBcc"} />
              <Input
                type="email"
                value={settings.autoBcc ?? ""}
                onChange={(e) => setSettings({ ...settings, autoBcc: e.target.value })}
                onBlur={() => saveSettingsPatch({ autoBcc: settings.autoBcc?.trim() || undefined }, "autoBcc")}
                className={inputCls}
                placeholder="e.g. archive@example.com"
                aria-label="Auto-BCC"
              />
            </div>
          </Row>

          <Row label="Finish my sentences" hint="In a reply, grey words appear after a pause to finish the sentence. Press Tab to add them, or keep typing. Needs AI set up, and sends the end of what you have written and the email you are answering to your AI provider.">
            <Switch checked={settings.aiComplete === true} onCheckedChange={(v) => saveSettingsPatch({ aiComplete: v })} aria-label="Finish my sentences" />
          </Row>
      </Section>

      {/* Default Signature */}
      <Section
        title="Default signature"
        collapsible
        summary={settings.defaultSignature ? "Set" : "None"}
        description="Used for outgoing messages when an account has no signature of its own."
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground gap-1.5"
            onClick={() => handleTabJump("accounts")}
          >
            <PenTool size={13} />
            <span>Account signatures</span>
            <ArrowRight size={12} />
          </Button>
        }
      >
          <div className="px-4 py-4 sm:px-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">HTML and plain text supported</span>
              <SavedMark show={savedField === "defaultSignature"} />
            </div>
            <Textarea
              rows={4}
              value={settings.defaultSignature ?? ""}
              onChange={(e) => setSettings({ ...settings, defaultSignature: e.target.value })}
              onBlur={() => saveSettingsPatch({ defaultSignature: settings.defaultSignature || undefined }, "defaultSignature")}
              placeholder="Best regards,&#10;Maya Chen&#10;Founder at Chen Studio"
              className="font-mono text-xs resize-y"
            />
            {settings.defaultSignature ? (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
                <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Signature Preview
                </div>
                <div
                  className="text-xs text-foreground/90 space-y-1 prose prose-sm dark:prose-invert max-w-none"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: the signature goes through sanitizeEmailHtml
                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(settings.defaultSignature) }}
                />
              </div>
            ) : null}
          </div>
      </Section>
      {canRegisterMailto() && !isNative && (
        <Section title="Email links" collapsible summary="Not set" description="What happens when you click an address on a web page.">
          <Row label="Open email links in imbox" hint="Clicking a mailto: link anywhere on the web starts a new message here, with the address, subject and text filled in. Your browser asks you to confirm once.">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (registerMailtoHandler() ? toast("Your browser may ask you to confirm. If it does not, look for email links in its settings.") : toast.error("This browser can’t do that."))}
            >
              Use imbox for email links
            </Button>
          </Row>
        </Section>
      )}
      <VacationSection />
    </SectionsProvider>
  );
}
