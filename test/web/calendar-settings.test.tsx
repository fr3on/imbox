import { describe, expect, it } from "vitest";
import type { Calendar, CalendarSettings, CalendarSourcesResponse, GoogleCalendarAccount } from "@shared/types";
import { html } from "./render";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  CalendarSettingsSection,
  TimezoneSelect,
  ColourPicker,
  CalendarOptions,
  CalendarErrorNote,
  calendarCount,
  NEW_ACCOUNT,
  AccountHeader,
  Calendars,
  CalendarPreferences,
  feedMessage,
  hourLabel,
  offsetOf,
  zoneList,
  deviceZone,
  FALLBACK_ZONES,
  HEX,
  RAMP,
  VIEW_LABEL,
  VIEWS,
  HOURS,
} from "@/components/CalendarSettingsSection";

// The Calendar tab of Settings: every calendar as a tile, one Add menu, and a timezone you can search.

const cal = (id: string, name: string, o: Partial<Calendar> = {}): Calendar => ({
  id, account_id: null, source: "local", remote_id: null, url: null, name, description: "", color: "#3d5a6c", timezone: "", visible: true, writable: true,
  is_default: false, position: 0, last_synced_at: null, sync_status: "idle", sync_error: null, ...o,
});
const settings: CalendarSettings = { timezone: "Africa/Cairo", week_start: 1, night_start: 22, night_end: 6, collapse_night: true, time_format: "12", default_view: "week", show_declined: true, cover_art: false };

const page = () =>
  html(<CalendarSettingsSection />, "/settings", (qc) => {
    const data: CalendarSourcesResponse = {
      calendars: [cal("c1", "Ahmed", { is_default: true }), cal("c2", "Egypt Holidays", { source: "ics", url: "https://example.com/h.ics", writable: false }), cal("c3", "Old one", { visible: false })],
      settings, connectable: [], google_accounts: [],
    };
    qc.setQueryData(["cal", "sources"], data);
    qc.setQueryData(["cal", "settings"], settings);
  });

describe("the Calendar tab", () => {
  it("shows each calendar as a tile, marks the default, and dims the hidden one", () => {
    const out = page();
    for (const n of ["Ahmed", "Egypt Holidays", "Old one"]) expect(out).toContain(n);
    expect(out).toContain("Default");
    expect(out).toContain("opacity-55");
    expect(out).toContain("1 hidden");
  });

  it("has one Add calendar menu instead of the forms on the page", () => {
    const out = page();
    expect(out).toContain("Add calendar");
    expect(out).not.toContain("Subscribe to a calendar link");
    expect(out).not.toContain("Import an .ics file into a calendar");
  });

  it("shows the chosen timezone on a picker you can search, and the device's own when none is chosen", () => {
    const chosen = html(<TimezoneSelect value="America/New_York" zones={["America/New_York", "Africa/Cairo"]} device="Africa/Cairo" onChange={() => {}} />);
    expect(chosen).toContain('role="combobox"');
    expect(chosen).toContain("America/New York");
    const device = html(<TimezoneSelect value="" zones={["Africa/Cairo"]} device="Africa/Cairo" onChange={() => {}} />);
    expect(device).toContain("Same as this device (Africa/Cairo)");
  });
});

