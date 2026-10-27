import { Kbd } from "@/components/ui/kbd";

export type Hint = { keys: string[]; does: string };

const MOVE: Hint = { keys: ["j", "k"], does: "Move" };
const OPEN: Hint = { keys: ["Enter"], does: "Open" };
const SELECT: Hint = { keys: ["x"], does: "Select" };
const UNREAD: Hint = { keys: ["u"], does: "Mark unread" };

/** What works on the Updates rows. */
export const UPDATES_KEYS: Hint[] = [MOVE, OPEN, { keys: ["e"], does: "Done" }];

const LIST: Hint[] = [MOVE, OPEN, SELECT, { keys: ["l"], does: "Reply later" }, { keys: ["a"], does: "Set aside" }, UNREAD, { keys: ["#"], does: "Trash" }];
// In the trash there is nothing to trash again.
const TRASH: Hint[] = [MOVE, OPEN, SELECT, UNREAD];

/** The keys that work on a thread list, in a quiet row under the page title (or the `hints` a page gives). Desktop only: a phone has no keyboard. */
export function KeyLegend({ trash, hints }: { trash?: boolean; hints?: Hint[] }) {
  return (
    <ul className="-mt-3 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 text-[12.5px] text-muted-foreground max-md:hidden" aria-label="Keyboard shortcuts">
      {(hints ?? (trash ? TRASH : LIST)).map((h) => (
        <li key={h.does} className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-1">
            {h.keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
          {h.does}
        </li>
      ))}
    </ul>
  );
}
