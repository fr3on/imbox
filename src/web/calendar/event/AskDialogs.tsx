import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { type EventScope } from "@/api";
import type { Form } from "./form";

/** What the editor is asking the person before it goes on. */
export type Ask = null | "discard" | "delete" | "delete-scope" | "save-scope";

export function AskDialogs({ ask, setAsk, form, doDelete, doSave, closeEditor }: { ask: Ask; setAsk: (a: Ask) => void; form: Form; doDelete: (scope?: EventScope) => Promise<void>; doSave: (scope?: EventScope) => Promise<void>; closeEditor: () => void }) {
  return (
    <>
        {/* window.confirm is blocked in the Mac and iOS webviews, so every question is a dialog. */}
        <AlertDialog open={ask === "discard" || ask === "delete"} onOpenChange={(o) => !o && setAsk(null)}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{ask === "delete" ? "Delete this event?" : "Discard your changes?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {ask === "delete" ? "It disappears from the calendar for everyone it was shared with." : "The edits you made to this event are lost."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{ask === "delete" ? "Keep it" : "Keep editing"}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const which = ask;
                  setAsk(null);
                  if (which === "delete") void doDelete();
                  else closeEditor();
                }}
              >
                {ask === "delete" ? "Delete" : "Discard"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={ask === "save-scope" || ask === "delete-scope"} onOpenChange={(o) => !o && setAsk(null)}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{ask === "delete-scope" ? "Delete which events?" : "Save to which events?"}</AlertDialogTitle>
              <AlertDialogDescription>“{form.title.trim() || "This event"}” repeats. Choose how far the change reaches.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-1.5">
              {([
                ["this", "This event"],
                ["following", "This and following events"],
                ["all", "All events"],
              ] as [EventScope, string][]).map(([scope, label]) => (
                <Button
                  key={scope}
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    const which = ask;
                    setAsk(null);
                    if (which === "delete-scope") void doDelete(scope);
                    else void doSave(scope);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  );
}
