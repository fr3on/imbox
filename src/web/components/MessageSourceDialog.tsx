import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const messageSourceUrl = (messageId: string, download = false) => `/api/messages/${encodeURIComponent(messageId)}/source${download ? "?download=1" : ""}`;

interface Source {
  text: string;
  kind: "original" | "reconstructed";
  truncated: boolean;
}

async function fetchSource(messageId: string): Promise<Source> {
  const res = await fetch(messageSourceUrl(messageId), { credentials: "same-origin" });
  if (!res.ok) throw new Error(res.status === 404 ? "That message is no longer here." : "Couldn't load the source.");
  return {
    text: await res.text(),
    kind: res.headers.get("x-source-kind") === "original" ? "original" : "reconstructed",
    truncated: res.headers.get("x-truncated") === "1",
  };
}

/** The message as text: every header and each part. From Gmail it is the exact original; otherwise Imbox rebuilds it from what it stored, and says so. */
export function MessageSourceDialog({ messageId, open, onOpenChange }: { messageId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ queryKey: ["message-source", messageId], queryFn: () => fetchSource(messageId), enabled: open, staleTime: 5 * 60_000, retry: false });
  const src = q.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Original message</DialogTitle>
          <DialogDescription>
            {q.isLoading
              ? "Loading…"
              : q.isError
                ? "Couldn't load it."
                : src?.kind === "original"
                  ? "Exactly as it arrived, straight from Gmail."
                  : "Rebuilt by Imbox from the parts it stored. The content and main headers are all here, but not every header the mail servers added on the way."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-40 flex-1 overflow-auto rounded-md border border-border/70 bg-muted/30">
          {q.isLoading && (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="animate-spin" />
            </div>
          )}
          {q.isError && <p className="p-4 text-[13px] text-destructive">{(q.error as Error).message}</p>}
          {src && <pre className="whitespace-pre-wrap break-all p-3 font-mono text-[12px] leading-[18px]">{src.text}</pre>}
        </div>
        {src?.truncated && <p className="text-xs text-muted-foreground">Only the first part is shown. Download the .eml for the whole message.</p>}
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!src}
            onClick={() => src && navigator.clipboard.writeText(src.text).then(() => toast("Copied"), () => toast.error("Couldn't copy"))}
          >
            <Copy /> Copy
          </Button>
          <Button size="sm" asChild>
            <a href={messageSourceUrl(messageId, true)} download>
              <Download /> Download .eml
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
