export interface BriefItem {
  thread_id: string;
  account_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  kind: "reply" | "decide" | "deadline" | "waiting";
  why: string;
  urgent: boolean;
  age_days: number;
}

export interface BriefMeeting {
  id: string;
  title: string;
  starts_at: number;
  ends_at: number;
  all_day: boolean;
  join_url: string;
  location: string;
  /** Missing on a brief saved before this was kept. */
  attendees?: number;
}

export interface DailyBrief {
  day: string;
  headline: string;
  items: BriefItem[];
  meetings: BriefMeeting[];
  source: "ai" | "rules";
}

/** A meeting stays on the brief this long after it starts. */
export const MEETING_GRACE_MS = 5 * 60_000;

/** The meetings still worth showing at `now`: all-day ones, and timed ones until a few minutes after they begin. */
export function liveMeetings(meetings: BriefMeeting[], now: number): BriefMeeting[] {
  return meetings.filter((m) => m.all_day || now < m.starts_at + MEETING_GRACE_MS);
}

/** "starting now", "in 12 min" or "" for a meeting, so the card can say where it stands. */
export function meetingTiming(m: BriefMeeting, now: number): { label: string; soon: boolean; started: boolean } {
  if (m.all_day) return { label: "", soon: false, started: false };
  if (now >= m.starts_at) return { label: "Started", soon: false, started: true };
  const min = Math.ceil((m.starts_at - now) / 60_000);
  if (min <= 15) return { label: min <= 1 ? "Starting now" : `In ${min} min`, soon: true, started: false };
  return { label: "", soon: false, started: false };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The line at the top of the card. The written headline is right when the brief was made; once a meeting has come and gone it would
 * still announce it, so it is rebuilt from what is left. Until something drops off, the written one is kept.
 */
export function liveHeadline(brief: Pick<DailyBrief, "headline" | "meetings" | "items">, now: number): string {
  const left = liveMeetings(brief.meetings, now);
  if (left.length === brief.meetings.length) return brief.headline;
  const owed = brief.items.filter((i: BriefItem) => i.kind !== "waiting").length;
  const waiting = brief.items.filter((i: BriefItem) => i.kind === "waiting").length;
  const parts = [left.length ? `${plural(left.length, "meeting", "meetings")} left today` : "", owed ? `${owed} waiting for your reply` : "", waiting ? `${waiting} you are waiting on` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing else needs you today.";
}

/** "30 min", "1 hr", "1 hr 30 min" for how long a timed meeting runs, "" when it has no length. */
export function meetingLength(m: Pick<BriefMeeting, "starts_at" | "ends_at" | "all_day">): string {
  const min = Math.round((m.ends_at - m.starts_at) / 60_000);
  if (m.all_day || min <= 0) return "";
  const h = Math.floor(min / 60);
  const r = min % 60;
  return [h ? `${h} hr` : "", r ? `${r} min` : ""].filter(Boolean).join(" ");
}
