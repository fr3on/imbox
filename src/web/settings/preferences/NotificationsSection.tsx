import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { notifyPermission, notifyPrefEnabled, requestNotifyPermission, setNotifyPref, notifySoundEnabled, setNotifySound, playNotificationSound, getNotificationTypePrefs, setNotificationTypePref, type NotificationTypePrefs } from "@/lib/notifications";
import { disablePush, enablePush, pushActive, pushDisabledByUser, pushSupported, sendTestPush, syncPushTypes } from "@/lib/push";
import { Row, Section } from "../parts";

export function NotificationsSection({ compact }: { compact?: boolean }) {
  const [permission, setPermission] = useState(notifyPermission);
  const [pref, setPref] = useState(notifyPrefEnabled);
  const [sound, setSound] = useState(notifySoundEnabled);
  const [typePrefs, setTypePrefs] = useState<NotificationTypePrefs>(getNotificationTypePrefs);
  const on = permission === "granted" && pref;
  // Whether this browser is also set up to be told with the app closed.
  const canPush = pushSupported();
  const [closedOn, setClosedOn] = useState(false);
  useEffect(() => {
    if (on && canPush) void pushActive().then(setClosedOn);
  }, [on, canPush]);
  const toggleClosed = async (v: boolean) => {
    try {
      if (v) {
        const ok = await enablePush();
        setClosedOn(ok);
        if (!ok) toast.error("This browser would not turn it on.");
      } else {
        await disablePush();
        setClosedOn(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const testClosed = async () => {
    try {
      const r = await sendTestPush();
      toast.success(r.delivered ? "Sent. It should arrive in a moment, even with this tab in the background." : "The push service did not accept it. Try turning it off and on again.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggle = async (v: boolean) => {
    if (!v) {
      setNotifyPref(false);
      setPref(false);
      return;
    }
    if (permission === "granted") {
      setNotifyPref(true);
      setPref(true);
      return;
    }
    const p = await requestNotifyPermission();
    setPermission(p);
    setPref(p === "granted");
  };

  const toggleSound = (v: boolean) => {
    setNotifySound(v);
    setSound(v);
    if (v) {
      playNotificationSound();
    }
  };

  const toggleType = (key: keyof NotificationTypePrefs, val: boolean) => {
    setNotificationTypePref(key, val);
    setTypePrefs({ ...typePrefs, [key]: val });
    void syncPushTypes();
  };

  const hint =
    permission === "unsupported"
      ? "Not supported in this browser."
      : permission === "denied"
        ? "Blocked in this browser — allow notifications for this site to turn it back on."
        : "Desktop alerts when new mail lands in the Imbox while you are away from the window.";

  return (
    <Section title="Notifications" collapsible summary={permission === "denied" ? "Blocked" : on ? `${1 + (closedOn ? 1 : 0) + (sound ? 1 : 0) + Object.values(typePrefs).filter(Boolean).length} on` : "Off"}>
      <Row label="Desktop notifications" hint={hint}>
        <Switch
          checked={on}
          disabled={permission === "unsupported" || permission === "denied"}
          onCheckedChange={toggle}
          className={compact ? "scale-110" : undefined}
        />
      </Row>

      {on && canPush && (
        <Row label="When the app is closed" hint={closedOn ? "You'll be told about new mail even if this tab or the app is not open." : "Get notified about new mail even when this tab or the app is closed."}>
          <div className="flex items-center gap-2">
            {closedOn && !pushDisabledByUser() && (
              <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={testClosed}>
                Send a test
              </Button>
            )}
            <Switch checked={closedOn} onCheckedChange={toggleClosed} className={compact ? "scale-110" : undefined} />
          </div>
        </Row>
      )}

      {on && (
        <>
          <Row
            label="Audio chime"
            hint="Play a subtle two-tone chime when a notification arrives."
          >
            <Switch
              checked={sound}
              onCheckedChange={toggleSound}
              className={compact ? "scale-110" : undefined}
            />
          </Row>

          <Row
            label="AI Auto-Agents"
            hint="Notify when an agent drafts a reply or completes a task."
          >
            <Switch
              checked={typePrefs.agent}
              onCheckedChange={(v) => toggleType("agent", v)}
              className={compact ? "scale-110" : undefined}
            />
          </Row>

          <Row
            label="Screener arrivals"
            hint="Notify when first-time senders arrive in the Screener."
          >
            <Switch
              checked={typePrefs.sender}
              onCheckedChange={(v) => toggleType("sender", v)}
              className={compact ? "scale-110" : undefined}
            />
          </Row>

          <Row
            label="Sync health & errors"
            hint="Notify immediately if a mailbox stops syncing or has connection issues."
          >
            <Switch
              checked={typePrefs.sync}
              onCheckedChange={(v) => toggleType("sync", v)}
              className={compact ? "scale-110" : undefined}
            />
          </Row>
        </>
      )}
    </Section>
  );
}
