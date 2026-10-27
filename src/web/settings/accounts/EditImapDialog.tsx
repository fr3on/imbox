import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Account } from "@shared/types";
import { cn } from "@/lib/utils";
import { useImapMutations, api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FormShell } from "../parts";

/** Change an IMAP mailbox's server settings or password without losing its synced mail. */
export function EditImapDialog({ account, open, onOpenChange, variant = "dialog" }: { account: Account; open: boolean; onOpenChange: (o: boolean) => void; variant?: "dialog" | "drawer" }) {
  const { update, test } = useImapMutations();
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [smtpPort, setSmtpPort] = useState(465);
  const [password, setPassword] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      try {
        const r = await api.get<{ imap_host: string; imap_port: number; smtp_host: string; smtp_port: number }>(`/api/accounts/${account.id}/imap`);
        setImapHost(r.imap_host); setImapPort(r.imap_port); setSmtpHost(r.smtp_host); setSmtpPort(r.smtp_port);
        setLoaded(true);
      } catch (e) { toast.error((e as Error).message); }
    })();
  }, [open, loaded, account.id]);

  const close = () => { onOpenChange(false); setPassword(""); setLoaded(false); };
  const submit = () =>
    update.mutate(
      { id: account.id, imap_host: imapHost.trim(), imap_port: imapPort, imap_security: imapPort === 143 ? "starttls" : "tls",
        smtp_host: smtpHost.trim(), smtp_port: smtpPort, smtp_security: smtpPort === 587 ? "starttls" : "tls",
        ...(password.trim() ? { password: password.trim() } : {}) },
      { onSuccess: () => { toast(`${account.email} updated`); close(); },
        onError: (e: unknown) => toast.error("Couldn't connect", { description: (e as Error).message, duration: 12000 }) }
    );

  const mobile = variant === "drawer";
  return (
    <FormShell
      open={open}
      onClose={close}
      variant={variant}
      title={`Edit ${account.email}`}
      description="Checked against both servers before anything is saved. Your mail is kept."
      footer={
        <>
          <Button type="button" variant="outline" size={mobile ? "lg" : "default"} onClick={close}>Cancel</Button>
          <Button type="button" size={mobile ? "lg" : "default"} disabled={!loaded || update.isPending} onClick={submit}>
            {update.isPending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="e-pass">Password</FieldLabel>
          <Input id="e-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Leave blank to keep the current one" className={cn(mobile && "h-11 text-[16px]")} />
          <FieldDescription>Set this when your provider's app password has been rotated. It is also needed if you change the server or the user name.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="e-imap">IMAP server</FieldLabel>
          <div className="flex gap-2">
            <Input id="e-imap" value={imapHost} onChange={(e) => setImapHost(e.target.value)} className={cn("flex-1", mobile && "h-11 text-[16px]")} />
            <Input aria-label="IMAP port" type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} className={cn("w-24", mobile && "h-11 text-[16px]")} />
          </div>
          <FieldDescription>993 for implicit TLS, or 143 for STARTTLS.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="e-smtp">SMTP server</FieldLabel>
          <div className="flex gap-2">
            <Input id="e-smtp" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className={cn("flex-1", mobile && "h-11 text-[16px]")} />
            <Input aria-label="SMTP port" type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} className={cn("w-24", mobile && "h-11 text-[16px]")} />
          </div>
          <FieldDescription>465 for implicit TLS, 587 for STARTTLS. Port 25 is for mail between servers and is not used.</FieldDescription>
        </Field>
        <div>
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(account.id, {
            onSuccess: (r: { ok: boolean; error?: string }) => (r.ok ? toast("Both servers answered") : toast.error(r.error ?? "Failed")),
            onError: (e: unknown) => toast.error((e as Error).message),
          })}>
            {test.isPending ? <Loader2 className="animate-spin" /> : null} Test stored credentials
          </Button>
        </div>
      </FieldGroup>
    </FormShell>
  );
}
