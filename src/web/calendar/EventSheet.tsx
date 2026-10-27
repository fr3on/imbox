import { BrandIcon } from "@/components/BrandIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Lock, MapPin, } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { browserTimezone, useEventMutations, type EventScope } from "@/api";
import { useAccount } from "@/context/AccountContext";
import { useCalendar, type EditorTarget } from "@/calendar/CalendarContext";
import { AskDialogs, type Ask } from "./event/AskDialogs";
import { EventDetails } from "./event/EventDetails";
import { FooterBar } from "./event/FooterBar";
import { GuestsRow } from "./event/GuestsRow";
import { RemindersRow } from "./event/RemindersRow";
import { RepeatRow } from "./event/RepeatRow";
import { DateField, EmojiButton, Row, TimeField } from "./event/fields";
import { allDaySet, endMoved, guestsSet, makeForm, pickCalendar, startMoved, toInput, type Form } from "./event/form";


/**
 * The calendar's one editor. Renders nothing until `openEvent`/`createEvent` puts something in
 * `editor`; the inner form is keyed on the target so switching events starts from clean state.
 */
export function EventSheet() {
  const { editor } = useCalendar();
  if (!editor) return null;
  const key = editor.mode === "edit" ? editor.event.id : `new:${editor.prefill.starts_at}:${editor.prefill.all_day ? 1 : 0}`;
  return <EventForm key={key} target={editor} />;
}

