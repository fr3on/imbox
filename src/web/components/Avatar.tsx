import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PersonCard } from "./PersonCard";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarTint, initials } from "../lib/format";
import { useAccount } from "../context/AccountContext";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---- Photo lookup: what the server provides in `src` — a Google People photo, a BIMI brand logo, a Gravatar photo or the sender's site icon; else initials. ----
const failedUrls = new Set<string>();

/** Notion-style avatar: 4px-rounded square. Shows the person's photo when available, otherwise initials. */
export function Avatar({
  email,
  name,
  size = 24,
  selected,
  onClick,
  className = "",
  strong,
  src,
  round,
}: {
  email: string;
  name?: string;
  size?: number;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  /** Inverted (foreground bg) for emphasis. */
  strong?: boolean;
  ring?: boolean;
  /** Photo url (Google contact photo, profile picture, or BIMI brand logo). Falls back to initials. */
  src?: string;
  /** Circular avatar instead of 4px-rounded square */
  round?: boolean;
}) {
  const isRound = round || className.includes("rounded-full");
  const radiusCls = isRound ? "rounded-full" : "rounded-[4px]";
  const style: React.CSSProperties = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)) };
  const inverted = selected || strong;
  const [broken, setBroken] = useState<string>("");
  // Your own addresses show your own picture (the one in the corner), wherever they appear: "You" on a message, the reply box, a thread's people.
  const { user, accounts } = useAccount();
  const mine = email ? accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) : undefined;
  const own = mine ? user?.settings?.avatar_url || mine.avatar_url || "" : "";
  const shown = own || src;
  const photo = shown && !failedUrls.has(shown) && shown !== broken ? shown : "";
  const isLogo = /\.svg(\?|#|$)/i.test(photo) || photo.startsWith("/api/avatar/d/"); // brand marks and site icons: whole, not cropped
  const showPhoto = !selected && !!photo;
  const content = selected ? (
    <Check size={Math.round(size * 0.55)} strokeWidth={2.5} />
  ) : showPhoto ? (
    <img
      src={photo}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      className={cn("block w-full h-full", radiusCls, isLogo ? "object-contain p-[12%] bg-muted" : "object-cover")}
      onError={() => {
        failedUrls.add(photo);
        setBroken(photo);
      }}
    />
  ) : (
    initials(name ?? "", email)
  );
  // No picture: initials on the person's own soft tint, so a row of people is told apart at a glance. Selected and emphasised avatars stay inverted.
  const tinted = !inverted && !showPhoto && !!email;
  if (tinted) Object.assign(style, avatarTint(email));
  const cls = cn(
    "shrink-0 font-semibold tracking-tight flex items-center justify-center select-none leading-none overflow-hidden",
    radiusCls,
    inverted ? "bg-foreground text-background" : tinted ? "" : "bg-muted text-foreground/80",
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={style} aria-pressed={selected} aria-label={selected ? "Deselect" : "Select"} className={cn(cls, "hover:bg-accent")}>
        {content}
      </button>
    );
  }
  return (
    <div style={style} className={cls} aria-hidden>
      {content}
    </div>
  );
}

type Person = { email: string; name?: string; avatar_url?: string };

