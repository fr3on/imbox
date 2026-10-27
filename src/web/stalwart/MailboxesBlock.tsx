import { BrandIcon } from "@/components/BrandIcons";
import { useState } from "react";
import { Bot, ChevronDown, Loader2, Mail, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import type { StalwartMailbox, StalwartServer } from "@shared/types";
import { cn } from "@/lib/utils";
import { useImapMutations, useStalwartDomains, useStalwartMailboxes, useStalwartMutations } from "@/api";
import { AgentDialog } from "@/components/AgentPanels";
import { ALL_DOMAINS, domainCounts, filterMailboxes, groupByDomain } from "@/lib/mailboxFilter";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateMailboxForm } from "./CreateMailboxForm";
import { PasswordReveal } from "./PasswordReveal";
import { ImportSelect, ResyncDialog } from "./Resync";
import { Block, Box, ErrorLine, errText } from "./parts";

/** The header the mailbox list gets inside a domain's row: a quiet label and its actions, not a page section. */
function EmbeddedBlock({ actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <div className="flex-1 text-xs font-medium text-muted-foreground">Mailboxes</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** Every mailbox on a server, grouped by domain. With `domain`, only that domain's mailboxes, for use inside its row on the Domains page. */
export function MailboxesBlock({ server, domain }: { server: StalwartServer; domain?: string }) {
  const Shell = domain ? EmbeddedBlock : Block;
  const domains = useStalwartDomains(server.id);
  const boxes = useStalwartMailboxes(server.id);
  const { connectMailbox, resetPassword, deleteMailbox, resyncAll } = useStalwartMutations(server.id);
  const { resync } = useImapMutations();
  const [resyncFor, setResyncFor] = useState<StalwartMailbox | "all" | null>(null);
  const [agentFor, setAgentFor] = useState<{ id: string; email: string } | null>(null);
  // After creating an agent mailbox the password is shown first; its key setup opens once that is closed.
  const [agentNext, setAgentNext] = useState<{ id: string; email: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<{ title: string; email: string; password: string } | null>(null);
  const [connect, setConnect] = useState<StalwartMailbox | null>(null);
  const [importRecent, setImportRecent] = useState(50);
  const [reset, setReset] = useState<StalwartMailbox | null>(null);
  const [del, setDel] = useState<StalwartMailbox | null>(null);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState(ALL_DOMAINS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const enabledDomains = (domains.data ?? []).filter((d) => d.isEnabled && (!domain || d.name === domain));

  const list = boxes.data ?? [];
  const counts = domainCounts(list);
  // A filter on a domain whose last mailbox was just deleted quietly falls back to "All".
  const activeDomain = domain ?? (counts.some((c) => c.domain === domainFilter) ? domainFilter : ALL_DOMAINS);
  const searching = query.trim().length > 0;
  const visible = filterMailboxes(list, activeDomain, query);
  const groups = groupByDomain(visible);
  const grouped = !domain && activeDomain === ALL_DOMAINS && counts.length > 1;
  const showSearch = !domain && list.length > 5;
  const showChips = !domain && counts.length > 1;
  const filtering = !domain && (searching || activeDomain !== ALL_DOMAINS);
  const clearFilters = () => { setQuery(""); setDomainFilter(ALL_DOMAINS); };
  const toggleGroup = (d: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const connectedCount = list.filter((m) => m.account_id).length;

  const row = (m: StalwartMailbox) => (
    <div key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0">
      <Mail size={15} className="text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{m.email}</div>
        {m.description ? <div className="text-xs text-muted-foreground truncate">{m.description}</div> : null}
      </div>
      {m.is_admin ? (
        <Badge variant="outline" title="Manage administrator accounts in Stalwart's own admin page">Administrator</Badge>
      ) : (
        <>
          {m.is_agent ? <Badge variant="secondary" className="gap-1"><Bot size={11} /> Agent</Badge> : null}
          <Badge variant={m.account_id ? "secondary" : "outline"}>{m.account_id ? "Connected" : "Not connected"}</Badge>
          {m.account_id ? (
            <>
              <Button size="icon-xs" variant="ghost" aria-label={`Agent access for ${m.email}`} title="Agent access: API keys and webhook" className="text-muted-foreground" onClick={() => setAgentFor({ id: m.account_id!, email: m.email })}><Bot /></Button>
              <Button size="icon-xs" variant="ghost" aria-label={`Re-sync ${m.email}`} title="Re-sync: check for missing mail" className="text-muted-foreground" onClick={() => setResyncFor(m)}><RotateCcw /></Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setReset(m)}><RefreshCw /> Reset password</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConnect(m)}><Plus /> Connect</Button>
          )}
          <Button size="icon-xs" variant="ghost" aria-label={`Delete ${m.email}`} className="text-muted-foreground" onClick={() => { setTyped(""); setDel(m); }}><BrandIcon name="trash" /></Button>
        </>
      )}
    </div>
  );

  return (
    <Shell
      title="Mailboxes"
      description="Each mailbox is created on the server and connected here, so it syncs into your Imbox."
      actions={
        <div className="flex items-center gap-1">
          {connectedCount > 0 && !domain ? (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setResyncFor("all")}>
              <RotateCcw /> Re-sync all
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={enabledDomains.length === 0} onClick={() => setCreating((v) => !v)}>
            <Plus /> New mailbox
          </Button>
        </div>
      }
    >
      <Box>
        {creating && enabledDomains.length > 0 ? (
          <div className="p-4 border-b border-border">
            <CreateMailboxForm
              serverId={server.id}
              domains={enabledDomains}
              onCancel={() => setCreating(false)}
              onCreated={(r) => {
                setCreating(false);
                toast(`${r.email} is connected`);
                if (r.account.is_agent) setAgentNext({ id: r.account.id, email: r.email });
                if (r.password) setReveal({ title: "Mailbox created", email: r.email, password: r.password });
                else if (r.account.is_agent) { setAgentFor({ id: r.account.id, email: r.email }); setAgentNext(null); }
              }}
            />
          </div>
        ) : null}
        {boxes.isLoading ? (
          <div className="p-3"><Skeleton className="h-8 w-full" /></div>
        ) : boxes.isError ? (
          <div className="p-3"><ErrorLine>{errText(boxes.error)}</ErrorLine></div>
        ) : list.length > 0 ? (
          <>
            {showSearch || showChips ? (
              <div className="grid gap-2.5 border-b border-border p-3">
                {showSearch ? (
                  <InputGroup>
                    <InputGroupAddon><BrandIcon name="search" /></InputGroupAddon>
                    <InputGroupInput
                      aria-label="Search mailboxes"
                      placeholder="Search mailboxes"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {query ? (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}><X /></InputGroupButton>
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
                ) : null}
                {showChips ? (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by domain">
                    {[{ domain: ALL_DOMAINS, label: "All", count: list.length }, ...counts.map((c) => ({ domain: c.domain, label: c.domain, count: c.count }))].map((c) => {
                      const on = activeDomain === c.domain;
                      return (
                        <button
                          key={c.domain}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDomainFilter(c.domain)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                            on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {c.label}
                          <span className={cn("tabular-nums", on ? "text-background/70" : "text-muted-foreground/70")}>{c.count}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {filtering ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
                    <span>Showing {visible.length} of {list.length}</span>
                    <button type="button" onClick={clearFilters} className="underline underline-offset-2 hover:text-foreground">Clear filters</button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {visible.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                {searching ? <>No mailboxes match “{query.trim()}”.</> : domain ? "No mailboxes on this domain yet." : "No mailboxes on this domain."}{" "}
                {!domain && <button type="button" onClick={clearFilters} className="underline underline-offset-2 hover:text-foreground">Clear filters</button>}
              </div>
            ) : grouped ? (
              groups.map((g) => {
                // A search always shows its matches, even inside a folder you collapsed.
                const open = searching || !collapsed.has(g.domain);
                return (
                  <div key={g.domain} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(g.domain)}
                      className="flex w-full items-center gap-2 bg-muted/40 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70"
                    >
                      {open ? <BrandIcon name="collection" size={14} /> : <BrandIcon name="files" size={14} />}
                      <span className="flex-1 truncate">{g.domain || "No domain"}</span>
                      <span className="tabular-nums">{g.items.length}</span>
                      <ChevronDown size={13} className={cn("transition-transform", !open && "-rotate-90")} />
                    </button>
                    {open ? g.items.map(row) : null}
                  </div>
                );
              })
            ) : (
              <div>{groups.flatMap((g) => g.items).map(row)}</div>
            )}
          </>
        ) : (
          <div className="px-3 py-4 text-[13px] text-muted-foreground">
            {enabledDomains.length === 0 ? "Add a domain first, then create your first mailbox." : "No mailboxes yet. Create your first one."}
          </div>
        )}
      </Box>

      <ResyncDialog
        open={resyncFor !== null}
        subject={resyncFor === "all" ? `all ${connectedCount} connected mailboxes` : resyncFor?.email ?? ""}
        pending={resync.isPending || resyncAll.isPending}
        onClose={() => setResyncFor(null)}
        onConfirm={(choice) => {
          const done = () => setResyncFor(null);
          if (resyncFor === "all") {
            resyncAll.mutate(choice, {
              onSuccess: (r) => { toast(`Re-sync started for ${r.mailboxes} ${r.mailboxes === 1 ? "mailbox" : "mailboxes"}`); done(); },
              onError: (e) => toast.error(errText(e), { duration: 10000 }),
            });
          } else if (resyncFor?.account_id) {
            const email = resyncFor.email;
            resync.mutate({ id: resyncFor.account_id, ...choice }, {
              onSuccess: () => { toast(`Re-sync started for ${email}`); done(); },
              onError: (e) => toast.error(errText(e), { duration: 10000 }),
            });
          }
        }}
      />

      {reveal ? (
        <PasswordReveal
          open
          title={reveal.title}
          email={reveal.email}
          password={reveal.password}
          onClose={() => {
            setReveal(null);
            if (agentNext) { setAgentFor(agentNext); setAgentNext(null); }
          }}
        />
      ) : null}
      <AgentDialog account={agentFor} onClose={() => setAgentFor(null)} />

      <AlertDialog open={!!connect} onOpenChange={(o) => !o && setConnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Connect {connect?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Imbox can't read mail with an API key, so it sets a new password on this mailbox and syncs with that. Apps already using the old password (phones, Apple Mail) will need the new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ImportSelect value={importRecent} onChange={setImportRecent} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={connectMailbox.isPending}
              onClick={() =>
                connect &&
                connectMailbox.mutate(
                  { id: connect.id, import_recent: importRecent },
                  {
                    onSuccess: (r) => { toast(`${r.email} is connected`); if (r.password) setReveal({ title: "Mailbox connected", email: r.email, password: r.password }); },
                    onError: (e) => toast.error(errText(e), { duration: 12000 }),
                  }
                )
              }
            >
              Set new password and connect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!reset} onOpenChange={(o) => !o && setReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the password for {reset?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              A new password is set on the server and stored here, so syncing carries on. Other apps signed in to this mailbox will need the new password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                reset &&
                resetPassword.mutate(
                  { id: reset.id },
                  {
                    onSuccess: (r) => { if (r.password) setReveal({ title: "Password reset", email: reset.email, password: r.password }); else toast("Password reset"); },
                    onError: (e) => toast.error(errText(e), { duration: 12000 }),
                  }
                )
              }
            >
              Reset password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {del?.email}?</DialogTitle>
            <DialogDescription>This deletes the mailbox on the server, with all its mail, and removes it from Imbox. It cannot be undone. Type the address to confirm.</DialogDescription>
          </DialogHeader>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={del?.email} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDel(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!del || typed.trim().toLowerCase() !== del.email.toLowerCase() || deleteMailbox.isPending}
              onClick={() => del && deleteMailbox.mutate({ id: del.id, email: del.email }, { onSuccess: () => { toast(`${del.email} deleted`); setDel(null); }, onError: (e) => toast.error(errText(e), { duration: 12000 }) })}
            >
              {deleteMailbox.isPending ? <Loader2 className="animate-spin" /> : <BrandIcon name="trash" />} Delete mailbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