export function EventForm({ target }: { target: EditorTarget }) {
  const { closeEditor, calendars, settings, openEvent } = useCalendar();
  const { user, accounts } = useAccount();
  const m = useEventMutations();
  const ev = target.mode === "edit" ? target.event : null;

  const [form, setForm] = useState<Form>(() => makeForm(target, calendars));
  // The form as it was opened. Anything different from this is an unsaved change.
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(form));
  const [ask, setAsk] = useState<Ask>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // The calendar list can arrive after mount; filling the blank must not make the form dirty.
  useEffect(() => {
    if (form.calendar_id || calendars.length === 0) return;
    const id = pickCalendar(calendars);
    if (!id) return;
    const next = { ...form, calendar_id: id };
    setForm(next);
    setBaseline(JSON.stringify(next));
  }, [calendars, form]);

  useEffect(() => {
    if (target.mode === "create") {
      const t = setTimeout(() => titleRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [target.mode]);

  const cal = calendars.find((c) => c.id === form.calendar_id);
  /** An ICS subscription is a mirror of somebody else's calendar: readable, never writable. */
  const readOnly = (ev ? ev.writable === false : false) || cal?.writable === false;
  const busy = m.create.isPending || m.update.isPending || m.remove.isPending;
  const dirty = JSON.stringify(form) !== baseline;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  /* --- times ------------------------------------------------------------ */

  const moveStart = (patch: { date?: string; min?: number }) => setForm((f) => startMoved(f, patch));

  const moveEnd = (patch: { date?: string; min?: number }) => setForm((f) => endMoved(f, patch));

  const setAllDay = (on: boolean) => setForm((f) => allDaySet(f, on));

  /* --- guests ----------------------------------------------------------- */

  // AddressInput speaks Address; attendees also carry an RSVP we must not throw away on edit.
  const guestAddresses = useMemo(() => form.guests.map((g) => ({ email: g.email, name: g.name ?? "" })), [form.guests]);
  const setGuests = (next: { email: string; name: string }[]) => setForm((f) => guestsSet(f, next));

  /* --- mutations -------------------------------------------------------- */

  const doSave = async (scope?: EventScope) => {
    setError(null);
    if (!form.title.trim()) {
      setError("Give the event a title.");
      titleRef.current?.focus();
      return;
    }
    if (!form.calendar_id) {
      setError("Pick a calendar to put this on.");
      return;
    }
    const body = toInput(form, settings.timezone || browserTimezone());
    try {
      if (ev) await m.update.mutateAsync({ id: ev.id, scope, ...body });
      else await m.create.mutateAsync(body);
      closeEditor();
    } catch (e) {
      // A failed save stays on screen next to the button — a toast would take the reason with it.
      setError((e as Error).message || "Couldn't save this event.");
    }
  };

  const doDelete = async (scope?: EventScope) => {
    if (!ev) return;
    setError(null);
    try {
      await m.remove.mutateAsync({ id: ev.id, scope });
      closeEditor();
    } catch (e) {
      setError((e as Error).message || "Couldn't delete this event.");
    }
  };

  // Recurring writes always ask which occurrences they mean, and the answer rides as `scope`.
  // Not for a Google-expanded series though: those rows carry no RRULE, so there is nothing to
  // narrow a save to and every scope would mean the same thing. Editing one edits that occurrence,
  // which is what Google itself does with an instance. Deleting still asks — a delete can reach the
  // siblings by id even without a rule tying them together.
  const requestSave = () => {
    if (readOnly || busy) return;
    if (ev?.recurring && !ev.series) setAsk("save-scope");
    else void doSave();
  };
  const requestDelete = () => {
    if (!ev || readOnly || busy) return;
    setAsk(ev.recurring ? "delete-scope" : "delete");
  };
  const requestClose = () => {
    if (dirty && !readOnly) setAsk("discard");
    else closeEditor();
  };

  /* --- extras ----------------------------------------------------------- */

  const mine = useMemo(() => {
    const emails = new Set<string>();
    if (user?.email) emails.add(user.email.toLowerCase());
    for (const a of accounts) emails.add(a.email.toLowerCase());
    return emails;
  }, [user?.email, accounts]);
  const myInvite = ev?.attendees.find((a) => mine.has(a.email.toLowerCase()));

  const writableCalendars = calendars.filter((c) => c.writable || c.id === form.calendar_id);

  return (
    <Sheet open onOpenChange={(o) => !o && requestClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-none"
        style={{ width: "100%", maxWidth: 540 }}
        onEscapeKeyDown={(e) => {
          if (ask !== null || (dirty && !readOnly)) {
            e.preventDefault();
            if (ask === null) setAsk("discard");
          }
        }}
        onInteractOutside={(e) => {
          if (ask !== null || (dirty && !readOnly)) e.preventDefault();
        }}
        onKeyDown={(e) => {
          // ⌘/Ctrl + Enter saves from anywhere in the sheet.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            requestSave();
          }
        }}
      >
        {/* The sheet is full-screen on a phone, so the header clears the notch and the action row
            clears the home indicator. On a desktop both insets are zero and nothing changes. */}
        <SheetHeader className="border-b border-border pb-3 pt-[calc(1rem+env(safe-area-inset-top))]">
          <SheetTitle>{ev ? "Event" : "New event"}</SheetTitle>
          <SheetDescription className="sr-only">Edit the details of a calendar event.</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {/* Emoji + title */}
          <div className="flex items-center gap-2 border-b border-border py-2">
            <EmojiButton value={form.emoji} onChange={(v) => set("emoji", v)} disabled={readOnly} />
            <input
              ref={titleRef}
              value={form.title}
              disabled={readOnly}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Untitled event"
              aria-label="Title"
              className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold tracking-[-0.01em] text-foreground outline-none placeholder:text-tertiary disabled:opacity-70"
            />
          </div>

          <Row label="All day">
            <label className="inline-flex h-7 items-center gap-2 text-[13px] text-muted-foreground select-none">
              <Switch checked={form.all_day} disabled={readOnly} onCheckedChange={setAllDay} aria-label="All day" />
              {form.all_day ? "Takes the whole day" : "Has a start and an end"}
            </label>
          </Row>

          <Row label="Starts" icon={<BrandIcon name="calendar" />}>
            <div className="flex flex-wrap items-center gap-1.5">
              <DateField value={form.startDate} disabled={readOnly} onChange={(d) => moveStart({ date: d })} />
              {!form.all_day && (
                <TimeField day={form.startDate} minutes={form.startMin} format={settings.time_format} disabled={readOnly} onChange={(min) => moveStart({ min })} />
              )}
            </div>
          </Row>

          <Row label="Ends">
            <div className="flex flex-wrap items-center gap-1.5">
              <DateField value={form.endDate} disabled={readOnly} onChange={(d) => moveEnd({ date: d })} />
              {!form.all_day && (
                <TimeField day={form.endDate} minutes={form.endMin} format={settings.time_format} disabled={readOnly} onChange={(min) => moveEnd({ min })} />
              )}
            </div>
          </Row>

          <RepeatRow form={form} set={set} readOnly={readOnly} />

          <Row label="Location" icon={<MapPin />}>
            <Input
              value={form.location}
              disabled={readOnly}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Somewhere, or a room"
              aria-label="Location"
              className="h-7"
            />
          </Row>

          <Row label="Calendar">
            <Select value={form.calendar_id} disabled={readOnly} onValueChange={(v) => set("calendar_id", v)}>
              <SelectTrigger size="sm" className="w-full max-w-64">
                <SelectValue placeholder="Pick a calendar" />
              </SelectTrigger>
              <SelectContent>
                {writableCalendars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: c.color || "currentColor" }} />
                      <span className="truncate">{c.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label="Notes">
            <Textarea
              value={form.description}
              disabled={readOnly}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Anything worth remembering"
              aria-label="Notes"
              className="min-h-16 text-[13px]"
            />
          </Row>

          <GuestsRow form={form} guestAddresses={guestAddresses} setGuests={setGuests} readOnly={readOnly} />

          <Row label="Link" icon={<Link2 />}>
            <Input value={form.url} disabled={readOnly} onChange={(e) => set("url", e.target.value)} placeholder="https://" aria-label="Link" className="h-7" />
          </Row>

          <RemindersRow form={form} setForm={setForm} readOnly={readOnly} />

          <Row label="Extras">
            <div className="flex flex-col gap-2 pt-0.5">
              <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground select-none">
                <Switch checked={form.countdown} disabled={readOnly} onCheckedChange={(v) => set("countdown", v)} aria-label="Show a countdown" />
                Show a countdown
              </label>
              <label className="inline-flex items-center gap-2 text-[13px] text-muted-foreground select-none">
                <Switch checked={form.circled} disabled={readOnly} onCheckedChange={(v) => set("circled", v)} aria-label="Circle this day" />
                Circle this day
              </label>
            </div>
          </Row>

          {readOnly && (
            <p className="flex items-start gap-2 pt-3 text-[13px] text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-tertiary" />
              This comes from a subscribed calendar{cal ? ` (${cal.name})` : ""} and can't be edited here.
            </p>
          )}

          <EventDetails ev={ev} myInvite={myInvite} readOnly={readOnly} m={m} closeEditor={closeEditor} />
        </div>

        <FooterBar ev={ev} readOnly={readOnly} busy={busy} error={error} setError={setError} requestDelete={requestDelete} requestClose={requestClose} requestSave={requestSave} m={m} openEvent={openEvent} />

        <AskDialogs ask={ask} setAsk={setAsk} form={form} doDelete={doDelete} doSave={doSave} closeEditor={closeEditor} />
      </SheetContent>
    </Sheet>
  );
}
