import { BrandIcon } from "./BrandIcons";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Plus, X } from "lucide-react";
import type { Account } from "@shared/types";
import { ALL } from "../context/AccountContext";
import { emailLocal, groupAccounts, needsAttention } from "../lib/accountGroups";
import { SyncSummary, healthOf, syncText } from "./SyncPill";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/** Past this many accounts a search box earns its space. */
const SEARCH_FROM = 6;

/**
 * The "Imbox scope" menu: which account, or all of them, the app is showing.
 *
 * With several domains the accounts are grouped into a folder per domain, so eight addresses read as
 * three small lists instead of one long one. Past a handful of accounts there is a search box that takes
 * focus when the menu opens; Enter picks the first match and the arrow keys move into the list. An
 * account that has stopped syncing shows a warning, so a problem is visible before you go looking.
 */
export function ScopeMenuContent({
  accounts,
  scope,
  glyphFor,
  onScope,
  side,
  googleConfigured,
  microsoftConfigured,
  onConnectGoogle,
  onConnectMicrosoft,
  onAddMailbox,
  onManage,
  onServers,
}: {
  accounts: Account[];
  scope: string;
  glyphFor: (id: string) => string;
  onScope: (v: string) => void;
  side: "right" | "bottom";
  googleConfigured: boolean;
  microsoftConfigured: boolean;
  onConnectGoogle: () => void;
  onConnectMicrosoft: () => void;
  onAddMailbox: () => void;
  onManage: () => void;
  onServers: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const searching = query.trim().length > 0;
  const showSearch = accounts.length >= SEARCH_FROM;
  // "All accounts" is your own mail; an agent's mailbox is in the list, but not in that total.
  const personalCount = accounts.filter((a) => !a.is_agent).length || accounts.length;

  // With a search box, typing should just work. Radix puts focus on the menu itself as it opens, so
  // take it back once that has happened.
  useEffect(() => {
    if (!showSearch) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [showSearch]);
  const groups = groupAccounts(accounts, query);
  const grouped = groups.length > 1 || (searching ? false : new Set(accounts.map((a) => a.email.split("@")[1]?.toLowerCase())).size > 1);
  const matches = groups.flatMap((g) => g.items);
  const flat = !grouped;

  // Each domain folds. The one you are in starts open (the first, when you are looking at everything), and so does any domain with a mailbox that needs attention.
  // A search opens every group, so a match is never hidden inside a closed one.
  const [open, setOpen] = useState<Set<string>>(() => {
    const here = accounts.find((a) => a.id === scope);
    const domainOf = (a: Account) => a.email.split("@")[1]?.toLowerCase() ?? "";
    const o = new Set<string>(accounts.filter(needsAttention).map(domainOf));
    o.add(here ? domainOf(here) : (accounts[0] ? domainOf(accounts[0]) : ""));
    return o;
  });
  const toggle = (d: string) => setOpen((prev) => {
    const n = new Set(prev);
    if (!n.delete(d)) n.add(d);
    return n;
  });

  const item = (a: Account) => {
    const warn = needsAttention(a);
    const second = a.display_name && a.display_name.toLowerCase() !== emailLocal(a.email).toLowerCase() ? a.display_name : "";
    return (
      <DropdownMenuRadioItem key={a.id} value={a.id} title={a.email}>
        <span className="w-4 text-center text-[10px] text-muted-foreground">{glyphFor(a.id)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{flat ? a.email : emailLocal(a.email)}</span>
          <span className={warn ? "block truncate text-[11px] leading-4 text-amber-700 dark:text-amber-400" : "block truncate text-[11px] leading-4 text-muted-foreground"}>
            {second ? `${second} · ` : ""}
            {syncText(a)}
          </span>
        </span>
        {a.is_agent ? <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground" title="An AI agent's mailbox: kept out of All accounts">Agent</span> : null}
        {warn ? (
          <AlertTriangle
            size={13}
            className="shrink-0 text-destructive"
            aria-label={a.sync_status === "disconnected" ? "Stopped syncing" : "Sync problem"}
          >
            <title>{a.sync_error || (a.sync_status === "disconnected" ? "Stopped syncing" : "Sync problem")}</title>
          </AlertTriangle>
        ) : healthOf(a) === "syncing" ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" aria-label="Syncing" />
        ) : null}
      </DropdownMenuRadioItem>
    );
  };

  return (
    <DropdownMenuContent
      align="start"
      side={side}
      className="w-72 p-1"
    >
      <DropdownMenuLabel className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Imbox scope</span>
        {accounts.length > 1 ? <span className="tabular-nums">{accounts.length} accounts</span> : null}
      </DropdownMenuLabel>

      <SyncSummary />

      {showSearch ? (
        <div className="px-1 pb-1.5">
          <InputGroup className="h-8">
            <InputGroupAddon><BrandIcon name="search" /></InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              aria-label="Search accounts"
              placeholder="Find an account"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                // Keep the menu's own type-ahead and shortcuts out of a text field.
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  listRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  // Clicking the row picks it and closes the menu, exactly as a mouse would.
                  const first = matches[0];
                  if (first) listRef.current?.querySelector<HTMLElement>(`[role="menuitemradio"][title="${CSS.escape(first.email)}"]`)?.click();
                } else if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                } else if (e.key !== "Escape" && e.key !== "Tab") {
                  e.stopPropagation();
                }
              }}
            />
            {query ? (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X /></InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>
      ) : null}

      <div ref={listRef} className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain">
        <DropdownMenuRadioGroup value={scope} onValueChange={onScope}>
          {searching ? null : (
            <DropdownMenuRadioItem value={ALL}>
              <BrandIcon name="collection" className="text-muted-foreground" />
              All accounts
              {personalCount > 1 && <DropdownMenuShortcut>{personalCount}</DropdownMenuShortcut>}
            </DropdownMenuRadioItem>
          )}
          {grouped
            ? groups.map((g) => {
                const key = g.domain.toLowerCase();
                const expanded = searching || open.has(key);
                const warn = !expanded && g.items.some(needsAttention);
                return (
                  <div key={g.domain} role="presentation">
                    <DropdownMenuItem
                      aria-expanded={expanded}
                      onSelect={(e) => {
                        e.preventDefault();
                        if (!searching) toggle(key);
                      }}
                      className="mt-1 gap-1.5 px-2 py-1 text-[11px] font-medium text-muted-foreground"
                    >
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <BrandIcon name="domains" size={12} />
                      <span className="flex-1 truncate">{g.domain || "Other"}</span>
                      {warn ? <AlertTriangle size={12} className="text-destructive" aria-label="A mailbox here needs attention" /> : null}
                      <span className="tabular-nums">{g.items.length}</span>
                    </DropdownMenuItem>
                    {expanded ? g.items.map(item) : null}
                  </div>
                );
              })
            : matches.map(item)}
        </DropdownMenuRadioGroup>
        {accounts.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">Nothing connected yet.</div> : null}
        {accounts.length > 0 && matches.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">No account matches “{query.trim()}”.</div>
        ) : null}
      </div>

      <DropdownMenuSeparator />
      {googleConfigured ? (
        <DropdownMenuItem onClick={onConnectGoogle}>
          <Plus />
          Connect Gmail
        </DropdownMenuItem>
      ) : null}
      {microsoftConfigured ? (
        <DropdownMenuItem onClick={onConnectMicrosoft}>
          <Plus />
          Connect Outlook
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={onAddMailbox}>
        <Plus />
        Add mailbox (IMAP/SMTP)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onServers}>
        <BrandIcon name="servers" />
        Mail servers &amp; domains
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onManage}>
        <BrandIcon name="settings" />
        Manage accounts
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
