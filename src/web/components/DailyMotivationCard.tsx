import { BrandIcon } from "./BrandIcons";
import { useEffect, useState } from "react";
import { Check, Frown, Heart, Laugh, Loader2, Meh, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { playMoodSound } from "../lib/moodSound";
import { ApiError, useBrief, useNextThought, useThoughts, useThoughtSet, type Mood } from "../api";

/** How a thought can land. Meh and sad mean it is replaced by a new one. */
const MOODS: { id: Mood; label: string; icon: typeof Smile; replaces: boolean; reply: string; done?: string }[] = [
  { id: "loved", label: "Loved it", icon: Laugh, replaces: false, reply: "Glad it landed. You'll see more like this." },
  { id: "happy", label: "Happy", icon: Smile, replaces: false, reply: "Noted. You'll see more like this." },
  { id: "meh", label: "Meh", icon: Meh, replaces: true, reply: "Thanks for saying. Writing a different one…", done: "Here is a different one." },
  { id: "sad", label: "Sad", icon: Frown, replaces: true, reply: "Sorry, that was heavy. Writing a gentler one…", done: "Here is a gentler one." },
];

const STORAGE_PREFIX = "imbox.daily_motivation.";
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function hiddenToday(key: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key) === "hidden";
  } catch {
    return false;
  }
}
function setHiddenToday(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(STORAGE_PREFIX + key, "hidden");
    else localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage is unavailable in some private windows; the card just forgets that it was hidden.
  }
}

/** A short stable id for a thought, from its words, so a reaction follows the thought wherever it turns up again. */
function thoughtKey(quote: string): string {
  let h = 2166136261;
  for (const ch of quote.toLowerCase()) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
  return `t${h.toString(36)}`;
}

/**
 * The thought of the day. Every thought is written by the AI for this person and this day; nothing here is pre-written, so with no AI
 * set up the card does not appear. The brief holds the day's current thought and remembers the ones already shown.
 */
