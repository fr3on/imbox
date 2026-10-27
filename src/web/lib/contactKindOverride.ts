import { useCallback, useEffect, useState } from "react";
import type { ContactKind } from "./contactKind";

// The Contacts page guesses whether a sender is a person or a service. This keeps the corrections, by address, in this browser.
const KEY = "inbox.contactKinds";

function read(): Record<string, ContactKind> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function useKindOverrides(): { overrides: Record<string, ContactKind>; setKind: (email: string, kind: ContactKind | null) => void } {
  const [overrides, setOverrides] = useState<Record<string, ContactKind>>(read);
  // Another tab corrected one: pick it up.
  useEffect(() => {
    const on = (e: StorageEvent) => e.key === KEY && setOverrides(read());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const setKind = useCallback((email: string, kind: ContactKind | null) => {
    setOverrides((cur) => {
      const next = { ...cur };
      const k = email.toLowerCase();
      if (kind) next[k] = kind;
      else delete next[k];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage can be blocked; the correction then lasts until the page is closed */
      }
      return next;
    });
  }, []);
  return { overrides, setKind };
}
