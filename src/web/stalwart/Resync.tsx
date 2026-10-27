import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectClass } from "./parts";

export const IMPORT_CHOICES = [0, 25, 50, 100, 200] as const;

/** "Bring in my latest N messages" — connecting imports nothing unless you ask, and most people with an existing mailbox do. */
export function ImportSelect({ value, onChange, id = "import-recent" }: { value: number; onChange: (n: number) => void; id?: string }) {
  return (
    <div className="grid gap-1.5 text-left">
      <label htmlFor={id} className="text-sm font-medium">Import recent mail</label>
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectClass}>
        {IMPORT_CHOICES.map((n) => <option key={n} value={n}>{n === 0 ? "Don't import — only new mail" : `My latest ${n} messages`}</option>)}
      </select>
      <p className="text-xs text-muted-foreground">They arrive in the Screener like any first-time mail, a few every minute. Nothing older is fetched.</p>
    </div>
  );
}

export interface ResyncChoice {
  count?: number;
  all?: boolean;
}

const RESYNC_CHOICES: { id: string; label: string; hint: string; value: ResyncChoice }[] = [
  { id: "200", label: "Check for missing mail", hint: "The latest 200 messages. Quick, and enough to catch a gap.", value: { count: 200 } },
  { id: "1000", label: "The latest 1,000 messages", hint: "A few minutes in the background, longer if the server is slow.", value: { count: 1000 } },
  { id: "all", label: "Everything in the inbox", hint: "Every message on the server. A large mailbox takes a while.", value: { all: true } },
];

/**
 * Re-check a mailbox and import anything that is missing. Safe to run at any time: mail already in
 * Imbox is skipped, so nothing is duplicated and nothing is deleted.
 */
export function ResyncDialog({ open, subject, pending, onClose, onConfirm }: { open: boolean; subject: string; pending?: boolean; onClose: () => void; onConfirm: (c: ResyncChoice) => void }) {
  const [choice, setChoice] = useState("200");
  const picked = RESYNC_CHOICES.find((c) => c.id === choice) ?? RESYNC_CHOICES[0];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Re-sync {subject}?</DialogTitle>
          <DialogDescription>
            Imbox re-reads the inbox and imports anything it is missing. Messages it already has are skipped, so nothing is duplicated or deleted.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="How much to re-check" className="grid gap-2">
          {RESYNC_CHOICES.map((c) => (
            <label key={c.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", choice === c.id ? "border-foreground" : "border-border hover:bg-muted/50")}>
              <input type="radio" name="resync" className="mt-1" checked={choice === c.id} onChange={() => setChoice(c.id)} />
              <span>
                <span className="block text-sm font-medium">{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Imports run in the background, a batch every minute, and the account shows how far along it is. If the server stops answering, imbox waits a few minutes and tries again. A message over 30 MB is skipped and noted in the sync log. Newly found mail from people you haven't screened goes to the Screener. A message you deleted for good in Imbox can come back.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => onConfirm(picked.value)}>
            {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Start re-sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
