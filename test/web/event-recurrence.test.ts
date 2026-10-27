import "./render";
import { describe, expect, it, vi } from "vitest";
import type { Calendar, CalEvent } from "@shared/types";
import { REPEAT_KINDS, BYDAY, baseRule, canon, ordinal, parseRepeat, repeatLabel, ruleParts, stripEnd, untilKey, untilStamp } from "@/calendar/event/recurrence";
import { SLOTS } from "@/calendar/event/time";
import { splitReminder } from "@/calendar/event/reminders";
import { allDaySet, buildRrule, endMoved, guestsSet, makeForm, pickCalendar, startMoved, toInput, type Form } from "@/calendar/event/form";

// The event editor's rules, with the answers worked out by hand: how a repeat is written and read back as an iCalendar rule, how a reminder is split
// into a number and a unit, and how an event becomes the form and the form becomes what is sent. Times are in UTC here. 2026-10-03 is a Saturday.

const SAT = "2026-10-03";

describe("ordinals", () => {
  it("says 1st 2nd 3rd and 4th, with the teens the odd ones out", () => {
    expect([1, 2, 3, 4, 10, 11, 12, 13, 14, 21, 22, 23, 24, 30, 31, 101, 111, 112, 121].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "10th", "11th", "12th", "13th", "14th", "21st", "22nd", "23rd", "24th", "30th", "31st", "101st", "111th", "112th", "121st"]);
  });
});

describe("the repeat choices", () => {
  it("are written as rules anchored on the start day", () => {
    expect(Object.fromEntries(REPEAT_KINDS.map((k) => [k, baseRule(k, SAT)]))).toEqual({
      daily: "FREQ=DAILY",
      weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      weekly: "FREQ=WEEKLY;BYDAY=SA",
      biweekly: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      monthly: "FREQ=MONTHLY;BYMONTHDAY=3",
      yearly: "FREQ=YEARLY",
    });
    expect(baseRule("weekly", "2026-10-05")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(BYDAY).toEqual(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
  });
  it("are labelled for the select", () => {
    expect(["never", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly", "custom"].map((k) => repeatLabel(k as never, SAT))).toEqual([
      "Does not repeat", "Every day", "Every weekday", "Weekly on Saturday", "Every two weeks", "Monthly on the 3rd", "Every year", "Custom…",
    ]);
    expect(repeatLabel("monthly", "2026-10-22")).toBe("Monthly on the 22nd");
  });
});

describe("reading rules", () => {
  it("splits a rule into upper-cased parts and tolerates the RRULE: prefix", () => {
    expect([...ruleParts("rrule:freq=weekly;byday=mo,we;count=4;junk")]).toEqual([["FREQ", "WEEKLY"], ["BYDAY", "MO,WE"], ["COUNT", "4"]]);
  });
  it("takes the ending off", () => {
    expect(stripEnd("RRULE:FREQ=DAILY;COUNT=5")).toBe("FREQ=DAILY");
    expect(stripEnd("FREQ=WEEKLY;UNTIL=20261231T235900Z;BYDAY=MO")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(stripEnd("FREQ=DAILY;count=3;")).toBe("FREQ=DAILY");
  });
  it("compares two rules that mean the same as equal", () => {
    expect(canon("FREQ=WEEKLY;BYDAY=MO;WKST=SU")).toBe(canon("FREQ=WEEKLY;BYDAY=MO"));
    expect(canon("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO")).toBe(canon("FREQ=WEEKLY;BYDAY=MO"));
    expect(canon("BYDAY=WE,MO;FREQ=WEEKLY")).toBe(canon("FREQ=WEEKLY;BYDAY=MO,WE"));
    expect(canon("freq=weekly;byday=mo")).toBe(canon("FREQ=WEEKLY;BYDAY=MO"));
    expect(canon("FREQ=WEEKLY;COUNT=3;BYDAY=MO")).toBe("BYDAY=MO;FREQ=WEEKLY");
    expect(canon("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")).not.toBe(canon("FREQ=WEEKLY;BYDAY=MO"));
  });
  it("reads UNTIL as a day, and writes a day back as the last minute of it", () => {
    expect(untilKey("20260905")).toBe("2026-09-05");
    expect(untilKey("20260905T235900Z")).toBe("2026-09-05");
    expect(untilKey("20260905T000000")).toBe("2026-09-05");
    expect(untilStamp("2026-09-05")).toBe("20260905T235900Z");
    expect(untilKey(untilStamp("2026-12-31"))).toBe("2026-12-31");
  });
  it("falls back to today for an UNTIL it cannot read", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 3, 12));
    expect(untilKey("soon")).toBe("2026-10-03");
    vi.useRealTimers();
  });
});

