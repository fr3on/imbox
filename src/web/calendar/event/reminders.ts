export const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;

export type Unit = keyof typeof UNITS;

/** 120 → "2 hours"; 45 → "45 minutes". The biggest unit that divides evenly wins. */
export function splitReminder(minutes: number): { n: number; unit: Unit } {
  if (minutes > 0 && minutes % UNITS.days === 0) return { n: minutes / UNITS.days, unit: "days" };
  if (minutes > 0 && minutes % UNITS.hours === 0) return { n: minutes / UNITS.hours, unit: "hours" };
  return { n: minutes, unit: "minutes" };
}