describe("timezone and time formatting helpers", () => {
  it("formats hours correctly in 12-hour and 24-hour formats", () => {
    expect(hourLabel(0, "12")).toBe("12 AM");
    expect(hourLabel(1, "12")).toBe("1 AM");
    expect(hourLabel(11, "12")).toBe("11 AM");
    expect(hourLabel(12, "12")).toBe("12 PM");
    expect(hourLabel(13, "12")).toBe("1 PM");
    expect(hourLabel(23, "12")).toBe("11 PM");

    expect(hourLabel(0, "24")).toBe("00:00");
    expect(hourLabel(9, "24")).toBe("09:00");
    expect(hourLabel(12, "24")).toBe("12:00");
    expect(hourLabel(23, "24")).toBe("23:00");
  });

  it("returns offset strings for valid zones and empty string on invalid zone", () => {
    const utcOff = offsetOf("UTC");
    expect(utcOff.length).toBeGreaterThan(0);
    expect(offsetOf("Invalid/Zone_Name_12345")).toBe("");
  });

  it("produces zoneList with current zone prepended if missing", () => {
    const list = zoneList("Custom/Unknown_Zone");
    expect(list[0]).toBe("Custom/Unknown_Zone");
    expect(list.length).toBeGreaterThan(1);
    expect(FALLBACK_ZONES.length).toBeGreaterThan(40);
    expect(FALLBACK_ZONES).toContain("UTC");
    expect(FALLBACK_ZONES).toContain("Africa/Cairo");
  });

  it("deviceZone returns a non-empty string", () => {
    expect(typeof deviceZone()).toBe("string");
    expect(deviceZone().length).toBeGreaterThan(0);
  });
});

describe("feed messages and colour ramp", () => {
  it("maps feed errors to user-friendly messages", () => {
    expect(feedMessage(new Error("bad url"))).toBe("That link should start with https:// or webcal://.");
    expect(feedMessage("BAD URL")).toBe("That link should start with https:// or webcal://.");
    expect(feedMessage(new Error("bad feed"))).toBe("That link didn't return a calendar. Open it in a browser to check it's an .ics feed.");
    expect(feedMessage(new Error("custom error"))).toBe("custom error");
    expect(feedMessage("")).toBe("That link couldn't be subscribed to.");
  });

  it("validates hex colors against HEX and defines 12 muted hues in RAMP", () => {
    expect(HEX.test("#111111")).toBe(true);
    expect(HEX.test("#3d6c56")).toBe(true);
    expect(HEX.test("#ffffff")).toBe(true);
    expect(HEX.test("invalid")).toBe(false);
    expect(HEX.test("#123")).toBe(false);
    expect(HEX.test("#1234567")).toBe(false);

    expect(RAMP).toHaveLength(12);
    for (const color of RAMP) {
      expect(HEX.test(color)).toBe(true);
    }
  });

  it("formats calendar counts correctly", () => {
    expect(calendarCount(1)).toBe("1 calendar");
    expect(calendarCount(0)).toBe("0 calendars");
    expect(calendarCount(4)).toBe("4 calendars");
    expect(NEW_ACCOUNT).toBe("__new__");
  });

  it("defines standard view labels and hours array", () => {
    expect(VIEWS).toEqual(["days", "week", "month", "year"]);
    expect(VIEW_LABEL.days).toBe("Day");
    expect(VIEW_LABEL.week).toBe("Week");
    expect(VIEW_LABEL.month).toBe("Month");
    expect(VIEW_LABEL.year).toBe("Year");
    expect(HOURS).toHaveLength(24);
  });
});

