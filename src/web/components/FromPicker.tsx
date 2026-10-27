import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Account } from "@shared/types";
import { Avatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { emailDomain, emailLocal } from "../lib/accountGroups";
import { cn } from "@/lib/utils";

const KEY = "inbox.from.recent";
const RECENT_SHOWN = 3;

/** The addresses the person sent from lately, newest first. Kept in this browser only; losing it just means the list has no "Recent". */
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Call when something is sent from an address, so it comes first next time. */
export function rememberFrom(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 8)));
  } catch {
    /* storage can be blocked */
  }
}

const nameOf = (a: Account, fallback: string) => a.display_name && a.display_name.toLowerCase() !== emailLocal(a.email).toLowerCase() ? a.display_name : fallback;

/**
 * Who a message is sent from. Opens on the address that answers the mail you are replying to (marked "received here"), then the ones you sent
 * from lately, then every address in order by domain. Every row shows the whole address, and typing narrows the list, so with fifteen addresses
 * "bill" and Enter is enough.
 */
export function FromPicker({
  accounts,
  value,
  onChange,
  suggestedId,
  userName,
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  /** The mailbox the mail being answered arrived in. */
  suggestedId?: string | null;
  userName?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = accounts.find((a) => a.id === value) ?? accounts[0];

  const { suggested, recent, rest } = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const suggested = suggestedId ? byId.get(suggestedId) : undefined;
    const taken = new Set<string>(suggested ? [suggested.id] : []);
    const recent: Account[] = [];
    for (const id of readRecent()) {
      const a = byId.get(id);
      if (a && !taken.has(a.id) && recent.length < RECENT_SHOWN) {
        recent.push(a);
        taken.add(a.id);
      }
    }
    const rest = accounts
      .filter((a) => !taken.has(a.id))
      .sort((a, b) => emailDomain(a.email).localeCompare(emailDomain(b.email)) || emailLocal(a.email).localeCompare(emailLocal(b.email)));
    return { suggested, recent, rest };
    // The recent list is read when the list opens, so a send just made is already in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, suggestedId, open]);

  if (!current) return <span className="text-[13px] text-muted-foreground">No account connected</span>;
  const label = (a: Account) => nameOf(a, userName || a.email);

  const item = (a: Account, tag?: string) => (
    <CommandItem
      key={a.id}
      // The words typed are matched against all of this: the name, the whole address and the domain.
      value={`${label(a)} ${a.email} ${emailDomain(a.email)} ${a.id}`}
      onSelect={() => {
        onChange(a.id);
        setOpen(false);
      }}
      className="gap-2.5 py-1.5"
    >
      <Avatar email={a.email} name={label(a)} src={a.avatar_url} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{label(a)}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{a.email}</span>
      </span>
      {tag && <span className="shrink-0 rounded-md border border-border px-1.5 py-px text-[10.5px] text-muted-foreground">{tag}</span>}
      {a.id === current.id && <Check className="size-4 shrink-0" />}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1.5 h-7 min-w-0 max-w-full gap-2 px-1.5 text-[13px] font-normal hover:bg-muted data-[state=open]:bg-muted"
          aria-label="Send from"
          aria-haspopup="listbox"
        >
          <Avatar email={current.email} name={label(current)} src={current.avatar_url} size={16} />
          <span className="truncate">{label(current)}</span>
          <span className="truncate text-muted-foreground">{current.email}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(380px,calc(100vw-24px))] p-0">
        <Command className={cn("rounded-lg")}>
          <CommandInput placeholder="Search addresses" autoFocus />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No address matches.</CommandEmpty>
            {suggested && <CommandGroup heading="Replying as">{item(suggested, "received here")}</CommandGroup>}
            {recent.length > 0 && <CommandGroup heading="Recent">{recent.map((a) => item(a))}</CommandGroup>}
            {rest.length > 0 && <CommandGroup heading="All addresses">{rest.map((a) => item(a))}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
