import { useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { useCalendarSourceMutations } from "../../api";
import { FormShell } from "../../settings/parts";
import { isGooglePublicCalendarLink } from "../../lib/calendarLinks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** `bad_feed`/`bad_url` reach the client as the bare code; say what actually went wrong. */
export function feedMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/^bad url$/i.test(m)) return "That link should start with https:// or webcal://.";
  if (/^bad feed$/i.test(m)) return "That link didn't return a calendar. Open it in a browser to check it's an .ics feed.";
  return m || "That link couldn't be subscribed to.";
}

export function SubscribeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { subscribe } = useCalendarSourceMutations();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const close = () => { setUrl(""); setName(""); setErr(""); onClose(); };

  const submit = () => {
    const u = url.trim();
    if (!u) return;
    setErr("");
    subscribe.mutate(
      { url: u, name: name.trim() || undefined },
      {
        onSuccess: (c) => { toast(`Subscribed to ${c.name}`); close(); },
        onError: (e) => setErr(feedMessage(e)),
      },
    );
  };

  return (
    <FormShell
      open={open}
      onClose={close}
      title="Subscribe to a calendar link"
      description="Read-only, refreshed about once an hour."
      footer={
        <>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button disabled={!url.trim() || subscribe.isPending} onClick={submit}>
            <Link2 /> Subscribe
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="https://example.com/calendar.ics"
          aria-label="Calendar link"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="url"
        />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Calendar name" />
        {err && <p className="text-[13px]">{err}</p>}
        {isGooglePublicCalendarLink(url) && (
          <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs leading-5 text-foreground" role="alert">
            That is Google’s <span className="font-medium">public</span> address. Unless the calendar is shared publicly with details, it carries only busy times, with no titles, so every event shows as “Busy”. Use the <span className="font-medium">Secret address in iCal format</span> instead; it contains <span className="font-mono">/private-</span> and a long code.
          </p>
        )}
        <p className="text-xs text-muted-foreground">For a Google calendar: Google Calendar → Settings → pick the calendar → Integrate calendar → “Secret address in iCal format”.</p>
      </div>
    </FormShell>
  );
}
