import { useState } from "react";
import { toast } from "sonner";

/** Copy text to the clipboard, and say "copied" for a moment. Explains itself if the browser refuses. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => toast.error("Couldn't copy — select the text and copy it by hand."));
  return { copied, copy };
}
