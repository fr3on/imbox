import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOAuthMutations, type OAuthCredentialStatus } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const PROVIDER_LABELS: Record<string, { name: string; hint: string; docs: string }> = {
  google: { name: "Google", hint: "Client ID and secret from the Google Cloud OAuth client.", docs: "https://console.cloud.google.com/apis/credentials" },
  microsoft: { name: "Microsoft", hint: "Application (client) ID and a client secret from your Entra app registration.", docs: "https://portal.azure.com" },
};

/** The client ID and secret of one provider's OAuth app, with what to do when the server's environment already supplies them. */
export function CredentialsForm({ c, compact }: { c: OAuthCredentialStatus; compact?: boolean }) {
  const { save } = useOAuthMutations();
  const meta = PROVIDER_LABELS[c.provider];
  // An environment variable is used by default, but you can take over here — otherwise a deployment set up
  // that way could never rotate an expiring secret without editing the server's environment.
  const managed = c.source === "env";
  const [takingOver, setTakingOver] = useState(false);
  const [clientId, setClientId] = useState(c.client_id);
  const [secret, setSecret] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setClientId(c.client_id); }, [c.client_id, dirty]);

  const submit = () =>
    save.mutate(
      { provider: c.provider, client_id: clientId.trim(), client_secret: secret.trim() ? secret.trim() : undefined },
      {
        onSuccess: () => { toast(`${meta.name} credentials saved`); setSecret(""); setDirty(false); setTakingOver(false); },
        onError: (e: unknown) => toast.error((e as Error).message),
      }
    );

  const revert = () =>
    save.mutate(
      { provider: c.provider, override_env: false },
      { onSuccess: () => { toast(`Using the environment variable for ${meta.name} again`); setTakingOver(false); }, onError: (e: unknown) => toast.error((e as Error).message) }
    );

  return (
    <>
      {managed && !takingOver ? (
        <div className="text-[13px] text-muted-foreground space-y-2">
          <div>
            Currently using the <code className="text-[12px]">{c.provider === "google" ? "GOOGLE_CLIENT_SECRET" : "MS_CLIENT_SECRET"}</code>{" "}
            environment variable. Change it in your server's environment, or manage it here instead.
          </div>
          <Button size="sm" variant="outline" onClick={() => { setTakingOver(true); setClientId(c.client_id); }}>
            Manage here instead
          </Button>
        </div>
      ) : (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`cid-${c.provider}`}>Client ID</FieldLabel>
            <Input id={`cid-${c.provider}`} value={clientId} autoComplete="off" onChange={(e) => { setClientId(e.target.value); setDirty(true); }} className={cn(compact && "h-11 text-[16px]")} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`csec-${c.provider}`}>Client secret</FieldLabel>
            <Input id={`csec-${c.provider}`} type="password" autoComplete="off" value={secret} onChange={(e) => { setSecret(e.target.value); setDirty(true); }} placeholder={c.secret_hint ? `Stored · ${c.secret_hint}` : "Client secret"} className={cn(compact && "h-11 text-[16px]")} />
            <FieldDescription className="flex flex-wrap items-center gap-2">
              <span>{meta.hint} Encrypted on your server and never shown again.</span>
              {c.secret_hint ? (
                <button type="button" className="underline underline-offset-2" onClick={() => save.mutate({ provider: c.provider, client_secret: null }, { onSuccess: () => toast("Secret removed") })}>Remove</button>
              ) : null}
            </FieldDescription>
          </Field>
          {managed && takingOver ? (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-[13px]">
              Saving will use these credentials instead of the environment variable. Enter both a client ID and a secret.
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Button size={compact ? "lg" : "sm"} disabled={save.isPending || (!dirty && !secret)} onClick={submit}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
            {takingOver ? <Button size={compact ? "lg" : "sm"} variant="outline" onClick={() => { setTakingOver(false); setSecret(""); setDirty(false); }}>Cancel</Button> : null}
            {c.overriding ? <Button size={compact ? "lg" : "sm"} variant="ghost" onClick={revert} disabled={save.isPending}>Use the Worker secret</Button> : null}
          </div>
        </FieldGroup>
      )}
    </>
  );
}
