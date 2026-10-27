import { BrandIcon } from "@/components/BrandIcons";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Plus, RefreshCw, SlidersHorizontal, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { Account, } from "@shared/types";
import { cn } from "@/lib/utils";
import { useAccount } from "@/context/AccountContext";
import { useAccountMutations, useImapMutations } from "@/api";
import { Avatar, AccountGlyph } from "@/components/Avatar";
import { fmtRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResyncDialog } from "@/stalwart/Resync";
import { AddImapDialog } from "./AddImapDialog";
import { EditImapDialog } from "./EditImapDialog";
import { isBroken, statusOf } from "./status";
import { Danger, SavedMark, Section, SectionsProvider } from "../parts";

/** The address with the name before the @ in bold and the domain quiet, so rows on the same domain are quick to tell apart. */
function AddressText({ email }: { email: string }) {
  const at = email.indexOf("@");
  if (at < 0) return <span className="text-sm font-medium truncate">{email}</span>;
  return (
    <span className="truncate text-sm">
      <span className="font-medium">{email.slice(0, at)}</span>
      <span className="text-muted-foreground">{email.slice(at)}</span>
    </span>
  );
}

const PROVIDER_LABEL: Partial<Record<Account["provider"], string>> = { gmail: "Gmail", outlook: "Outlook", domain: "Domain" };