describe("recognising a stored rule", () => {
  it("says it does not repeat when there is no rule", () => {
    for (const r of [null, undefined, "", "   "]) expect(parseRepeat(r, SAT)).toEqual({ repeat: "never", rruleText: "", repeatEnd: "never", until: SAT, count: 10 });
  });
  it("recognises each of the offered choices, with a Google rule's extra WKST", () => {
    for (const k of REPEAT_KINDS) expect(parseRepeat(baseRule(k, SAT), SAT).repeat).toBe(k);
    expect(parseRepeat("RRULE:FREQ=WEEKLY;BYDAY=SA;WKST=MO", SAT).repeat).toBe("weekly");
    expect(parseRepeat("FREQ=WEEKLY;INTERVAL=1;BYDAY=SA", SAT).repeat).toBe("weekly");
  });
  it("reads the ending out of the rule", () => {
    expect(parseRepeat("FREQ=DAILY;COUNT=5", SAT)).toEqual({ repeat: "daily", rruleText: "", repeatEnd: "count", until: SAT, count: 5 });
    expect(parseRepeat("FREQ=DAILY;UNTIL=20261231T235900Z", SAT)).toEqual({ repeat: "daily", rruleText: "", repeatEnd: "until", until: "2026-12-31", count: 10 });
    expect(parseRepeat("FREQ=DAILY;COUNT=0", SAT).count).toBe(1);
    expect(parseRepeat("FREQ=DAILY;COUNT=abc", SAT).count).toBe(1);
  });
  it("keeps anything else as a custom rule, ending removed, never rewritten", () => {
    expect(parseRepeat("FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,TH;COUNT=6", SAT)).toEqual({ repeat: "custom", rruleText: "FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,TH", repeatEnd: "count", until: SAT, count: 6 });
  });
});

describe("reminders", () => {
  it("uses the biggest unit that divides evenly", () => {
    expect([0, 1, 45, 59, 60, 90, 120, 1440, 2880, 1500].map(splitReminder)).toEqual([
      { n: 0, unit: "minutes" }, { n: 1, unit: "minutes" }, { n: 45, unit: "minutes" }, { n: 59, unit: "minutes" }, { n: 1, unit: "hours" },
      { n: 90, unit: "minutes" }, { n: 2, unit: "hours" }, { n: 1, unit: "days" }, { n: 2, unit: "days" }, { n: 25, unit: "hours" },
    ]);
  });
});

const cal = (id: string, o: Partial<Calendar> = {}): Calendar => ({ id, account_id: null, source: "local", remote_id: null, url: null, name: id, description: "", color: "#3b82f6", timezone: "UTC", visible: true, writable: true, is_default: false, position: 0, last_synced_at: null, sync_status: "idle", ...o } as Calendar);

describe("which calendar a new event goes on", () => {
  it("is the default writable one, else the first writable one, else none", () => {
    expect(pickCalendar([cal("a"), cal("b", { is_default: true })])).toBe("b");
    expect(pickCalendar([cal("a", { writable: false, is_default: true }), cal("b"), cal("c")])).toBe("b");
    expect(pickCalendar([cal("a", { writable: false })])).toBe("");
    expect(pickCalendar([])).toBe("");
  });
});

const T9 = Date.UTC(2026, 9, 3, 9, 0);
const calendars = [cal("work", { is_default: true }), cal("home")];

