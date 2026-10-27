import { BrandIcon } from "@/components/BrandIcons";
import { useState } from "react";
import { ChevronDown, Globe, Plus, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";
import type { Domain } from "@shared/types";
import { cn } from "@/lib/utils";
import { domainErrorMessage, useDomainMutations, useDomains, useStalwartServerMutations, useStalwartServers } from "@/api";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AddDomainForm } from "@/stalwart/AddDomainForm";
import { ConnectServerForm } from "@/stalwart/ConnectServerForm";
import { ServerHeader } from "@/stalwart/ServerHeader";
import { StalwartDomainRows } from "@/stalwart/StalwartDomainRows";
import { Danger, FormShell, Section, SectionsProvider } from "../parts";
import { ReceivingSteps } from "./ReceivingSteps";

export function DomainBadges({ d }: { d: Domain }) {
  const status = d.status === "active" ? "Active" : d.status === "error" ? "Error" : "Pending";
  const sending = d.sending === "resend" ? "Sends via Resend" : "No outbound";
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <Badge variant={d.status === "active" ? "default" : "outline"} className={cn("font-normal", d.status !== "active" && "text-muted-foreground")}>{status}</Badge>
      <Badge variant="outline" className="font-normal text-muted-foreground">{sending}</Badge>
    </span>
  );
}

