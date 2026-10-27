import { useState } from "react";
import { ChevronDown, Loader2, Server } from "lucide-react";
import type { StalwartServer } from "@shared/types";
import { cn } from "@/lib/utils";
import { useStalwartServerMutations } from "@/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorLine, errText } from "./parts";

const API_KEY_DOCS = "https://stalw.art/docs/auth/authentication/api-key/";

export function ConnectServerForm({ onConnected, onCancel, autoFocus }: { onConnected: (s: StalwartServer) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const { create } = useStalwartServerMutations();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [err, setErr] = useState("");

  const submit = () => {
    setErr("");
    create.mutate(
      {
        name: name.trim() || undefined,
        base_url: url.trim(),
        api_key: key.trim(),
        imap_host: imapHost.trim() || undefined,
        imap_port: Number(imapPort) || undefined,
        smtp_host: smtpHost.trim() || undefined,
        smtp_port: Number(smtpPort) || undefined,
      },
      {
        onSuccess: (s) => {
          setKey("");
          onConnected(s);
        },
        onError: (e) => setErr(errText(e)),
      }
    );
  };
  const ready = url.trim().length > 8 && key.trim().length >= 8;

  return (
    <form
      className="p-4 grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) submit();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sw-url">Server address</FieldLabel>
          <Input id="sw-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mail.example.com" autoFocus={autoFocus} autoComplete="off" inputMode="url" />
          <FieldDescription>Where you open Stalwart's admin page. Must be https.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="sw-key">API key</FieldLabel>
          <Input id="sw-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the key from Stalwart" autoComplete="off" />
          <FieldDescription>
            In Stalwart's admin, open your administrator account and create an API key.{" "}
            <a href={API_KEY_DOCS} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">How to create one</a>. It is stored encrypted and never shown again.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <Collapsible open={showMore} onOpenChange={setShowMore}>
        <CollapsibleTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronDown size={13} className={cn("transition-transform", showMore && "rotate-180")} /> More options
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <FieldGroup className="pt-3">
            <Field>
              <FieldLabel htmlFor="sw-name">Name</FieldLabel>
              <Input id="sw-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the server's host name" />
            </Field>
            <Field>
              <FieldLabel htmlFor="sw-imap">Mail servers</FieldLabel>
              <div className="flex gap-2">
                <Input id="sw-imap" aria-label="IMAP server" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="IMAP host (default: same as above)" className="flex-1" />
                <Input aria-label="IMAP port" type="number" value={imapPort} onChange={(e) => setImapPort(e.target.value)} className="w-24" />
              </div>
              <div className="flex gap-2 mt-2">
                <Input aria-label="SMTP server" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="SMTP host (default: same as above)" className="flex-1" />
                <Input aria-label="SMTP port" type="number" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="w-24" />
              </div>
              <FieldDescription>Only if your mail host differs from the admin address. Ports 993 and 465 use TLS; 143 and 587 use STARTTLS.</FieldDescription>
            </Field>
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      {err ? <ErrorLine>{err}</ErrorLine> : null}

      <div className="flex items-center justify-end gap-2">
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" disabled={!ready || create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Server />} Connect server
        </Button>
      </div>
    </form>
  );
}
