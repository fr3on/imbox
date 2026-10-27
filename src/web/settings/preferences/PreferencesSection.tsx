import { BrandIcon } from "@/components/BrandIcons";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import type { UserSettings } from "@shared/types";
import { useAccount } from "@/context/AccountContext";
import { useMeMutations } from "@/api";
import { REPO_IS_GITHUB } from "@shared/buildInfo";
import { Switch } from "@/components/ui/switch";
import { Row, SavedMark, Section, SectionsContext, Toggle } from "../parts";
import { NotificationsSection } from "./NotificationsSection";

export function PreferencesSection({ compact }: { compact?: boolean }) {
  const { user } = useAccount();
  const { update } = useMeMutations();
  const [settings, setSettings] = useState<UserSettings>(user?.settings ?? {});
  const [prefSaved, setPrefSaved] = useState(false);
  const [all, setAll] = useState<{ all: boolean | null; tick: number }>({ all: null, tick: 0 });
  useEffect(() => { if (user) setSettings(user.settings ?? {}); }, [user]);
  if (!user) return null;
  const saveSettings = (s: UserSettings) => {
    setSettings(s);
    update.mutate({ settings: s }, { onSuccess: () => { setPrefSaved(true); window.setTimeout(() => setPrefSaved(false), 2000); }, onError: (e) => toast.error((e as Error).message) });
  };
  const toggleCls = compact ? "w-full grid grid-cols-3" : undefined;
  const itemCls = compact ? "h-10 text-[14px] justify-center" : undefined;
  const theme = { system: "System", light: "Light", dark: "Dark" }[settings.theme ?? "system"];
  const mailOn = (settings.autoLetIn === true ? 1 : 0) + (settings.rescueMail !== false ? 1 : 0);
  // The update check only exists in a build whose source is on GitHub (see src/web/lib/update.ts); elsewhere there is one switch, not two.
  const privacyTotal = REPO_IS_GITHUB ? 2 : 1;
  const privacyOn = (REPO_IS_GITHUB && settings.privacy?.updateCheck !== false ? 1 : 0) + (settings.privacy?.senderPictures !== false ? 1 : 0);
  return (
    <SectionsContext.Provider value={all}>
      <div className="mb-3 flex justify-end px-2">
        <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setAll({ all: all.all !== true, tick: all.tick + 1 })}>
          {all.all === true ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <Section title="Appearance" collapsible defaultOpen summary={`${theme} theme, previews ${settings.showPreviews !== false ? "on" : "off"}`}>
        <Row label="Theme" hint="System follows your device.">
          <Toggle
            className={toggleCls}
            itemClassName={itemCls}
            value={settings.theme ?? "system"}
            options={[
              { value: "system", label: "System", icon: <Monitor /> },
              { value: "light", label: "Light", icon: <Sun /> },
              { value: "dark", label: "Dark", icon: <Moon /> },
            ]}
            onChange={(v) => saveSettings({ ...settings, theme: v as UserSettings["theme"] })}
          />
        </Row>
        <Row label="Show previews in lists" hint="The first line of each message next to the subject.">
          <Switch checked={settings.showPreviews !== false} onCheckedChange={(v) => saveSettings({ ...settings, showPreviews: v })} />
        </Row>
      </Section>
      <Section title="Mail" collapsible summary={`${mailOn} of 2 on, new senders go to ${(settings.defaultScreenTarget ?? "imbox") === "imbox" ? "the Imbox" : "Feed"}`} description="What happens when someone new writes to you." actions={<SavedMark show={prefSaved} />}>
        <Row step="solid" label="People you know skip the queue" hint="Your address book, and anyone answering a mail you sent, go straight to the Imbox. With AI set up, so does anyone it is sure is a person writing to you. Newsletters never do. You can undo each one in the Screener.">
          <Switch checked={settings.autoLetIn === true} onCheckedChange={(v) => saveSettings({ ...settings, autoLetIn: v })} aria-label="Let obvious people in" />
        </Row>
        <Row step="hollow" label="Everyone else waits" hint="In the Screener. When you say yes, their mail goes to:">
          <Toggle
            className={toggleCls}
            itemClassName={itemCls}
            value={(settings.defaultScreenTarget ?? "imbox") === "imbox" ? "imbox" : "feed"}
            options={[
              { value: "imbox", label: "Imbox", icon: <BrandIcon name="imbox" /> },
              { value: "feed", label: "Feed", icon: <BrandIcon name="feed" /> },
            ]}
            onChange={(v) => saveSettings({ ...settings, defaultScreenTarget: v as UserSettings["defaultScreenTarget"] })}
          />
        </Row>
        <Row step="hollow" label="Later, one mail can still reach you" hint="When one mail in Feed looks like it needs you, such as a personal reply or a declined payment, the thread offers to move to the Imbox. The sender stays where they are. Uses AI when it is set up.">
          <Switch checked={settings.rescueMail !== false} onCheckedChange={(v) => saveSettings({ ...settings, rescueMail: v })} aria-label="Offer to move mail to the Imbox" />
        </Row>
      </Section>
      <Section title="Calendar" collapsible summary={settings.autoCalendar === true ? "Deadlines on" : "Off"} description="Dates found in your mail." actions={<SavedMark show={prefSaved} />}>
        <Row label="Put deadlines in my calendar" hint="When a mail in the Imbox or Paper Trail has a due date, such as a domain renewal or a bill, it is added to your calendar as an all-day event, linked to the mail. Meetings and requests stay suggestions on the thread. Needs AI, and is off until you turn it on.">
          <Switch checked={settings.autoCalendar === true} onCheckedChange={(v) => saveSettings({ ...settings, autoCalendar: v })} aria-label="Put deadlines in my calendar" />
        </Row>
      </Section>
      <NotificationsSection compact={compact} />
      <Section title="Privacy" collapsible summary={`${privacyOn} of ${privacyTotal} on`} description={REPO_IS_GITHUB ? "Two things imbox does on its own that reach outside. Both are on until you turn them off." : "One thing imbox does on its own that reaches outside. It is on until you turn it off."} actions={<SavedMark show={prefSaved} />}>
        {REPO_IS_GITHUB && (
          <Row label="Look for new versions" hint="Your browser asks GitHub for the newest release, at most every six hours. GitHub sees your IP address and that you run imbox, never any mail.">
            <Switch checked={settings.privacy?.updateCheck !== false} onCheckedChange={(v) => saveSettings({ ...settings, privacy: { ...settings.privacy, updateCheck: v } })} aria-label="Look for new versions" />
          </Row>
        )}
        <Row label="Pictures of senders" hint="Your server asks Gravatar, a sender's own website and Cloudflare's public DNS for a face or a logo. Off: nobody is contacted, and people show as initials.">
          <Switch checked={settings.privacy?.senderPictures !== false} onCheckedChange={(v) => saveSettings({ ...settings, privacy: { ...settings.privacy, senderPictures: v } })} aria-label="Pictures of senders" />
        </Row>
      </Section>
    </SectionsContext.Provider>
  );
}
