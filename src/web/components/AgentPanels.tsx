import { BrandIcon } from "./BrandIcons";
import { useState } from "react";
import { AlertTriangle, Bot, Check, Clock, Copy, KeyRound, Loader2, Plus, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import type { AgentEvent, AgentKey, AgentKeyCreated, AgentMailbox } from "@shared/types";
import { cn } from "@/lib/utils";
import { useAgent, useAgentMutations } from "../api";
import { fmtRelative } from "../lib/format";
import { useCopy } from "../lib/useCopy";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const MAX_ATTEMPTS = 6;

/* ---------- small pieces ---------- */

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Panel({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-muted-foreground">{icon}</span> {title}
        </h3>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A block of code or a secret, with a copy button. */
function CodeBlock({ text, label, wrap }: { text: string; label: string; wrap?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <div className="relative rounded-md bg-muted">
      <pre className={cn("max-h-48 overflow-auto p-3 pr-12 font-mono text-[12px] leading-5", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{text}</pre>
      <Button type="button" size="icon-xs" variant="ghost" aria-label={label} className="absolute right-1.5 top-1.5 text-muted-foreground" onClick={() => copy(text)}>
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

const apiBase = () => `${window.location.origin}/agent/v1`;

function curlExamples(key: string) {
  return [
    `# Unread mail`,
    `curl -H "Authorization: Bearer ${key}" \\`,
    `  "${apiBase()}/messages?unread=1"`,
    ``,
    `# Send a message`,
    `curl -X POST -H "Authorization: Bearer ${key}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"to":"someone@example.com","subject":"Hello","text":"Hi!"}' \\`,
    `  ${apiBase()}/messages`,
  ].join("\n");
}

function expiryLabel(k: AgentKey): string {
  if (k.revoked_at) return `Revoked ${fmtRelative(k.revoked_at)}`;
  if (!k.expires_at) return "Never expires";
  if (k.expires_at <= Date.now()) return `Expired ${fmtRelative(k.expires_at)}`;
  const days = Math.ceil((k.expires_at - Date.now()) / 86_400_000);
  return days <= 1 ? "Expires within a day" : `Expires in ${days} days`;
}

const inactive = (k: AgentKey) => !!k.revoked_at || (!!k.expires_at && k.expires_at <= Date.now());

/* ---------- quick start ---------- */

function QuickStart() {
  return (
    <Panel icon={<Bot size={15} />} title="Connect an agent" hint="Give your agent an API key and this address. It can read this mailbox, and send from it, and nothing else.">
      <div className="grid gap-1.5">
        <div className="text-xs text-muted-foreground">API address</div>
        <CodeBlock text={apiBase()} label="Copy the API address" />
      </div>
      <details className="group text-[13px]">
        <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">Show examples</summary>
        <div className="mt-2 grid gap-2">
          <CodeBlock text={curlExamples("hfa_your_key")} label="Copy the examples" />
          <p className="text-xs text-muted-foreground">
            Endpoints: <code>GET /me</code>, <code>GET /messages</code> (filters: <code>unread=1</code>, <code>direction</code>, <code>after</code>, <code>before</code>, <code>limit</code>), <code>GET /messages/:id</code>,{" "}
            <code>POST /messages</code>, <code>POST /messages/:id/reply</code>, <code>POST /messages/:id/read</code>, and attachments at <code>/messages/:id/attachments/:aid</code>.
          </p>
        </div>
      </details>
    </Panel>
  );
}

/* ---------- keys ---------- */

const EXPIRY: { label: string; days: number | null }[] = [
  { label: "Never", days: null },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

function NewKeyForm({ accountId, onCreated, onCancel }: { accountId: string; onCreated: (k: AgentKeyCreated) => void; onCancel: () => void }) {
  const { createKey } = useAgentMutations(accountId);
  const [name, setName] = useState("");
  const [read, setRead] = useState(true);
  const [sendScope, setSendScope] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const scopes = [...(read ? (["read"] as const) : []), ...(sendScope ? (["send"] as const) : [])];
  const ready = name.trim().length > 0 && scopes.length > 0;
  return (
    <form
      className="grid gap-4 rounded-lg border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || createKey.isPending) return;
        setErr("");
        createKey.mutate({ name: name.trim(), scopes: [...scopes], expires_in_days: days }, { onSuccess: onCreated, onError: (x) => setErr(errText(x)) });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ak-name">Name</FieldLabel>
          <Input id="ak-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Which agent will use this key?" autoFocus autoComplete="off" maxLength={60} />
        </Field>
        <Field>
          <FieldLabel>What it may do</FieldLabel>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox checked={read} onCheckedChange={(v) => setRead(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">Read mail</span>
              <span className="block text-xs text-muted-foreground">List and open messages, download attachments, mark as read.</span>
            </span>
          </label>
          <label className="mt-1 flex cursor-pointer items-start gap-2.5 text-sm">
            <Checkbox checked={sendScope} onCheckedChange={(v) => setSendScope(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">Send mail</span>
              <span className="block text-xs text-muted-foreground">Send and reply as this mailbox, up to 60 messages an hour.</span>
            </span>
          </label>
        </Field>
        <Field>
          <FieldLabel htmlFor="ak-exp">Expires</FieldLabel>
          <select id="ak-exp" value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} className="h-8 w-max rounded-md bg-input px-2.5 text-sm outline-none focus:bg-background focus:ring-1 focus:ring-ring">
            {EXPIRY.map((x) => <option key={x.label} value={x.days ?? ""}>{x.label}</option>)}
          </select>
          <FieldDescription>A key that expires on its own is safer if it is ever lost.</FieldDescription>
        </Field>
      </FieldGroup>
      {err ? <ErrorLine>{err}</ErrorLine> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!ready || createKey.isPending}>
          {createKey.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Create key
        </Button>
      </div>
    </form>
  );
}

function KeyReveal({ k, onDone }: { k: AgentKeyCreated; onDone: () => void }) {
  return (
    <div className="grid gap-3 rounded-lg border border-foreground p-4">
      <div>
        <div className="text-sm font-semibold">Copy your key now</div>
        <p className="text-xs text-muted-foreground">This is the only time it is shown. Imbox keeps only a fingerprint, so a lost key cannot be recovered — make a new one instead.</p>
      </div>
      <CodeBlock text={k.key} label="Copy the key" wrap />
      <details className="text-[13px]">
        <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">Show a ready-to-run example</summary>
        <div className="mt-2"><CodeBlock text={curlExamples(k.key)} label="Copy the example" /></div>
      </details>
      <div className="flex justify-end"><Button onClick={onDone}>I've saved it</Button></div>
    </div>
  );
}

function KeysSection({ mailbox }: { mailbox: AgentMailbox }) {
  const { revokeKey } = useAgentMutations(mailbox.account_id);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<AgentKeyCreated | null>(null);
  const [revoking, setRevoking] = useState<AgentKey | null>(null);
  const active = mailbox.keys.filter((k) => !inactive(k));
  return (
    <Panel
      icon={<KeyRound size={15} />}
      title="API keys"
      hint="One key per agent, so you can switch one off without touching the others."
    >
      {revealed ? <KeyReveal k={revealed} onDone={() => setRevealed(null)} /> : null}
      {creating ? (
        <NewKeyForm accountId={mailbox.account_id} onCancel={() => setCreating(false)} onCreated={(k) => { setCreating(false); setRevealed(k); }} />
      ) : (
        <div><Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus /> New key</Button></div>
      )}
      {mailbox.keys.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No keys yet. Make one to let an agent in.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {mailbox.keys.map((k) => (
            <div key={k.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0", inactive(k) && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">{k.name}</span>
                  <code className="text-xs text-muted-foreground">{k.prefix}…</code>
                </div>
                <div className="text-xs text-muted-foreground">
                  {k.last_used_at ? `Last used ${fmtRelative(k.last_used_at)}` : "Never used"} · {expiryLabel(k)}
                </div>
              </div>
              {k.scopes.map((s) => <Badge key={s} variant="outline" className="font-normal">{s === "read" ? "Read" : "Send"}</Badge>)}
              {inactive(k) ? (
                <Badge variant="outline">{k.revoked_at ? "Revoked" : "Expired"}</Badge>
              ) : (
                <Button size="icon-xs" variant="ghost" aria-label={`Revoke ${k.name}`} className="text-muted-foreground" onClick={() => setRevoking(k)}><BrandIcon name="trash" /></Button>
              )}
            </div>
          ))}
        </div>
      )}
      {active.length > 0 ? null : mailbox.keys.length > 0 ? <p className="text-xs text-muted-foreground">No active keys: no agent can use this mailbox right now.</p> : null}

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revoking?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Anything using this key stops working straight away. This cannot be undone; make a new key if you need one later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => revoking && revokeKey.mutate(revoking.id, { onSuccess: () => toast(`${revoking.name} revoked`), onError: (e) => toast.error(errText(e)) })}>Revoke key</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* ---------- webhook ---------- */

function deliveryLabel(e: AgentEvent): { icon: React.ReactNode; text: string; bad?: boolean } {
  if (e.delivered_at) return { icon: <Check size={13} />, text: `Delivered ${fmtRelative(e.delivered_at)}${e.attempts > 1 ? ` · attempt ${e.attempts}` : ""}` };
  if (e.attempts >= MAX_ATTEMPTS) return { icon: <AlertTriangle size={13} />, text: `Gave up after ${e.attempts} attempts${e.last_error ? ` · ${e.last_error}` : ""}`, bad: true };
  if (e.attempts > 0) return { icon: <RefreshCw size={13} />, text: `Retrying · attempt ${e.attempts}${e.last_error ? ` · ${e.last_error}` : ""}` };
  return { icon: <Clock size={13} />, text: "Waiting to send" };
}

function WebhookSection({ mailbox }: { mailbox: AgentMailbox }) {
  const { setWebhook, testWebhook } = useAgentMutations(mailbox.account_id);
  const [url, setUrl] = useState(mailbox.webhook_url);
  const [err, setErr] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [rotate, setRotate] = useState(false);
  const saved = mailbox.webhook_url;
  const changed = url.trim() !== saved;

  const save = (opts: { rotate_secret?: boolean } = {}) => {
    setErr("");
    setTest(null);
    setWebhook.mutate(
      { url: url.trim() || null, ...opts },
      {
        onSuccess: (r) => {
          if (r.secret) setSecret(r.secret);
          if (!r.webhook_url) toast("Webhook removed");
        },
        onError: (e) => setErr(errText(e)),
      }
    );
  };

  return (
    <Panel icon={<Webhook size={15} />} title="New-mail webhook" hint="Optional. Imbox posts a signed message to your address when mail arrives, within about a minute. Or skip it and poll the API.">
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!setWebhook.isPending) save(); }}>
        <Field>
          <FieldLabel htmlFor="wh-url">Webhook address</FieldLabel>
          <div className="flex gap-2">
            <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-agent.example.com/mail" autoComplete="off" inputMode="url" spellCheck={false} />
            <Button type="submit" variant="outline" disabled={!changed || setWebhook.isPending}>
              {setWebhook.isPending ? <Loader2 className="animate-spin" /> : null} {saved && !url.trim() ? "Remove" : "Save"}
            </Button>
          </div>
        </Field>
        {err ? <ErrorLine>{err}</ErrorLine> : null}
      </form>

      {secret ? (
        <div className="grid gap-2 rounded-lg border border-foreground p-3">
          <div className="text-sm font-semibold">Your signing secret</div>
          <p className="text-xs text-muted-foreground">Shown once. Use it to check that each call really came from here: compute HMAC-SHA256 of <code>timestamp.body</code> and compare it with the <code>x-agent-signature</code> header (<code>t=…,v1=…</code>).</p>
          <CodeBlock text={secret} label="Copy the signing secret" wrap />
          <div className="flex justify-end"><Button size="sm" onClick={() => setSecret(null)}>I've saved it</Button></div>
        </div>
      ) : null}

      {saved ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={testWebhook.isPending || changed} onClick={() => testWebhook.mutate(undefined, { onSuccess: (r) => setTest({ ok: r.ok, text: r.ok ? `Your receiver answered ${r.status}.` : r.error || "No answer." }), onError: (e) => setTest({ ok: false, text: errText(e) }) })}>
            {testWebhook.isPending ? <Loader2 className="animate-spin" /> : <BrandIcon name="sent" />} Send a test
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={setWebhook.isPending || changed} onClick={() => setRotate(true)}><RefreshCw /> Rotate secret</Button>
          {test ? <span className={cn("text-xs", test.ok ? "text-muted-foreground" : "text-destructive")} aria-live="polite">{test.ok ? "✓ " : ""}{test.text}</span> : null}
        </div>
      ) : null}

      {mailbox.recent_events.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Recent deliveries</div>
          {mailbox.recent_events.map((e) => {
            const d = deliveryLabel(e);
            return (
              <div key={e.id} className={cn("flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs last:border-b-0", d.bad ? "text-destructive" : "text-muted-foreground")}>
                {d.icon}
                <span className="min-w-0 flex-1 truncate">{d.text}</span>
                <span className="shrink-0 tabular-nums">{fmtRelative(e.created_at)}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      <AlertDialog open={rotate} onOpenChange={setRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the signing secret?</AlertDialogTitle>
            <AlertDialogDescription>A new secret replaces the old one straight away. Update your receiver with it, or its signature checks will fail.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => save({ rotate_secret: true })}>Rotate secret</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

/* ---------- the dialog ---------- */

function AgentBody({ account, onClose }: { account: { id: string; email: string }; onClose: () => void }) {
  const q = useAgent(account.id);
  const { setEnabled } = useAgentMutations(account.id);
  const [off, setOff] = useState(false);

  if (q.isLoading) return <div className="grid gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError) return <ErrorLine>{errText(q.error)}</ErrorLine>;
  const data = q.data;
  const mailbox = data && "keys" in data ? data : null;

  if (!mailbox) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Agent access lets an AI agent or script use this mailbox through an API key: read its mail, send and reply, and get a nudge when something arrives. Its mail is kept out of your own
          inbox and Screener, and you can still open it from the account menu.
        </p>
        <div>
          <Button disabled={setEnabled.isPending} onClick={() => setEnabled.mutate(true, { onError: (e) => toast.error(errText(e)) })}>
            {setEnabled.isPending ? <Loader2 className="animate-spin" /> : <Bot />} Turn on agent access
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-7">
      <QuickStart />
      <KeysSection mailbox={mailbox} />
      <WebhookSection key={mailbox.webhook_url} mailbox={mailbox} />
      <section className="grid gap-2 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">Turn off agent access</h3>
        <p className="text-xs text-muted-foreground">Deletes every key and queued delivery for this mailbox. The mailbox and its mail stay, and it returns to your unified inbox.</p>
        <div><Button size="sm" variant="outline" onClick={() => setOff(true)}>Turn off agent access</Button></div>
      </section>
      <AlertDialog open={off} onOpenChange={setOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off agent access for {account.email}?</AlertDialogTitle>
            <AlertDialogDescription>All {mailbox.keys.filter((k) => !inactive(k)).length} active keys stop working at once, and the webhook is removed. The mailbox itself is not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setEnabled.mutate(false, { onSuccess: () => { toast("Agent access turned off"); onClose(); }, onError: (e) => toast.error(errText(e)) })}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Agent access for one mailbox: connect an agent, manage its keys and webhook. */
export function AgentDialog({ account, onClose }: { account: { id: string; email: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot size={18} /> Agent access</DialogTitle>
          <DialogDescription className="break-all">{account?.email}</DialogDescription>
        </DialogHeader>
        {account ? <AgentBody key={account.id} account={account} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
