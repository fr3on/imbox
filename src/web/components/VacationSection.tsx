import { BrandIcon } from "./BrandIcons";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plane, } from "lucide-react";
import { toast } from "sonner";
import type { VacationSettings } from "@shared/types";
import { useDraftVacationNotices, useEndVacation, useSaveVacation, useVacation } from "../api";
import { Section, Row } from "../settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DAY = 86_400_000;

/** `2026-10-12` for a date input, in the person's own day. */
const dateInput = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const startOf = (s: string): number => (s ? new Date(`${s}T00:00:00`).getTime() : NaN);
const words = (at: number) => new Date(at).toLocaleDateString([], { month: "long", day: "numeric" });

const KINDS: { key: keyof VacationSettings["notices"]; label: string; hint: string }[] = [
  { key: "team", label: "Someone at your organisation", hint: "Same email domain as yours." },
  { key: "contact", label: "Someone you have written to", hint: "You have sent them mail before." },
  { key: "other", label: "Anyone else", hint: "People you let in, but have not written to." },
];

/**
 * Being away. Pick the dates, say who handles urgent things, and have the notices written (by the model when one is set up, from a template
 * if not). Turning it on approves exactly the words shown here: they are what each person gets, with only their first name filled in.
 */
export function VacationSection() {
  const state = useVacation();
  const draft = useDraftVacationNotices();
  const save = useSaveVacation();
  const end = useEndVacation();
  const saved = state.data?.vacation ?? null;
  const active = !!state.data?.active;

  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(dateInput(Date.now()));
  const [until, setUntil] = useState("");
  const [contact, setContact] = useState("");
  const [guidance, setGuidance] = useState("");
  const [notices, setNotices] = useState<VacationSettings["notices"] | null>(null);
  const [source, setSource] = useState<"ai" | "template" | "edited" | null>(null);
  const [letThrough, setLetThrough] = useState<VacationSettings["letThrough"]>({ correspondents: true, urgent: true });

  // What was saved last fills the form, once it has loaded.
  useEffect(() => {
    if (!saved) return;
    setFrom(dateInput(saved.from));
    setUntil(dateInput(saved.until));
    setContact(saved.contact);
    setGuidance(saved.guidance);
    setLetThrough(saved.letThrough);
    if (saved.notices.team || saved.notices.contact || saved.notices.other) setNotices(saved.notices);
  }, [saved?.from, saved?.until, saved?.on]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromMs = startOf(from);
  const untilMs = startOf(until);
  const problem = useMemo(() => {
    if (!until) return "Pick the day you are back.";
    if (!(untilMs > Date.now())) return "Pick a day that is still ahead.";
    if (!(untilMs > Math.max(fromMs, Date.now()))) return "You have to be back after you leave.";
    if (untilMs - Math.max(fromMs, Date.now()) > 120 * DAY) return "Away notices can run for at most 120 days.";
    return "";
  }, [fromMs, untilMs, until]);
  const ready = !!notices && !!notices.team.trim() && !!notices.contact.trim() && !!notices.other.trim();

  const write = () =>
    draft.mutate(
      { from: Math.max(fromMs, Date.now()), until: untilMs, guidance, contact },
      {
        onSuccess: (r) => {
          setNotices(r.notices);
          setSource(r.source);
        },
        onError: (e) => toast.error("Couldn't write the notices", { description: (e as Error).message }),
      }
    );

  const turnOn = () => {
    if (!notices || problem) return;
    save.mutate(
      { on: true, approved: true, from: Math.max(fromMs, Date.now()), until: untilMs, guidance, contact, notices, letThrough },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(`You are away until ${words(untilMs)}`, { description: "Each person who writes gets one notice. The Imbox holds back everything else." });
        },
        onError: (e) => toast.error("Couldn't turn it on", { description: (e as Error).message }),
      }
    );
  };

  if (state.isLoading) return null;

  if (active && saved && !editing) {
    return (
      <Section title="Away" collapsible defaultOpen summary={`On until ${words(saved.until)}`} description="Replying to people who write, and keeping the Imbox quiet.">
        <Row step="solid" label={`You are away until ${words(saved.until)}`} hint={`${state.data?.replied ?? 0} ${state.data?.replied === 1 ? "person has" : "people have"} been told. It turns itself off on that day.`}>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button size="sm" disabled={end.isPending} onClick={() => end.mutate(undefined, { onSuccess: () => toast.success("Welcome back") })}>
              I am back
            </Button>
          </div>
        </Row>
      </Section>
    );
  }

  return (
    <Section title="Away" collapsible summary="Off" description="Tell people who write that you are away, and keep the Imbox quiet until you are back.">
      <Row label="Dates" hint="It starts when you turn it on and ends on the morning of the day you are back.">
        <div className="flex items-center gap-2">
          <Input type="date" className="w-[9.5rem]" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Away from" />
          <span className="text-[13px] text-muted-foreground">until</span>
          <Input type="date" className="w-[9.5rem]" value={until} min={dateInput(Date.now() + DAY)} onChange={(e) => setUntil(e.target.value)} aria-label="Back on" />
        </div>
      </Row>
      <Row label="Who handles urgent things" hint="Named in the notices. A name and an address works well. Leave it empty to say nothing about it.">
        <Input className="w-64 max-w-full" placeholder="Sofia, sofia@example.com" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} aria-label="Who handles urgent things" />
      </Row>
      <Row label="How it should sound" hint="One line is enough. For the model, when one is set up.">
        <Input className="w-64 max-w-full" placeholder="Friendly and short" value={guidance} maxLength={300} onChange={(e) => setGuidance(e.target.value)} aria-label="How the notices should sound" />
      </Row>
      <Row label="The notices" hint={state.data?.ai ? "Written by the model from what you gave it. Read each one: you can change any word." : "Written from a template, because no AI is set up. You can change any word."}>
        <Button variant="outline" size="sm" disabled={!!problem || draft.isPending} onClick={write}>
          {draft.isPending ? <Loader2 className="animate-spin" /> : <BrandIcon name="assistant" />}
          {notices ? "Write them again" : "Write the notices"}
        </Button>
      </Row>
      {notices && (
        <div className="space-y-4 border-b border-border/60 px-4 py-4 sm:px-5">
          {KINDS.map((k) => (
            <div key={k.key} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <label htmlFor={`vac-${k.key}`} className="text-[13px] font-medium">
                  {k.label}
                </label>
                <span className="text-xs text-muted-foreground">{k.hint}</span>
              </div>
              <Textarea
                id={`vac-${k.key}`}
                rows={5}
                value={notices[k.key]}
                maxLength={900}
                onChange={(e) => {
                  setNotices({ ...notices, [k.key]: e.target.value });
                  setSource("edited");
                }}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            <b className="font-medium">{"{name}"}</b> is replaced with the sender{"’"}s first name, or left out when it is not known. Each person is told once, then not again for four days. Newsletters, receipts, no-reply addresses and people waiting in the Screener never get one.
          </p>
        </div>
      )}
      <Row label="While you are away, let through" hint="The rest waits in Back to work on the Imbox, with no notification.">
        <div className="flex flex-col items-end gap-2.5 text-[13px]">
          <label className="flex items-center gap-2.5">
            People I have written to
            <Switch checked={letThrough.correspondents} onCheckedChange={(v) => setLetThrough({ ...letThrough, correspondents: v })} aria-label="People I have written to" />
          </label>
          <label className="flex items-center gap-2.5">
            Anything that reads as urgent
            <Switch checked={letThrough.urgent} onCheckedChange={(v) => setLetThrough({ ...letThrough, urgent: v })} aria-label="Anything that reads as urgent" />
          </label>
        </div>
      </Row>
      <Row label={ready ? "Turn it on" : "Write the notices first"} hint={problem || (ready ? "Turning it on approves these exact words. Nothing else is ever sent for you." : "Pick the day you are back, then have the notices written.")}>
        <div className="flex items-center gap-2">
          {editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
          <Button size="sm" disabled={!ready || !!problem || save.isPending} onClick={turnOn}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Plane />}
            Turn on
          </Button>
        </div>
      </Row>
      {source === "ai" && <p className="px-5 pt-2 text-xs text-muted-foreground">Written by AI. It saw only the day you are back, your name, and what you typed above. It never saw your mail.</p>}
    </Section>
  );
}
