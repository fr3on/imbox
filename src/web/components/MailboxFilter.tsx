import { cn } from "@/lib/utils";
import type { ThreadSummary } from "@shared/types";
import { useAccount } from "../context/AccountContext";
import { AccountDot } from "./Avatar";

/** The mailboxes that have mail in the list, as chips. One tap narrows the list to that mailbox; the dot is the same one the rows carry. */
export function MailboxFilter({ threads, value, onChange }: { threads: ThreadSummary[]; value: string; onChange: (accountId: string) => void }) {
  const { accounts, colorFor } = useAccount();
  const present = new Set(threads.map((t) => t.account_id));
  const boxes = accounts.filter((a) => present.has(a.id) || a.id === value);
  if (boxes.length < 2) return null;
  const chip = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors";
  return (
    <div role="group" aria-label="Show one mailbox" className="mb-1.5 flex items-center gap-1.5 overflow-x-auto px-2 pb-1 scrollbar-none">
      <button type="button" aria-pressed={!value} onClick={() => onChange("")} className={cn(chip, !value ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>
        All {boxes.length} mailboxes
      </button>
      {boxes.map((a) => (
        <button key={a.id} type="button" aria-pressed={value === a.id} onClick={() => onChange(value === a.id ? "" : a.id)} title={a.email} className={cn(chip, value === a.id ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>
          <AccountDot color={colorFor(a.id)} className={value === a.id ? "ring-2 ring-background" : undefined} />
          <span className="max-w-[10rem] truncate">{a.email.split("@")[0]}</span>
        </button>
      ))}
    </div>
  );
}