describe("the form for an event", () => {
  it("starts a new timed event from the time given, on the default calendar", () => {
    const f = makeForm({ mode: "create", prefill: { starts_at: T9, ends_at: T9 + 90 * 60_000 } }, calendars);
    expect(f).toMatchObject({ calendar_id: "work", title: "", all_day: false, startDate: SAT, startMin: 540, endDate: SAT, endMin: 630, repeat: "never", count: 10, guests: [], reminders: [], countdown: false, circled: false });
  });
  it("starts a new all-day event with an hour after the start for when it is switched to timed", () => {
    const f = makeForm({ mode: "create", prefill: { starts_at: T9, ends_at: T9, all_day: true, start_date: SAT, end_date: "2026-10-05" } }, calendars);
    expect(f).toMatchObject({ all_day: true, startDate: SAT, endDate: "2026-10-05", startMin: 540, endMin: 600 });
  });
  it("carries a stored event over, with its repeat recognised and its guests and reminders copied", () => {
    const ev = { id: "e1", calendar_id: "home", title: "Studio", emoji: "🎬", all_day: false, starts_at: T9, ends_at: T9 + 3_600_000, rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=4", location: "Room 2", description: "Bring cables", attendees: [{ email: "a@x.test", name: "A", rsvp: "accepted" }], url: "https://x.test", reminders: [{ minutes: 15 }], countdown: true, circled: true } as unknown as CalEvent;
    const f = makeForm({ mode: "edit", event: ev }, calendars);
    expect(f).toMatchObject({ calendar_id: "home", title: "Studio", emoji: "🎬", repeat: "weekly", repeatEnd: "count", count: 4, location: "Room 2", description: "Bring cables", url: "https://x.test", countdown: true, circled: true });
    expect(f.guests).toEqual(ev.attendees);
    expect(f.guests).not.toBe(ev.attendees);
    expect(f.reminders).toEqual([{ minutes: 15 }]);
    expect(f.reminders).not.toBe(ev.reminders);
  });
  it("offers a quarter-hour slot every 15 minutes of the day", () => {
    expect([SLOTS.length, SLOTS[0], SLOTS[1], SLOTS[95]]).toEqual([96, 0, 15, 1425]);
  });
});

const form = (o: Partial<Form> = {}): Form => ({ calendar_id: "work", title: "  Studio  ", emoji: "", all_day: false, startDate: SAT, startMin: 540, endDate: SAT, endMin: 600, repeat: "never", rruleText: "", repeatEnd: "never", until: SAT, count: 10, location: " Room 2 ", description: "", guests: [], url: " https://x.test ", reminders: [], countdown: false, circled: false, ...o });

describe("the rule a form writes", () => {
  it("is none when it does not repeat", () => expect(buildRrule(form())).toBeNull());
  it("is the choice's rule, with its ending", () => {
    expect(buildRrule(form({ repeat: "weekly" }))).toBe("FREQ=WEEKLY;BYDAY=SA");
    expect(buildRrule(form({ repeat: "daily", repeatEnd: "count", count: 5 }))).toBe("FREQ=DAILY;COUNT=5");
    expect(buildRrule(form({ repeat: "daily", repeatEnd: "until", until: "2026-12-31" }))).toBe("FREQ=DAILY;UNTIL=20261231T235900Z");
    expect(buildRrule(form({ repeat: "daily", repeatEnd: "until", until: "" }))).toBe("FREQ=DAILY");
  });
  it("keeps the count between 1 and 999", () => {
    expect(buildRrule(form({ repeat: "daily", repeatEnd: "count", count: 5000 }))).toBe("FREQ=DAILY;COUNT=999");
    expect(buildRrule(form({ repeat: "daily", repeatEnd: "count", count: 0 }))).toBe("FREQ=DAILY;COUNT=1");
  });
  it("takes a custom rule as typed, without any ending typed into it, and none when it is empty", () => {
    expect(buildRrule(form({ repeat: "custom", rruleText: "FREQ=WEEKLY;INTERVAL=3;COUNT=2", repeatEnd: "count", count: 7 }))).toBe("FREQ=WEEKLY;INTERVAL=3;COUNT=7");
    expect(buildRrule(form({ repeat: "custom", rruleText: "  " }))).toBeNull();
  });
});

describe("what a form sends", () => {
  it("trims text and turns a timed event's day and minutes into instants", () => {
    const i = toInput(form({ startMin: 540, endMin: 630 }), "Europe/London");
    expect(i).toMatchObject({ title: "Studio", location: "Room 2", url: "https://x.test", timezone: "Europe/London", all_day: false, start_date: null, end_date: null, starts_at: Date.UTC(2026, 9, 3, 9), ends_at: Date.UTC(2026, 9, 3, 10, 30), rrule: null, calendar_id: "work" });
  });
  it("turns an all-day event's inclusive last day into the midnight after it", () => {
    const i = toInput(form({ all_day: true, startDate: SAT, endDate: "2026-10-05" }), "UTC");
    expect(i).toMatchObject({ all_day: true, start_date: SAT, end_date: "2026-10-05", starts_at: Date.UTC(2026, 9, 3), ends_at: Date.UTC(2026, 9, 6) });
  });
  it("carries guests, reminders and the extras", () => {
    const g = [{ email: "a@x.test", name: "A" }];
    const i = toInput(form({ guests: g as never, reminders: [{ minutes: 10 }], countdown: true, circled: true, emoji: "🎬", description: "Notes" }), "UTC");
    expect(i).toMatchObject({ attendees: g, reminders: [{ minutes: 10 }], countdown: true, circled: true, emoji: "🎬", description: "Notes" });
  });
});

// ---- editing the form: what moving things does (written after the editor's handlers became these functions; answers worked out by hand) ----
describe("moving the start", () => {
  it("drags the end along, keeping a timed event's length", () => {
    const f = form({ startMin: 540, endMin: 630 }); // 09:00 to 10:30
    expect(startMoved(f, { min: 600 })).toMatchObject({ startDate: SAT, startMin: 600, endDate: SAT, endMin: 690 });
    expect(startMoved(f, { date: "2026-10-05" })).toMatchObject({ startDate: "2026-10-05", startMin: 540, endDate: "2026-10-05", endMin: 630 });
  });
  it("carries the end over midnight when the move pushes it there", () => {
    const f = form({ startMin: 540, endMin: 630 });
    expect(startMoved(f, { min: 23 * 60 })).toMatchObject({ startMin: 1380, endDate: "2026-10-04", endMin: 30 });
  });
  it("never shrinks an event whose end was before its start", () => {
    const f = form({ startMin: 600, endMin: 540 });
    expect(startMoved(f, { min: 660 })).toMatchObject({ startMin: 660, endMin: 660 });
  });
  it("keeps an all-day event's span of days", () => {
    const f = form({ all_day: true, startDate: SAT, endDate: "2026-10-05" });
    expect(startMoved(f, { date: "2026-11-01" })).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-03" });
  });
});

describe("moving the end", () => {
  it("sets it, for a timed event", () => {
    expect(endMoved(form({ startMin: 540, endMin: 600 }), { min: 720 })).toMatchObject({ endDate: SAT, endMin: 720 });
    expect(endMoved(form({ startMin: 540, endMin: 600 }), { date: "2026-10-04", min: 60 })).toMatchObject({ endDate: "2026-10-04", endMin: 60 });
  });
  it("corrects an end at or before the start to one slot after it", () => {
    expect(endMoved(form({ startMin: 540, endMin: 600 }), { min: 480 })).toMatchObject({ endDate: SAT, endMin: 555 });
    expect(endMoved(form({ startMin: 540, endMin: 600 }), { min: 540 })).toMatchObject({ endMin: 555 });
    expect(endMoved(form({ startMin: 1430, endMin: 1435 }), { min: 1400 })).toMatchObject({ endDate: "2026-10-04", endMin: 5 });
  });
  it("keeps an all-day event's last day from falling before its first", () => {
    const f = form({ all_day: true, startDate: SAT, endDate: "2026-10-05" });
    expect(endMoved(f, { date: "2026-10-01" })).toMatchObject({ endDate: SAT });
    expect(endMoved(f, { date: "2026-10-09" })).toMatchObject({ endDate: "2026-10-09" });
  });
});

describe("switching between all day and timed", () => {
  it("does nothing when it is already so", () => {
    const f = form();
    expect(allDaySet(f, false)).toBe(f);
    const a = form({ all_day: true });
    expect(allDaySet(a, true)).toBe(a);
  });
  it("makes a timed event all day, ending on the day before an end at midnight", () => {
    expect(allDaySet(form({ startDate: SAT, endDate: "2026-10-04", endMin: 0 }), true)).toMatchObject({ all_day: true, endDate: SAT });
    expect(allDaySet(form({ startDate: SAT, endDate: "2026-10-04", endMin: 30 }), true)).toMatchObject({ all_day: true, endDate: "2026-10-04" });
    expect(allDaySet(form({ startDate: SAT, endDate: SAT, endMin: 0 }), true)).toMatchObject({ endDate: SAT });
  });
  it("makes an all-day event timed, at nine if it had no hour, for an hour", () => {
    expect(allDaySet(form({ all_day: true, startMin: 0 }), false)).toMatchObject({ all_day: false, startMin: 540, endMin: 600 });
    expect(allDaySet(form({ all_day: true, startMin: 840 }), false)).toMatchObject({ startMin: 840, endMin: 900 });
    expect(allDaySet(form({ all_day: true, startMin: 1430 }), false)).toMatchObject({ endMin: 1425 });
  });
});

describe("setting the guests", () => {
  it("keeps what is known about a guest who stays, including their answer, and takes a new name", () => {
    const f = form({ guests: [{ email: "A@x.test", name: "Old", rsvp: "accepted" }] as never });
    const next = guestsSet(f, [{ email: "a@x.test", name: "New" }, { email: "b@x.test", name: "B" }]);
    expect(next.guests).toEqual([{ email: "A@x.test", name: "New", rsvp: "accepted" }, { email: "b@x.test", name: "B" }]);
    expect(guestsSet(f, [{ email: "a@x.test", name: "" }]).guests[0].name).toBe("Old");
    expect(guestsSet(f, []).guests).toEqual([]);
  });
});
