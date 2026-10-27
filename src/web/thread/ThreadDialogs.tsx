import { useNavigate } from "react-router-dom";
import { ThreadPicker } from "@/components/Pickers";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Account, ThreadDetail, } from "@shared/types";
import type { Run } from "./types";

export function ThreadDialogs({ t, account, mergeOpen, setMergeOpen, confirmDelete, setConfirmDelete, run }: { t: ThreadDetail; account: Account | undefined; mergeOpen: boolean; setMergeOpen: (v: boolean) => void; confirmDelete: boolean; setConfirmDelete: (v: boolean) => void; run: Run }) {
  const nav = useNavigate();
  return (
    <>
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="sm:max-w-md p-0 gap-0" showCloseButton={false}>
          <DialogHeader className="px-3 pt-3 pb-1">
            <DialogTitle className="text-sm">Merge into this thread</DialogTitle>
            <DialogDescription className="text-xs">Fold another conversation into this one. Their messages join this thread.</DialogDescription>
          </DialogHeader>
          <ThreadPicker exclude={[t.id]} onPick={(other) => { setMergeOpen(false); run({ action: "merge", thread_ids: [other.id] }, `Merged “${other.subject}”`); }} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread forever?</AlertDialogTitle>
            <AlertDialogDescription>It'll be removed here and trashed in {account?.provider === "domain" || account?.provider === "imap" ? "your mailbox" : account?.provider === "outlook" ? "Outlook" : "Gmail"}. There's no undo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { run({ action: "delete" }, "Deleted"); nav("/"); }}>Delete forever</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
