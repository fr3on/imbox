import { useCalendarSources } from "../../api";
import { SectionsProvider } from "../../settings/parts";
import { Calendars } from "./Calendars";
import { CalendarPreferences } from "./CalendarPreferences";

export function CalendarSettingsSection({ compact }: { compact?: boolean }) {
  const q = useCalendarSources();
  const calendars = q.data?.calendars ?? [];
  return (
    <SectionsProvider>
      <Calendars
        calendars={calendars}
        accounts={q.data?.google_accounts ?? []}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
      />
      <CalendarPreferences compact={compact} />
    </SectionsProvider>
  );
}

export default CalendarSettingsSection;

export {
  FALLBACK_ZONES,
  zoneList,
  deviceZone,
  hourLabel,
  offsetOf,
  TimezoneSelect,
} from "./timezone";

export { HEX, RAMP, ColourPicker } from "./ColourPicker";

export {
  CalendarErrorNote,
  calendarCount,
  NEW_ACCOUNT,
  AccountHeader,
} from "./AccountHeader";

export { CalendarOptions } from "./CalendarOptions";

export { feedMessage, SubscribeDialog } from "./SubscribeDialog";

export { ImportDialog } from "./ImportDialog";

export { Calendars } from "./Calendars";

export {
  VIEW_LABEL,
  VIEWS,
  HOURS,
  CalendarPreferences,
} from "./CalendarPreferences";
