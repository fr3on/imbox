import { useState } from "react";
import type { Address } from "@shared/types";

const name = (a: Address) => a.name || a.email;

/** A tiny text button that is safe to put inside another button (a mobile message header is one), and works from the keyboard. */
function Link({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="cursor-pointer underline underline-offset-2 hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onPress();
        }
      }}
    >
      {children}
    </span>
  );
}

/** "to Reda, Alaa and 6 others": the first few by name, the rest a tap away, and copies folded the same way. */
export function Recipients({ to, cc }: { to: Address[]; cc: Address[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? to : to.slice(0, 2);
  const hidden = to.length - shown.length;
  return (
    <>
      to {shown.map(name).join(", ") || "—"}
      {hidden > 0 && (
        <>
          {" "}
          and <Link onPress={() => setOpen(true)}>{hidden} {hidden === 1 ? "other" : "others"}</Link>
        </>
      )}
      {open && to.length > 2 && (
        <>
          {" "}
          <Link onPress={() => setOpen(false)}>fewer</Link>
        </>
      )}
      {cc.length > 0 && <> · cc {open || cc.length <= 2 ? cc.map(name).join(", ") : `${cc.slice(0, 2).map(name).join(", ")} +${cc.length - 2}`}</>}
    </>
  );
}