function AccountBlock({ a, attention }: { a: Account; attention?: boolean }) {
  const { glyphFor, multi } = useAccount();
  const { update, remove, sync, reset } = useAccountMutations();
  const { resync } = useImapMutations();
  const [resyncOpen, setResyncOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [signature, setSignature] = useState(a.signature);
  const [displayName, setDisplayName] = useState(a.display_name);
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editImap, setEditImap] = useState(false);
  useEffect(() => { setSignature(a.signature); setDisplayName(a.display_name); }, [a.signature, a.display_name]);
  const dirty = signature !== a.signature || displayName !== a.display_name;
  const st = statusOf(a);
  const isGmail = a.provider === "gmail" || a.provider === "outlook";
  const save = () =>
    update.mutate(
      { id: a.id, signature, display_name: displayName },
      { onSuccess: () => { setSaved(true); window.setTimeout(() => setSaved(false), 2000); }, onError: (e) => toast.error((e as Error).message) },
    );
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border last:border-b-0">
      {a.provider === "imap" ? <EditImapDialog account={a} open={editImap} onOpenChange={setEditImap} /> : null}
      {a.provider === "imap" ? (
        <ResyncDialog
          open={resyncOpen}
          subject={a.email}
          pending={resync.isPending}
          onClose={() => setResyncOpen(false)}
          onConfirm={(choice) =>
            resync.mutate({ id: a.id, ...choice }, {
              onSuccess: () => { toast(`Re-sync started for ${a.email}`); setResyncOpen(false); },
              onError: (e) => toast.error((e as Error).message),
            })
          }
        />
      ) : null}
      <div className={cn("flex items-center gap-3 px-2 min-h-12 py-1.5", attention && "bg-muted/50")}>
        {multi ? <AccountGlyph glyph={glyphFor(a.id)} /> : <Avatar email={a.email} name={a.display_name} src={a.avatar_url} size={24} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <AddressText email={a.email} />
            {PROVIDER_LABEL[a.provider] ? <Badge variant="outline" className="font-normal text-muted-foreground">{PROVIDER_LABEL[a.provider]}</Badge> : null}
            {a.is_agent ? <Badge variant="secondary" className="font-normal">Agent</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground truncate tnum flex items-center gap-1.5">
            {st.spin && <RefreshCw size={11} className="animate-spin" />}
            {st.label}
            {isGmail && a.last_synced_at && <span>· {fmtRelative(a.last_synced_at)}</span>}
            {a.sync_error && <span className="truncate">· {a.sync_error}</span>}
            {a.sync_status === "disconnected" && a.provider === "imap" && <span>· Sign-in was refused. Open Edit and update the password.</span>}
            {a.sync_status === "error" && <span className="shrink-0">· Imbox tries again by itself.</span>}
            {a.sync_status === "disconnected" && a.provider !== "imap" && <a className="underline underline-offset-2 hover:text-foreground" href="/auth/google/start">Reconnect</a>}
          </div>
          {(a.import_remaining ?? 0) > 0 && (
            <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-border" aria-hidden="true">
              <div className="h-full bg-foreground" style={{ width: `${Math.min(100, Math.max(2, Math.round((1 - (a.import_remaining ?? 0) / Math.max(1, a.import_total ?? a.import_remaining ?? 1)) * 100)))}%` }} />
            </div>
          )}
          {isGmail && a.sync_status !== "disconnected" && !a.photos_synced_at && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>Reconnect Gmail to enable contact photos.</span>
              <a className="underline underline-offset-2 hover:text-foreground" href={`/auth/google/start?login_hint=${encodeURIComponent(a.email)}`}>Reconnect</a>
            </div>
          )}
        </div>
        {(isGmail || a.provider === "imap") && a.sync_status !== "disconnected" && (
          <Button
            size="sm"
            variant={attention ? "default" : "ghost"}
            className={attention ? undefined : "text-muted-foreground"}
            disabled={sync.isPending}
            onClick={() => sync.mutate(a.id, { onSuccess: (r) => toast(r.ok === false ? "Still not working" : `Synced${r.added != null ? ` · ${r.added} new` : ""}`), onError: (e) => toast.error((e as Error).message) })}
          >
            <RefreshCw /> {attention ? "Retry now" : "Sync"}
          </Button>
        )}
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="text-muted-foreground">
            Edit <ChevronDown className={cn("transition-transform duration-100", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="px-2 pt-2 pb-4 pl-11">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor={`dn-${a.id}`}>Display name</FieldLabel>
              <Input id={`dn-${a.id}`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Shown as the sender name" className="max-w-sm" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`sig-${a.id}`}>Signature</FieldLabel>
              <Textarea id={`sig-${a.id}`} rows={3} className="font-mono text-xs" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="HTML allowed. Added under new messages." />
            </Field>
          </FieldGroup>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>Save</Button>
            <SavedMark show={saved && !dirty} />
            <span className="flex-1" />
            {a.provider === "imap" && (
              <>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setResyncOpen(true)}>
                  <RefreshCw /> Re-sync…
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setEditImap(true)}>
                  <SlidersHorizontal /> Server settings
                </Button>
              </>
            )}
            {isGmail && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={reset.isPending} onClick={() => setConfirmReset(true)}>
                <RefreshCw /> Start fresh
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(true)}>
              {isGmail ? <><Unplug /> Disconnect</> : a.provider === "imap" ? <><Unplug /> Remove</> : <><BrandIcon name="trash" /> Delete mailbox</>}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
      <Danger
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Start fresh with ${a.email}?`}
        body="This deletes everything Imbox has synced for this account — threads, contacts, screener decisions, clips, drafts. Gmail itself is untouched. New mail from now on will go through the Screener."
        action="Start fresh"
        onConfirm={() =>
          reset.mutate(a.id, {
            onSuccess: (r) => (r.sync_error ? toast.error(`Reset done, but the first sync failed: ${r.sync_error}`) : toast("Starting fresh — watching for new mail from now on")),
            onError: (e) => toast.error((e as Error).message),
          })
        }
      />
      <Danger
        open={confirm}
        onOpenChange={setConfirm}
        title={isGmail ? `Disconnect ${a.email}?` : a.provider === "imap" ? `Remove ${a.email}?` : `Delete ${a.email}?`}
        body={
          isGmail
            ? "This removes the account and all of its synced mail from Imbox. Nothing changes in Gmail."
            : a.provider === "imap"
              ? "This removes the mailbox and everything Imbox synced for it. The mailbox itself stays on your mail server, untouched, and you can connect it again any time."
              : "This deletes the mailbox and every message stored in it. Mail sent to this address will bounce (or land in the domain's catch-all)."
        }
        action={isGmail ? "Disconnect" : a.provider === "imap" ? "Remove mailbox" : "Delete mailbox"}
        onConfirm={() => remove.mutate(a.id, { onError: (e) => toast.error((e as Error).message) })}
      />
    </Collapsible>
  );
}

/* ---------- Domains ---------- */

export function AccountsSection({ onNewMailbox }: { onNewMailbox?: () => void }) {
  const { accounts, googleConfigured, microsoftConfigured } = useAccount();
  const [sp, setSp] = useSearchParams();
  // /settings/accounts?add=imap opens the dialog straight away (used by the empty-state and menus).
  const [addImap, setAddImap] = useState(() => sp.get("add") === "imap");

  // Consume and clear the ?add query param once opened so it does not re-open when switching tabs
  useEffect(() => {
    if (sp.has("add")) {
      const next = new URLSearchParams(sp);
      next.delete("add");
      setSp(next, { replace: true });
    }
  }, [sp, setSp]);

  const remote = accounts.filter((a) => a.provider !== "domain");
  const boxes = accounts.filter((a) => a.provider === "domain");
  const needs = remote.filter(isBroken);
  // Importing mailboxes come first among the healthy ones, so progress is visible.
  const fine = remote.filter((a) => !isBroken(a)).sort((x, y) => Number((y.import_remaining ?? 0) > 0) - Number((x.import_remaining ?? 0) > 0));
  const FOLD = 5;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll || fine.length <= FOLD + 1 ? fine : fine.slice(0, FOLD);
  const newest = remote.reduce((m, a) => Math.max(m, a.last_synced_at ?? 0), 0);
  return (
    <SectionsProvider>
      <AddImapDialog
        open={addImap}
        onOpenChange={(open) => {
          setAddImap(open);
          if (!open && sp.has("add")) {
            const next = new URLSearchParams(sp);
            next.delete("add");
            setSp(next, { replace: true });
          }
        }}
      />
      <Section
        title="Connected accounts"
        collapsible
        defaultOpen
        summary={remote.length === 0 ? "None yet" : `${remote.length} connected${needs.length ? `, ${needs.length} need${needs.length === 1 ? "s" : ""} attention` : ""}`}
        description="What's connected, and how it signs in."
        actions={
          <div className="flex items-center gap-1">
            {googleConfigured ? (
              <Button size="sm" variant="ghost" className="text-muted-foreground" asChild><a href="/auth/google/start"><Plus /> Connect Gmail</a></Button>
            ) : null}
            {microsoftConfigured ? (
              <Button size="sm" variant="ghost" className="text-muted-foreground" asChild><a href="/auth/microsoft/start"><Plus /> Connect Outlook</a></Button>
            ) : null}
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setAddImap(true)}><Plus /> Add mailbox</Button>
          </div>
        }
      >
        {!googleConfigured || !microsoftConfigured ? (
          <div className="mx-4 mt-3 rounded-md bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground sm:mx-5">
            {!googleConfigured && !microsoftConfigured ? "Gmail and Outlook need" : !googleConfigured ? "Gmail needs" : "Outlook needs"} an OAuth
            client before {!googleConfigured && !microsoftConfigured ? "they" : "it"} can be connected — add the credentials under{" "}
            <Link to="/settings/integrations" className="font-medium underline underline-offset-2">Integrations</Link>. IMAP mailboxes need no setup.
          </div>
        ) : null}
        {remote.length > 1 && (
          <div className="mx-4 my-3 grid grid-cols-2 gap-2 sm:mx-5 sm:grid-cols-4">
            {[
              { n: String(remote.length), l: remote.length === 1 ? "mailbox" : "mailboxes" },
              { n: String(fine.length), l: "up to date" },
              { n: String(needs.length), l: "need attention", hot: needs.length > 0 },
              { n: newest ? fmtRelative(newest).replace(" ago", "") : "none yet", l: "since the newest check" },
            ].map((t) => (
              <div key={t.l} className={cn("rounded-xl border bg-card px-3.5 py-3", t.hot ? "border-foreground/50" : "border-border/70")}>
                <div className="truncate text-xl font-semibold leading-6 tracking-[-0.02em] tnum">{t.n}</div>
                <div className="truncate text-xs text-muted-foreground">{t.l}</div>
              </div>
            ))}
          </div>
        )}
        {needs.length > 0 && (
          <>
            <div className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground sm:px-5">Needs attention</div>
            <div>{needs.map((a) => <AccountBlock key={a.id} a={a} attention />)}</div>
            <div className="border-t border-border/60 px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground sm:px-5">Everything else · {fine.length}</div>
          </>
        )}
        <div>
          {remote.length === 0 ? (
            <div className="px-4 py-4 text-[13px] text-muted-foreground sm:px-5">Nothing connected yet.</div>
          ) : (
            <div>
              {shown.map((a) => <AccountBlock key={a.id} a={a} />)}
              {shown.length < fine.length && (
                <button type="button" onClick={() => setShowAll(true)} className="w-full px-3 py-2.5 text-center text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                  Show the other {fine.length - shown.length} mailboxes
                </button>
              )}
              {showAll && fine.length > FOLD + 1 && (
                <button type="button" onClick={() => setShowAll(false)} className="w-full px-3 py-2.5 text-center text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground">
                  Show fewer
                </button>
              )}
            </div>
          )}
        </div>
      </Section>
      <Section
        title="Domain mailboxes"
        collapsible
        summary={boxes.length === 0 ? "None yet" : `${boxes.length} mailbox${boxes.length === 1 ? "" : "es"}`}
        description="Addresses on your own domains."
        actions={onNewMailbox ? <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onNewMailbox}><Plus /> New mailbox</Button> : undefined}
      >
        <div>
          {boxes.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-4 py-4 text-[13px] text-muted-foreground sm:px-5">
              <span>Receive mail on your own domain from your mail server.</span>
              {onNewMailbox && <Button size="sm" variant="outline" onClick={onNewMailbox}>Add a domain</Button>}
            </div>
          ) : (
            <div>{boxes.map((a) => <AccountBlock key={a.id} a={a} />)}</div>
          )}
        </div>
      </Section>
    </SectionsProvider>
  );
}

/* ---------- Security Section helpers ---------- */
