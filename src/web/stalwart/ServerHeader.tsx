import { useState } from "react";
import { KeyRound, Loader2, Server, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { StalwartServer } from "@shared/types";
import { useStalwartServerMutations } from "@/api";
import { fmtRelative } from "@/lib/format";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Box, ErrorLine, errText } from "./parts";

export function ServerHeader({ server, onForget }: { server: StalwartServer; onForget: () => void }) {
  const { rotateKey } = useStalwartServerMutations();
  const [rotate, setRotate] = useState(false);
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [forget, setForget] = useState(false);
  return (
    <>
      <Box>
        <div className="flex flex-wrap items-center gap-3 px-3 py-3">
          <div className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground"><Server size={16} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{server.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {server.base_url} · {server.mailboxes} connected {server.mailboxes === 1 ? "mailbox" : "mailboxes"}
              {server.last_checked_at ? ` · checked ${fmtRelative(server.last_checked_at)}` : ""}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setRotate(true)}><KeyRound /> Replace key</Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setForget(true)}><Unplug /> Forget</Button>
        </div>
        {server.last_error ? (
          <div className="border-t border-border px-3 py-2"><ErrorLine>Last check failed: {server.last_error}</ErrorLine></div>
        ) : null}
      </Box>

      <Dialog open={rotate} onOpenChange={(o) => { if (!o) { setRotate(false); setKey(""); setErr(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace the API key</DialogTitle>
            <DialogDescription>Paste a new key for {server.name}. The old one is discarded once the new one works.</DialogDescription>
          </DialogHeader>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="New API key" autoComplete="off" autoFocus />
          {err ? <ErrorLine>{err}</ErrorLine> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotate(false)}>Cancel</Button>
            <Button
              disabled={key.trim().length < 8 || rotateKey.isPending}
              onClick={() => rotateKey.mutate({ id: server.id, api_key: key.trim() }, { onSuccess: () => { toast("API key replaced"); setRotate(false); setKey(""); }, onError: (e) => setErr(errText(e)) })}
            >
              {rotateKey.isPending ? <Loader2 className="animate-spin" /> : null} Replace key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={forget} onOpenChange={setForget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Imbox stops managing this server and deletes its API key. Mailboxes already connected keep working as ordinary IMAP accounts, and nothing changes on the server itself.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onForget}>Forget server</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
