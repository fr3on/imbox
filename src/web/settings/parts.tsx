import { createContext, useContext, useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Lets a page open or close all of its collapsible sections at once. `tick` changes each time, so asking for the same state twice still counts. */
/** True inside a collapsible card, where a `Panel` is just its contents: the card already has the border. */
const InCard = createContext(false);

export const SectionsContext = createContext<{ all: boolean | null; tick: number }>({ all: null, tick: 0 });

/** Wraps a tab's sections and gives it the "Expand all / Collapse all" link. */
export function SectionsProvider({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useState<{ all: boolean | null; tick: number }>({ all: null, tick: 0 });
  return (
    <SectionsContext.Provider value={all}>
      <div className="mb-3 flex justify-end px-2">
        <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setAll({ all: all.all !== true, tick: all.tick + 1 })}>
          {all.all === true ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {children}
    </SectionsContext.Provider>
  );
}

const openKey = (title: string) => `imbox.settings.open.${title}`;
function readOpen(title: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(openKey(title));
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

/**
 * A group of settings. With `collapsible` it is a card that shows `summary` (its state in a few words) and opens on a click; what was left open
 * is remembered in this browser.
 */
export function Section({ title, description, children, actions, collapsible, summary, defaultOpen = false }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode; collapsible?: boolean; summary?: React.ReactNode; defaultOpen?: boolean }) {
  const all = useContext(SectionsContext);
  const [open, setOpen] = useState(() => (collapsible ? readOpen(title, defaultOpen) : true));
  useEffect(() => {
    if (collapsible && all.tick > 0 && all.all !== null) setOpen(all.all);
  }, [all.tick, all.all, collapsible]);
  const toggle = () => {
    setOpen(!open);
    try {
      window.localStorage.setItem(openKey(title), open ? "0" : "1");
    } catch {
      /* not remembered */
    }
  };
  if (!collapsible) {
    return (
      <section className="mb-10">
        <div className="flex items-start justify-between gap-4 mb-3 px-2">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="text-[13px] text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </section>
    );
  }
  return (
    <InCard.Provider value={true}>
    <section className="mb-3 rounded-xl border border-border/80 bg-card">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
          {summary != null && <span className="truncate">{summary}</span>}
          <ChevronRight size={16} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border/60">
          {(description || actions) && (
            <div className="flex items-start justify-between gap-4 px-4 pt-3 sm:px-5">
              {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : <span />}
              {actions}
            </div>
          )}
          {children}
        </div>
      )}
    </section>
    </InCard.Provider>
  );
}

export function Row({ label, hint, step, children }: { label: React.ReactNode; hint?: React.ReactNode; /** A marker before the label, for settings that read as steps of one story: solid or hollow. */ step?: "solid" | "hollow"; children: React.ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 items-center px-4 sm:px-5 py-3.5 border-b border-border/60 last:border-b-0 hover:bg-muted/15 transition-colors">
      <div className={cn("min-w-0", step && "flex gap-3")}>
        {step && <span aria-hidden className={cn("mt-[7px] size-2 shrink-0 rounded-full", step === "solid" ? "bg-foreground" : "ring-2 ring-inset ring-muted-foreground")} />}
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </div>
      <div className="min-w-0 sm:justify-self-end scrollbar-none"><div className="w-max max-w-full">{children}</div></div>
    </div>
  );
}

export function Panel({ children }: { children: React.ReactNode }) {
  if (useContext(InCard)) return <div>{children}</div>;
  return <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">{children}</div>;
}

export function SavedMark({ show }: { show: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground transition-opacity duration-100", show ? "opacity-100" : "opacity-0")}>
      <Check size={12} /> Saved
    </span>
  );
}

export function Toggle({ value, options, onChange, className, itemClassName }: { value: string; options: { value: string; label: string; icon?: React.ReactNode }[]; onChange: (v: string) => void; className?: string; itemClassName?: string }) {
  return (
    <ToggleGroup type="single" size="sm" value={value} onValueChange={(v) => v && onChange(v)} className={className}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className={cn("gap-1.5 text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground [&>svg]:size-3.5", itemClassName)}>
          {o.icon}
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Danger({ open, onOpenChange, title, body, action, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; action: string; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Dialog (desktop) or bottom Drawer (mobile) around a form. */
export function FormShell({ open, onClose, title, description, footer, variant = "dialog", className, children }: { open: boolean; onClose: () => void; title: string; description?: string; footer: React.ReactNode; variant?: "dialog" | "drawer"; className?: string; children: React.ReactNode }) {
  if (variant === "drawer") {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent className="pb-safe max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description ? <DrawerDescription>{description}</DrawerDescription> : <DrawerDescription className="sr-only">Form</DrawerDescription>}
          </DrawerHeader>
          <div className="px-4 overflow-y-auto">{children}</div>
          <DrawerFooter className="pt-3 flex-col-reverse gap-2">{footer}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("sm:max-w-md grid-cols-[minmax(0,1fr)]", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">Form</DialogDescription>}
        </DialogHeader>
        <div className="my-5 min-w-0">{children}</div>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Accounts ---------- */
