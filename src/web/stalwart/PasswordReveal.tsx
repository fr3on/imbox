import { Check, Copy, } from "lucide-react";
import { useCopy } from "@/lib/useCopy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** A generated password, shown once, with the reminder that makes that safe. */
export function PasswordReveal({ open, title, email, password, onClose }: { open: boolean; title: string; email: string; password: string; onClose: () => void }) {
  const { copied, copy } = useCopy();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Save this password now. Imbox keeps an encrypted copy so it can sync the mailbox, but it never shows it again.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <div className="text-xs text-muted-foreground">Address</div>
          <div className="font-mono text-[13px] break-all">{email}</div>
          <div className="text-xs text-muted-foreground mt-2">Password</div>
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <code className="flex-1 font-mono text-[13px] break-all select-all">{password}</code>
            <Button type="button" size="xs" variant="outline" onClick={() => copy(password)}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Use it for Apple Mail, Thunderbird or a phone: IMAP on port 993, SMTP on port 465, both TLS.</p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I've saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