/** Everyone on a thread, when there are too many to draw: a list you can search, each row leading to that person. */
function EveryoneList({ people, onPick }: { people: Person[]; onPick: (p: Person) => void }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = needle ? people.filter((p) => `${p.name ?? ""} ${p.email}`.toLowerCase().includes(needle)) : people;
  return (
    <div className="w-72">
      <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">{people.length} people on this thread</div>
      {people.length > 8 && (
        <div className="border-b border-border px-2 py-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a person"
            aria-label="Find a person"
            className="h-7 w-full rounded-md bg-muted/60 px-2 text-[13px] outline-none placeholder:text-tertiary"
          />
        </div>
      )}
      <ul className="max-h-72 overflow-y-auto py-1">
        {list.map((p) => (
          <li key={p.email}>
            <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-muted/60">
              <Avatar email={p.email} name={p.name} src={p.avatar_url} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-4">{p.name || p.email.split("@")[0]}</span>
                {p.name && <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">{p.email}</span>}
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-3 text-center text-xs text-muted-foreground">Nobody by that name.</li>}
      </ul>
    </div>
  );
}

export function AvatarStack({ people, size = 20, max = 3, className, plus = true, card = true }: { people: Person[]; card?: boolean; size?: number; max?: number; className?: string; plus?: boolean }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const nav = useNavigate();
  const [everyone, setEveryone] = useState(false);
  // Bigger avatars overlap less, so the initials underneath are not cut off.
  const overlap = size >= 22 ? "-ml-1" : "-ml-1.5";
  return (
    <div className={cn("flex items-center", className)}>
      {shown.map((p, i) => (
        <span key={p.email + i} className={cn("relative shrink-0 rounded-[6px] bg-background p-[2px]", i > 0 && overlap)} style={{ zIndex: i + 1 }}>
          {card ? (
            <PersonCard person={p}>
              <Avatar email={p.email} name={p.name} src={p.avatar_url} size={size} />
            </PersonCard>
          ) : (
            <Avatar email={p.email} name={p.name} src={p.avatar_url} size={size} />
          )}
        </span>
      ))}
      {plus && rest > 0 && (
        <Popover open={everyone} onOpenChange={setEveryone}>
          {/* The row this sits in is often a link. The wrapper stops that link after the popover has had its turn: calling preventDefault on
              the button itself would make the popover skip its own toggle and never open. */}
          <span
            className={cn("relative inline-flex", overlap)}
            style={{ zIndex: shown.length + 1 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Show all ${people.length} people`}
                className="rounded-[6px] bg-background p-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center justify-center rounded-[4px] bg-muted text-muted-foreground tnum transition-colors hover:bg-accent hover:text-foreground" style={{ minWidth: size, height: size, paddingInline: 3, fontSize: Math.max(9, Math.round(size * 0.42)) }}>
                  +{rest}
                </span>
              </button>
            </PopoverTrigger>
          </span>
          <PopoverContent align="start" className="w-auto p-0" onClick={(e) => e.stopPropagation()}>
            <EveryoneList
              people={people}
              onPick={(p) => {
                setEveryone(false);
                nav(`/contacts/email/${encodeURIComponent(p.email)}?name=${encodeURIComponent(p.name ?? "")}`);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Tiny monochrome mark identifying an account in the unified inbox. */
export function AccountGlyph({ glyph, label, className }: { glyph: string; label?: string; className?: string }) {
  if (!glyph) return null;
  const el = (
    <span aria-label={label} className={cn("inline-flex items-center justify-center text-[9px] leading-none text-muted-foreground shrink-0", className)}>
      {glyph}
    </span>
  );
  if (!label) return el;
  return (
    <UiTooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </UiTooltip>
  );
}

/** A small coloured dot that says which mailbox a thread is in; the address shows on hover. */
export function AccountDot({ color, label, className }: { color: string; label?: string; className?: string }) {
  if (!color) return null;
  const el = <span aria-label={label} className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
  if (!label) return el;
  return (
    <UiTooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent>In {label}</TooltipContent>
    </UiTooltip>
  );
}

/** A bundle at a glance: the sender's tile on top of a couple of blank cards offset up-left. */
export function BundleAvatar({ email, name, src, size = 20, strong }: { email: string; name?: string; src?: string; size?: number; strong?: boolean }) {
  const off = Math.max(2, Math.round(size * 0.12));
  return (
    <span className="relative block shrink-0" style={{ width: size + off * 2, height: size + off * 2 }} aria-hidden>
      <span className="absolute rounded-[4px] bg-muted border border-border" style={{ width: size, height: size, left: 0, top: 0 }} />
      <span className="absolute rounded-[4px] bg-muted border border-border" style={{ width: size, height: size, left: off, top: off }} />
      <span className="absolute" style={{ left: off * 2, top: off * 2 }}>
        <Avatar email={email} name={name} src={src} size={size} strong={strong} />
      </span>
    </span>
  );
}
