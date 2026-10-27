import { useState } from "react";
import { ArrowLeft, Globe, Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { StalwartMailbox, StalwartServer } from "@shared/types";
import { cn } from "@/lib/utils";
import { useStalwartDomains, useStalwartMailboxes, useStalwartMutations } from "@/api";
import { AddDomainForm } from "@/stalwart/AddDomainForm";
import { CreateMailboxForm } from "@/stalwart/CreateMailboxForm";
import { PasswordReveal } from "@/stalwart/PasswordReveal";
import { ImportSelect } from "@/stalwart/Resync";
import { ZoneDialog } from "@/stalwart/ZoneDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Stalwart Mailbox Setup Component */
export function StalwartMailboxStep({
  server,
  onDone,
  onBack,
}: {
  server: StalwartServer;
  onDone: (email: string) => void;
  onBack: () => void;
}) {
  const domains = useStalwartDomains(server.id);
  const boxes = useStalwartMailboxes(server.id);
  const { connectMailbox } = useStalwartMutations(server.id);
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<StalwartMailbox | null>(null);
  const [importRecent, setImportRecent] = useState(50);

  if (domains.isLoading || boxes.isLoading) {
    return <Skeleton className="h-44 w-full rounded-xl" />;
  }

  if (domains.isError || boxes.isError) {
    const msg = ((domains.error ?? boxes.error) as Error | null)?.message ?? "Couldn't reach the server.";
    return (
      <div className="space-y-3">
        <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          {msg}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            domains.refetch();
            boxes.refetch();
          }}
        >
          <RefreshCw className="size-3.5 mr-1.5" /> Try again
        </Button>
      </div>
    );
  }

  const enabled = (domains.data ?? []).filter((d) => d.isEnabled);
  const unconnected = (boxes.data ?? []).filter((m) => !m.account_id && !m.is_admin);

  if (enabled.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <h2 className="text-xl font-semibold tracking-tight">Add your domain</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Mailboxes live on a domain you own. Add your domain and Imbox will show you the DNS records to configure.
          </p>
        </div>

        <div className="rounded-xl border border-border p-4 bg-card">
          <AddDomainForm
            serverId={server.id}
            onAdded={() => {
              setZoneOpen(true);
              toast.success("Domain added");
            }}
          />
        </div>
        <ZoneDialog serverId={server.id} domain={zoneOpen ? (domains.data ?? [])[0] ?? null : null} onClose={() => setZoneOpen(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <h2 className="text-xl font-semibold tracking-tight">Set up your mailbox</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Connected to <span className="font-semibold text-foreground">{server.name}</span>. Create or connect a mailbox.
        </p>
      </div>

      {unconnected.length > 0 ? (
        <div className="inline-flex rounded-lg bg-muted p-1 text-xs" role="tablist">
          {(["new", "existing"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors font-medium",
                tab === t ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "new" ? "Create new mailbox" : `Connect existing (${unconnected.length})`}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "new" || unconnected.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <CreateMailboxForm
            serverId={server.id}
            domains={enabled}
            onCreated={(r) => {
              if (r.password) setReveal({ email: r.email, password: r.password });
              else onDone(r.email);
            }}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {unconnected.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-3">
              <Mail className="size-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1 text-sm font-medium truncate">{m.email}</div>
              <Button size="sm" variant="outline" onClick={() => setConfirm(m)}>
                Connect
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setZoneOpen(true)}
          className="underline underline-offset-2 hover:text-foreground inline-flex items-center gap-1"
        >
          <Globe className="size-3" /> View DNS records for {enabled[0].name}
        </button>
      </div>

      <ZoneDialog serverId={server.id} domain={zoneOpen ? enabled[0] : null} onClose={() => setZoneOpen(false)} />

      {reveal ? (
        <PasswordReveal
          open
          title="Your mailbox is ready"
          email={reveal.email}
          password={reveal.password}
          onClose={() => {
            const e = reveal.email;
            setReveal(null);
            onDone(e);
          }}
        />
      ) : null}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Connect {confirm?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Imbox configures this mailbox for synchronization. Apps already using the existing password will continue with the updated login credentials.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ImportSelect value={importRecent} onChange={setImportRecent} id="import-onboarding-alert" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={connectMailbox.isPending}
              onClick={() =>
                confirm &&
                connectMailbox.mutate(
                  { id: confirm.id, import_recent: importRecent },
                  {
                    onSuccess: (r) => {
                      if (r.password) setReveal({ email: r.email, password: r.password });
                      else onDone(r.email);
                    },
                    onError: (e) => toast.error((e as Error).message, { duration: 12000 }),
                  }
                )
              }
            >
              {connectMailbox.isPending ? <Loader2 className="animate-spin mr-1.5 size-4" /> : null}
              Connect Mailbox
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