export function NewMailboxDialog({ d, open, onOpenChange, variant = "dialog" }: { d: Domain; open: boolean; onOpenChange: (o: boolean) => void; variant?: "dialog" | "drawer" }) {
  const { createMailbox } = useDomainMutations();
  const [local, setLocal] = useState("");
  const [name, setName] = useState("");
  const [catchAll, setCatchAll] = useState(d.mailboxes.length === 0);
  const close = () => { onOpenChange(false); setLocal(""); setName(""); };
  const submit = () =>
    createMailbox.mutate({ domain_id: d.id, local_part: local.trim().toLowerCase(), display_name: name.trim(), catch_all: catchAll }, { onSuccess: (a) => { toast(`${a.email} is ready`); close(); }, onError: (er) => toast.error(domainErrorMessage(er)) });
  const mobile = variant === "drawer";
  return (
    <FormShell
      open={open}
      onClose={close}
      variant={variant}
      title={`New mailbox on ${d.name}`}
      description="Mail to this address lands in your unified Imbox like any other account."
      footer={
        <>
          <Button type="button" variant="outline" size={mobile ? "lg" : "default"} onClick={close}>Cancel</Button>
          <Button type="button" size={mobile ? "lg" : "default"} disabled={!local.trim() || createMailbox.isPending} onClick={submit}>Create mailbox</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (local.trim()) submit(); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="mb-local">Address</FieldLabel>
            <div className={cn("flex items-center rounded-md bg-input focus-within:bg-background focus-within:ring-1 focus-within:ring-ring", mobile && "h-11")}>
              <input id="mb-local" autoFocus={!mobile} value={local} onChange={(e) => setLocal(e.target.value)} placeholder="hello" className={cn("flex-1 min-w-0 bg-transparent px-2.5 outline-none placeholder:text-muted-foreground", mobile ? "h-11 text-[16px]" : "h-8 text-sm")} pattern="[A-Za-z0-9._+\-]{1,64}" required />
              <span className="pr-2.5 text-sm text-muted-foreground">@{d.name}</span>
            </div>
            <FieldDescription>Letters, numbers, dots, dashes, plus or underscores.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="mb-name">Display name</FieldLabel>
            <Input id="mb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Farhan" className={cn(mobile && "h-11 text-[16px]")} />
          </Field>
          <Field orientation="horizontal">
            <Switch id="mb-catch" checked={catchAll} onCheckedChange={setCatchAll} />
            <div>
              <FieldLabel htmlFor="mb-catch">Catch-all</FieldLabel>
              <FieldDescription>Also receive mail sent to any other address on {d.name}.</FieldDescription>
            </div>
          </Field>
        </FieldGroup>
      </form>
    </FormShell>
  );
}

function DomainBlock({ d }: { d: Domain }) {
  const { verify, patch, remove } = useDomainMutations();
  const [open, setOpen] = useState(d.status !== "active" || d.mailboxes.length === 0);
  const [newBox, setNewBox] = useState(false);
  const [del, setDel] = useState(false);
  const check = () => verify.mutate(d.id, { onSuccess: (r) => toast(r.status === "active" ? `${d.name} is receiving mail` : `${d.name}: ${r.error ?? "no mail has arrived yet"}`), onError: (e) => toast.error(domainErrorMessage(e)) });
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border last:border-b-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-2 min-h-12 py-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Globe size={16} className="text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{d.name}</span>
              <DomainBadges d={d} />
            </div>
            <div className="text-xs text-muted-foreground tnum mt-0.5">
              {d.mailboxes.length} mailbox{d.mailboxes.length === 1 ? "" : "es"}
              {d.error && <span> · {d.error}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 pl-7 sm:pl-0 shrink-0">
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={verify.isPending} onClick={check}>
          <RefreshCw className={cn(verify.isPending && "animate-spin")} /> Check
        </Button>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="text-muted-foreground">
            Details <ChevronDown className={cn("transition-transform duration-100", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        <div className="pl-9 pr-2 pb-5 space-y-5">
          <ReceivingSteps d={d} checking={verify.isPending} onCheck={check} onNewMailbox={() => setNewBox(true)} />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="text-xs font-medium text-muted-foreground flex-1">Mailboxes</div>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setNewBox(true)}>
                <Plus /> New mailbox
              </Button>
            </div>
            {d.mailboxes.length === 0 ? (
              <div className="text-[13px] text-muted-foreground py-1">No mailboxes yet. Create one to start receiving.</div>
            ) : (
              <div>
                {d.mailboxes.map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5 h-9 text-sm">
                    <Avatar email={m.email} name={m.display_name} src={m.avatar_url} size={20} />
                    <span className="truncate">{m.email}</span>
                    {m.display_name && <span className="text-muted-foreground truncate">· {m.display_name}</span>}
                    {d.catch_all_account_id === m.id && <Badge variant="secondary" className="font-normal text-muted-foreground">catch-all</Badge>}
                  </div>
                ))}
                <div className="text-xs text-muted-foreground mt-1">Signatures, display names and deletion live under Accounts.</div>
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 items-center">
            <div>
              <div className="text-sm">Catch-all mailbox</div>
              <div className="text-xs text-muted-foreground">Where mail to unknown addresses on {d.name} goes. Off means it bounces.</div>
            </div>
            <Select value={d.catch_all_account_id ?? "none"} onValueChange={(v) => patch.mutate({ id: d.id, catch_all_account_id: v === "none" ? null : v }, { onError: (e) => toast.error(domainErrorMessage(e)) })}>
              <SelectTrigger size="sm" className="min-w-40"><SelectValue /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="none">Off (bounce)</SelectItem>
                {d.mailboxes.map((m) => <SelectItem key={m.id} value={m.id}>{m.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="text-[13px] text-muted-foreground">
            {d.sending === "resend" && <>Outbound mail from these mailboxes goes through Resend. Make sure {d.name} is verified there.</>}
            {d.sending === "none" && <>Outbound isn't configured yet, so these mailboxes can receive but not send. Set a <code className="font-mono text-xs">RESEND_API_KEY</code> secret and verify {d.name} in Resend.</>}
          </div>

          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setDel(true)}><BrandIcon name="trash" /> Remove domain</Button>
          </div>
        </div>
      </CollapsibleContent>
      <NewMailboxDialog d={d} open={newBox} onOpenChange={setNewBox} />
      <Danger
        open={del}
        onOpenChange={setDel}
        title={`Remove ${d.name}?`}
        body="Deletes every mailbox on it and all of their mail from Imbox."
        action="Remove domain"
        onConfirm={() => remove.mutate(d.id, { onError: (e) => toast.error(domainErrorMessage(e)) })}
      />
    </Collapsible>
  );
}

export function AddDomainDialog({ open, onOpenChange, variant = "dialog" }: { open: boolean; onOpenChange: (o: boolean) => void; variant?: "dialog" | "drawer" }) {
  const { create } = useDomainMutations();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const close = () => { onOpenChange(false); setName(""); setErr(""); };
  const submit = () => {
    setErr("");
    create.mutate(
      { name: name.trim().toLowerCase() },
      {
        onSuccess: (d) => { toast(`${d.name} added. Finish the setup steps, then send a test message.`); close(); },
        onError: (er) => setErr(domainErrorMessage(er)),
      },
    );
  };
  const mobile = variant === "drawer";
  return (
    <FormShell
      open={open}
      onClose={close}
      variant={variant}
      title="Add a domain"
      description="Your own mail server hands the domain's mail to Imbox over HTTP. You get the steps after adding it."
      footer={
        <>
          <Button type="button" variant="outline" size={mobile ? "lg" : "default"} onClick={close}>Cancel</Button>
          <Button type="button" size={mobile ? "lg" : "default"} disabled={!name.trim() || create.isPending} onClick={submit}>Add domain</Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) submit(); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="dom-name">Domain</FieldLabel>
            <Input id="dom-name" autoFocus={!mobile} value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" required autoCapitalize="none" autoCorrect="off" inputMode="url" className={cn(mobile && "h-11 text-[16px]")} />
            {err && <FieldDescription className="text-foreground">{err}</FieldDescription>}
          </Field>
        </FieldGroup>
      </form>
    </FormShell>
  );
}

/** Where a new domain will live. Behind a mail server that forwards to Imbox, or on a Stalwart server of your own. */
function AddDomainChoices({ onOwn, onStalwart, hasServer }: { onOwn: () => void; onStalwart: () => void; hasServer: boolean }) {
  const card = "flex flex-col items-start gap-1 rounded-xl border border-border/70 bg-card p-4 text-left transition-colors hover:bg-muted/40";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button type="button" className={card} onClick={onOwn}>
        <span className="flex items-center gap-2 text-sm font-semibold"><Globe size={15} /> Behind my mail server</span>
        <span className="text-[13px] text-muted-foreground">Your mail server (Postfix, Mailcow, a forwarder) hands each message to Imbox over HTTP. Send with Resend.</span>
      </button>
      <button type="button" className={card} onClick={onStalwart}>
        <span className="flex items-center gap-2 text-sm font-semibold"><Server size={15} /> On a Stalwart server</span>
        <span className="text-[13px] text-muted-foreground">{hasServer ? "Imbox creates the domain and its mailboxes on your server." : "Connect your own mail server first. Imbox then creates domains and mailboxes on it."}</span>
      </button>
    </div>
  );
}

/** Settings, Domains and servers: every domain you host mail on, whether it forwards to Imbox or lives on a Stalwart server, in one list. */
export function DomainsSection() {
  const cf = useDomains();
  const servers = useStalwartServers();
  const { remove } = useStalwartServerMutations();
  const [choose, setChoose] = useState(false);
  const [addOwn, setAddOwn] = useState(false);
  const [addStalwart, setAddStalwart] = useState(false);
  const [serverId, setServerId] = useState<string | null>(null);
  const list = cf.data ?? [];
  const boxes = servers.data ?? [];
  const server = boxes.find((x) => x.id === serverId) ?? boxes[0];
  const nothing = !cf.isLoading && !servers.isLoading && list.length === 0 && boxes.length === 0;

  const loading = cf.isLoading || servers.isLoading;

  return (
    <SectionsProvider>
      {loading && (
        <div className="space-y-2 px-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      )}
      {cf.error && <div className="px-2 text-[13px] text-muted-foreground">{(cf.error as Error).message}</div>}

      {nothing ? (
        <Section
          title="Domains"
          collapsible
          defaultOpen
          summary="None yet"
          description="Your own addresses, wherever they are hosted."
          actions={<Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setChoose(true)}><Plus /> Add domain</Button>}
        >
          <div className="px-4 py-4 sm:px-5">
            <p className="mb-3 text-[13px] text-muted-foreground">No domains yet. Choose where the first one will live.</p>
            <AddDomainChoices hasServer={false} onOwn={() => setAddOwn(true)} onStalwart={() => setAddStalwart(true)} />
          </div>
        </Section>
      ) : (
        !loading && (
          <>
            <Section
              title="Domains"
              collapsible
              defaultOpen
              summary={boxes.length ? `${list.length} forwarded, ${boxes.length} on Stalwart` : `${list.length} domain${list.length === 1 ? "" : "s"}`}
              description="Your own addresses, wherever they are hosted."
              actions={<Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setChoose(true)}><Plus /> Add domain</Button>}
            >
              {list.length === 0 && boxes.length === 0 ? null : (
                <div>
                  {list.map((d) => <DomainBlock key={d.id} d={d} />)}
                  {boxes.map((sv) => <StalwartDomainRows key={sv.id} server={sv} />)}
                </div>
              )}
            </Section>
            <Section
              title="Mail servers"
              collapsible
              summary={boxes.length ? `Yours, and ${boxes.length} Stalwart` : "Yours"}
              description="Where the mail for those domains arrives."
            >
              <div className="space-y-2 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-3">
                  <div className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground"><Globe size={16} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Your mail server</div>
                    <div className="text-xs text-muted-foreground">Forwards to imbox over HTTP · {list.length} domain{list.length === 1 ? "" : "s"}</div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setAddOwn(true)}><Plus /> Add domain</Button>
                </div>
                {boxes.map((sv) => (
                  <ServerHeader key={sv.id} server={sv} onForget={() => remove.mutate(sv.id, { onSuccess: () => toast("Server forgotten"), onError: (e) => toast.error((e as Error).message) })} />
                ))}
                {boxes.length === 0 && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3">
                    <div className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground"><Server size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">A Stalwart mail server</div>
                      <div className="text-xs text-muted-foreground">Run your own mail server and manage its domains and mailboxes from here.</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setAddStalwart(true)}>Connect server</Button>
                  </div>
                )}
              </div>
            </Section>
          </>
        )
      )}

      <AddDomainDialog open={addOwn} onOpenChange={setAddOwn} />

      <Dialog open={choose} onOpenChange={setChoose}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add a domain</DialogTitle>
            <DialogDescription>Where should this domain&apos;s mail live?</DialogDescription>
          </DialogHeader>
          <AddDomainChoices hasServer={boxes.length > 0} onOwn={() => { setChoose(false); setAddOwn(true); }} onStalwart={() => { setChoose(false); setAddStalwart(true); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={addStalwart} onOpenChange={setAddStalwart}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{server ? "Add a domain on your Stalwart server" : "Connect a Stalwart server"}</DialogTitle>
            <DialogDescription>
              {server ? "Imbox creates the domain on the server and shows the DNS records to publish." : "Imbox creates domains and mailboxes on your own Stalwart mail server, and connects each mailbox here."}
            </DialogDescription>
          </DialogHeader>
          {server ? (
            <div className="space-y-3">
              {boxes.length > 1 && (
                <select aria-label="Server" value={server.id} onChange={(e) => setServerId(e.target.value)} className="h-8 w-full rounded-md bg-input px-2.5 text-sm outline-none focus:bg-background focus:ring-1 focus:ring-ring">
                  {boxes.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                </select>
              )}
              <AddDomainForm serverId={server.id} onCancel={() => setAddStalwart(false)} onAdded={(d) => { setAddStalwart(false); toast(`${d.name} added. Open its DNS records to publish them.`); }} />
            </div>
          ) : (
            <ConnectServerForm autoFocus onCancel={() => setAddStalwart(false)} onConnected={(sv) => { setServerId(sv.id); toast(`Connected to ${sv.name}. Now add a domain.`); }} />
          )}
        </DialogContent>
      </Dialog>
    </SectionsProvider>
  );
}

/* ---------- Sections (shared by desktop tabs and the mobile screens) ---------- */
