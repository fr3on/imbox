import { Button } from "@/components/ui/button";
import { Bell, X } from "lucide-react";
import { useState } from "react";
import { notifyPermission, requestNotifyPermission } from "../lib/notifications";

const DISMISS_KEY = "inbox.notify.dismissed";

/** Shown once a session until the browser's own permission has actually been asked. */
export function NotifyBanner() {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === "1");
  const [permission, setPermission] = useState(notifyPermission);
  if (dismissed || permission !== "default") return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-[13px]">
      <Bell size={15} className="shrink-0 text-muted-foreground" />
      <span className="flex-1">Turn on notifications to hear about new mail without keeping this tab open.</span>
      <Button size="sm" variant="outline" onClick={() => requestNotifyPermission().then(setPermission)}>
        Turn on
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" className="text-muted-foreground" onClick={dismiss}>
        <X />
      </Button>
    </div>
  );
}