export function DailyMotivationCard({ compact, embedded }: { compact?: boolean; /** Drawn as the last line of the Today card: one quiet line that opens for the rest. */ embedded?: boolean }) {
  const brief = useBrief().data?.brief;
  const reactions = useThoughts();
  const setThought = useThoughtSet();
  const next = useNextThought();
  const key = dayKey();
  const [hidden, setHidden] = useState(() => hiddenToday(key));
  const [open, setOpen] = useState(false);
  // What the card says back after a reaction. It fades on its own so the card goes back to the thought.
  const [reply, setReply] = useState<{ text: string; busy: boolean } | null>(null);
  useEffect(() => {
    if (!reply || reply.busy) return;
    const t = window.setTimeout(() => setReply(null), 5000);
    return () => window.clearTimeout(t);
  }, [reply]);
  const current = brief?.thought;
  if (hidden || !current) return null;

  const id = thoughtKey(current.quote);
  const items = reactions.data?.items ?? [];
  const mine = items.find((i) => i.key === id);
  const saved = items.filter((i) => i.saved);
  const shown = { ...current, basis: "Written for you today" };

  const another = (done?: string) =>
    next.mutate(undefined, {
      onSuccess: () => done && setReply({ text: done, busy: false }),
      onError: (e) => {
        setReply(null);
        toast(e instanceof ApiError ? e.message : "Could not write one just now.");
      },
    });
  const hide = () => {
    setHidden(true);
    setHiddenToday(key, true);
    toast("Hidden for today", {
      action: {
        label: "Undo",
        onClick: () => {
          setHidden(false);
          setHiddenToday(key, false);
        },
      },
    });
  };
  const react = (m: (typeof MOODS)[number]) => {
    const value = mine?.reaction === m.id ? null : m.id;
    setThought.mutate({ key: id, thought: shown, reaction: value, saved: !!mine?.saved });
    if (!value) return setReply(null);
    playMoodSound(m.id);
    setReply({ text: m.reply, busy: m.replaces });
    // It did not land: a new one takes its place, written with that in mind.
    if (m.replaces) another(m.done);
  };
  const toggleSave = () => {
    setThought.mutate({ key: id, thought: shown, reaction: mine?.reaction ?? null, saved: !mine?.saved });
    if (!mine?.saved) toast("Saved");
  };

  const moodButtons = (
    <>
      {MOODS.map((m) => (
          <Button key={m.id} variant="ghost" size="icon-sm" className={cn("text-muted-foreground", mine?.reaction === m.id && "bg-muted text-foreground")} aria-pressed={mine?.reaction === m.id} aria-label={m.label} title={m.label} disabled={next.isPending} onClick={() => react(m)}>
            <m.icon />
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="icon-sm" className={cn("text-muted-foreground", mine?.saved && "bg-muted text-foreground")} aria-pressed={!!mine?.saved} aria-label={mine?.saved ? "Remove from saved" : "Save this thought"} title={mine?.saved ? "Remove from saved" : "Save this thought"} onClick={toggleSave}>
          <BrandIcon name="set-aside" className={cn(mine?.saved && "fill-current")} />
        </Button>
    </>
  );
  const savedMenu = (
    <>
        {saved.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Saved <span className="tnum">{saved.length}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
              <div className="border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">Saved thoughts</div>
              <ul className="max-h-[50vh] divide-y divide-border/50 overflow-y-auto">
                {saved.map((i) => (
                  <li key={i.key} className="flex items-start gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold leading-snug">“{i.thought.quote}”</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{i.thought.advice}</p>
                    </div>
                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Remove from saved" title="Remove from saved" onClick={() => setThought.mutate({ key: i.key, thought: i.thought, reaction: i.reaction, saved: false })}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
    </>
  );

  if (embedded) {
    return (
      <div className="border-t border-border/50 px-4 py-2" aria-label="A thought for today">
        <div className="flex items-center gap-2 text-[13px]">
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-baseline gap-2.5 rounded text-left">
            <span className="shrink-0 text-xs text-muted-foreground">Thought for today</span>
            <span className={cn("min-w-0 text-foreground/90", !open && "truncate")}>“{current.quote}”</span>
          </button>
          {!open && saved.length > 0 && <span className="shrink-0">{savedMenu}</span>}
          <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground" aria-label="Hide for today" title="Hide for today" onClick={hide}>
            <X />
          </Button>
        </div>
        {open && (
          <>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{current.advice}</p>
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] text-tertiary">
              <span className="italic">{current.affirmation}</span>
              <span className="shrink-0">{shown.basis}</span>
            </div>
            {reply && (
              <p role="status" className="mt-2 flex items-center gap-1.5 text-[12.5px] text-foreground/80 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
                {reply.busy ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Check size={13} className="shrink-0" />}
                {reply.text}
              </p>
            )}
            <div className="-mx-1.5 mt-1.5 flex items-center gap-0.5">
              {moodButtons}
              <span className="flex-1" />
              {savedMenu}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <section className={cn("rounded-xl border border-border/70 bg-card", compact ? "mx-4 mb-3" : "mb-6")} aria-label="A thought for today">
      <header className="flex items-start gap-3 px-4 pt-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80">
          <Heart size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">A thought for today · {current.theme}</div>
          <p className="text-[15px] font-semibold leading-snug">“{current.quote}”</p>
        </div>
        <div className="-mr-1.5 flex shrink-0 items-center">
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Hide for today" title="Hide for today" onClick={hide}>
            <X />
          </Button>
        </div>
      </header>
      <p className="mx-4 mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{current.advice}</p>
      <div className="mx-4 mt-2 flex items-center justify-between gap-3 text-[11.5px] text-tertiary">
        <span className="italic">{current.affirmation}</span>
        <span className="shrink-0">{shown.basis}</span>
      </div>
      {reply && (
        <p role="status" className="mx-4 mt-2 flex items-center gap-1.5 text-[12.5px] text-foreground/80 animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
          {reply.busy ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Check size={13} className="shrink-0" />}
          {reply.text}
        </p>
      )}
      <footer className="mt-2 flex items-center gap-0.5 border-t border-border/50 px-2.5 py-1.5">
        {moodButtons}
        <span className="flex-1" />
        {savedMenu}
      </footer>
    </section>
  );
}