describe("subcomponents rendering", () => {
  it("renders CalendarPreferences with all rows when settings are loaded", () => {
    const out = html(<CalendarPreferences />, "/settings", (qc) => {
      qc.setQueryData(["cal", "settings"], settings);
    });
    expect(out).toContain("Calendar preferences");
    expect(out).toContain("Week starts on");
    expect(out).toContain("Sunday");
    expect(out).toContain("Monday");
    expect(out).toContain("Time format");
    expect(out).toContain("12-hour");
    expect(out).toContain("24-hour");
    expect(out).toContain("Default view");
    expect(out).toContain("Collapse the night");
    expect(out).toContain("Night runs from");
    expect(out).toContain("Show events you&#x27;ve declined");
    expect(out).toContain("Timezone");
  });

  it("renders CalendarPreferences compact toggle classes when compact is true", () => {
    const out = html(<CalendarPreferences compact />, "/settings", (qc) => {
      qc.setQueryData(["cal", "settings"], settings);
    });
    expect(out).toContain("grid-cols-2");
  });

  it("renders ColourPicker button with the initial color style", () => {
    const out = html(<ColourPicker value="#3d6c56" onChange={() => {}} />);
    expect(out).toContain('aria-label="Colour"');
    expect(out).toContain("background:#3d6c56");
  });

  it("renders CalendarErrorNote for disabled API and other errors", () => {
    const disabledMsg = "The Calendar API has not been used in project 12345. Visit https://console.developers.google.com/apis/api/calendar-json.googleapis.com to enable it.";
    const outDisabled = html(<CalendarErrorNote message={disabledMsg} />);
    expect(outDisabled).toContain("The Calendar API is off for this Google Cloud project.");
    expect(outDisabled).toContain("Enable the Google Calendar API");
    expect(outDisabled).toContain('href="https://console.developers.google.com/apis/api/calendar-json.googleapis.com"');

    const genericMsg = "Backend timed out";
    const outGeneric = html(<CalendarErrorNote message={genericMsg} />);
    expect(outGeneric).toContain("Couldn&#x27;t read this account&#x27;s calendars.");
    expect(outGeneric).toContain("Backend timed out");
  });

  it("renders AccountHeader with reconnect and disconnect for calendar account", () => {
    const acc: GoogleCalendarAccount = {
      id: "acc1",
      email: "user@example.com",
      mail: true,
      calendar: true,
      calendar_count: 2,
      sync_error: null,
      calendar_error: null,
    };
    const out = html(<AccountHeader a={acc} count={2} pending={null} onConnect={() => {}} />);
    expect(out).toContain("user@example.com");
    expect(out).toContain("2 calendars");
    expect(out).toContain("Reconnect");
    expect(out).toContain("Disconnect");
  });

  it("renders AccountHeader with Connect calendar for mail-only account", () => {
    const acc: GoogleCalendarAccount = {
      id: "acc2",
      email: "mailonly@example.com",
      mail: true,
      calendar: false,
      calendar_count: 0,
      sync_error: null,
      calendar_error: null,
    };
    const out = html(<AccountHeader a={acc} count={0} pending={null} onConnect={() => {}} />);
    expect(out).toContain("mailonly@example.com");
    expect(out).toContain("mail only");
    expect(out).toContain("Connect calendar");
  });

  it("renders Calendars empty state when no calendars and no accounts", () => {
    const out = html(<Calendars calendars={[]} accounts={[]} loading={false} error={null} />);
    expect(out).toContain("No calendars yet.");
    expect(out).toContain("No Google account yet");
  });

  it("renders Calendars attention section when account has error", () => {
    const attentionAcc: GoogleCalendarAccount = {
      id: "acc-err",
      email: "broken@example.com",
      mail: true,
      calendar: false,
      calendar_count: 0,
      sync_error: null,
      calendar_error: "API disabled",
    };
    const out = html(<Calendars calendars={[]} accounts={[attentionAcc]} loading={false} error={null} />);
    expect(out).toContain("Google accounts");
    expect(out).toContain("broken@example.com");
  });

  it("renders CalendarOptions drawer content for different calendar sources", () => {
    const localCal = cal("c-local", "Personal", { source: "local", event_count: 5 });
    const localOut = html(
      <Sheet open>
        <CalendarOptions c={localCal} account={undefined} pending={null} onConnect={() => {}} onClose={() => {}} />
      </Sheet>
    );
    expect(localOut).toContain("Personal");
    expect(localOut).toContain("Kept in imbox");
    expect(localOut).toContain("5 events");
    expect(localOut).toContain("New events go here");
    expect(localOut).toContain("Remove this calendar");

    const feedCal = cal("c-feed", "Holidays", { source: "ics", url: "https://calendar.google.com/calendar/ical/user%40example.com/public/basic.ics", writable: false });
    const feedOut = html(
      <Sheet open>
        <CalendarOptions c={feedCal} account={undefined} pending={null} onConnect={() => {}} onClose={() => {}} />
      </Sheet>
    );
    expect(feedOut).toContain("Subscribed link");
    expect(feedOut).toContain("Sync now");
    expect(feedOut).toContain("Busy times only");
  });
});
