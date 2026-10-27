import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as T from "@shared/types";
import { ApiError, api, humanize, qs, request } from "./client";
import { invalidateCalendar, keys } from "./keys";

/** How a write applies to a recurring event: just this occurrence, this and later, or the series. */
export type EventScope = "this" | "following" | "all";

/** The writable half of a CalEvent. Everything is optional on PATCH; POST needs at least a title. */
export interface EventInput {
  calendar_id?: string;
  kind?: T.EventKind;
  title?: string;
  description?: string;
  location?: string;
  emoji?: string;
  all_day?: boolean;
  starts_at?: number;
  ends_at?: number;
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string;
  rrule?: string | null;
  status?: T.CalEvent["status"];
  busy?: boolean;
  countdown?: boolean;
  circled?: boolean;
  attendees?: T.EventAttendee[];
  conference_url?: string;
  url?: string;
  reminders?: T.Reminder[];
  thread_id?: string | null;
  done?: boolean;
}

/** POST /api/calendar/events/from-thread — a half-filled event to open the composer with. */
export interface EventPrefill extends EventInput {
  thread_id: string | null;
  /** Suggested times parsed out of the message, if any. */
  suggestions?: { starts_at: number; ends_at: number }[];
}

/** `:id` may be `<row>@<YYYY-MM-DD>`, addressing one occurrence of a recurring master. */
function eventPath(id: string): string {
  return `/api/calendar/events/${encodeURIComponent(id)}`;
}

/** Download URL for a single event as `.ics`. */
export function eventIcsUrl(id: string): string {
  return `${eventPath(id)}.ics`;
}

// --- Range ---
/**
 * Everything needed to draw `from`..`to` (inclusive dates): events, day labels and cover art,
 * the week's flex tasks and time entries.
 *
 * `placeholderData` keeps the previous window on screen while the next one loads, so scrolling
 * the day strip never blanks the columns.
 */
export function useCalendarRange(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: keys.calRange(from, to),
    queryFn: () => api.get<T.CalendarRange>(`/api/calendar/events${qs({ from, to })}`),
    enabled: enabled && !!from && !!to,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

// --- Sources ---
export function useCalendarSources(enabled = true) {
  return useQuery({
    queryKey: keys.calSources,
    queryFn: () => api.get<T.CalendarSourcesResponse>("/api/calendar/sources"),
    enabled,
    staleTime: 30_000,
  });
}

export function useCalendarSourceMutations() {
  const qc = useQueryClient();
  const inv = () => invalidateCalendar(qc);
  return {
    create: useMutation({ mutationFn: (b: { name: string; color?: string }) => api.post<T.Calendar>("/api/calendar/sources", b), onSuccess: inv }),
    subscribe: useMutation({ mutationFn: (b: { url: string; name?: string; color?: string }) => api.post<T.Calendar>("/api/calendar/sources/subscribe", b), onSuccess: inv }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string; visible?: boolean; is_default?: boolean }) => api.patch<T.Calendar>(`/api/calendar/sources/${id}`, b),
      onSuccess: inv,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/calendar/sources/${id}`), onSuccess: inv }),
    sync: useMutation({ mutationFn: (id: string) => api.post<{ ok: boolean; error?: string | null }>(`/api/calendar/sources/${id}/sync`), onSuccess: inv }),
    syncAll: useMutation({ mutationFn: () => api.post<{ ok: boolean; synced?: number }>("/api/calendar/sources/sync"), onSuccess: inv }),
    /** Upload an `.ics` body; its events land in a local calendar and become editable. */
    importIcs: useMutation({
      mutationFn: (b: { ics: string; calendar_id?: string; name?: string; color?: string }) => api.post<{ ok: boolean; imported: number; calendar?: T.Calendar }>("/api/calendar/sources/import", b),
      onSuccess: inv,
    }),
  };
}

/**
 * Kicks off Google consent for the Calendar scope; open the returned URL. `account_id` pre-fills
 * which account to sign in as; `calendar_only` asks for calendar access and no mail access at all.
 */
export function useCalendarConnectLink() {
  return useMutation({
    mutationFn: (b: { account_id?: string; calendar_only?: boolean } = {}) => api.post<{ url: string }>("/api/calendar/google/connect-link", b),
  });
}

/** Drops one Google account's calendars and their events, and forgets its Calendar scope. Mail is untouched. */
export function useCalendarDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.post<{ ok: boolean; removed: number } & T.CalendarSourcesResponse>(`/api/calendar/google/${accountId}/disconnect`),
    onSuccess: () => invalidateCalendar(qc),
  });
}

// --- Settings ---
export function useCalendarSettings(enabled = true) {
  return useQuery({
    queryKey: keys.calSettings,
    queryFn: () => api.get<T.CalendarSettings>("/api/calendar/settings"),
    enabled,
    staleTime: 60_000,
  });
}

export function useCalendarSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<T.CalendarSettings>) => request<T.CalendarSettings>("PUT", "/api/calendar/settings", b),
    onSuccess: (data) => {
      qc.setQueryData(keys.calSettings, data);
      invalidateCalendar(qc);
    },
  });
}

// --- Events ---
export function useEventMutations() {
  const qc = useQueryClient();
  const inv = () => invalidateCalendar(qc);
  return {
    create: useMutation({ mutationFn: (b: EventInput) => api.post<T.CalEvent>("/api/calendar/events", b), onSuccess: inv }),
    /** Copy an event onto the same calendar, at the same time, so it can be moved. */
    duplicate: useMutation({ mutationFn: (id: string) => api.post<T.CalEvent>(`${eventPath(id)}/duplicate`), onSuccess: inv }),
    /** `scope` rides as a query param, per the recurring-event contract. */
    update: useMutation({
      mutationFn: ({ id, scope, ...b }: EventInput & { id: string; scope?: EventScope }) => api.patch<T.CalEvent>(`${eventPath(id)}${qs({ scope })}`, b),
      onSuccess: inv,
    }),
    remove: useMutation({
      mutationFn: ({ id, scope }: { id: string; scope?: EventScope }) => api.del<{ ok: boolean }>(`${eventPath(id)}${qs({ scope })}`),
      onSuccess: inv,
    }),
    rsvp: useMutation({ mutationFn: ({ id, rsvp }: { id: string; rsvp: T.Rsvp }) => api.post<T.CalEvent>(`${eventPath(id)}/rsvp`, { rsvp }), onSuccess: inv }),
    /** Todos: `date` marks one occurrence of a repeating todo done. */
    setDone: useMutation({ mutationFn: ({ id, done, date }: { id: string; done: boolean; date?: string }) => api.post<T.CalEvent>(`${eventPath(id)}/done`, { done, date }), onSuccess: inv }),
  };
}

/** Turn an email into a half-filled event. Returns the prefill; it does not create anything. */
export function useEventFromThread() {
  return useMutation({ mutationFn: (thread_id: string) => api.post<EventPrefill>("/api/calendar/events/from-thread", { thread_id }) });
}

// --- Days (label + cover art) ---
/** The photo library — every picture stuck on a day, newest first, so one can be reused. */
export function useDayCovers(enabled = true) {
  return useQuery({ queryKey: keys.dayCovers, queryFn: () => api.get<T.DayCover[]>("/api/calendar/covers"), enabled, staleTime: 60_000 });
}

export function useDayCoverMutations() {
  const qc = useQueryClient();
  const inv = () => {
    qc.invalidateQueries({ queryKey: keys.dayCovers });
    invalidateCalendar(qc);
  };
  return {
    /** Downscales in the browser, then posts the raw bytes — no multipart, no base64. */
    upload: useMutation({
      mutationFn: async (file: File) => {
        const { prepareCover } = await import("@/lib/image");
        const img = await prepareCover(file);
        const res = await fetch("/api/calendar/covers", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": img.type,
            "x-image-width": String(img.width),
            "x-image-height": String(img.height),
            "x-image-name": encodeURIComponent(file.name).slice(0, 120),
          },
          body: img.blob,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new ApiError(res.status, humanize((data as T.ApiError | null)?.error || "upload failed"));
        return data as T.DayCover;
      },
      onSuccess: inv,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del<{ ok: boolean }>(`/api/calendar/covers/${id}`), onSuccess: inv }),
  };
}

export function useCalendarDayMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ date, ...b }: { date: string; label?: string; cover_url?: string; cover_id?: string | null; cover_position?: string }) =>
      request<T.CalendarDay>("PUT", `/api/calendar/days/${date}`, b),
    onSuccess: (data, v) => {
      qc.setQueryData(keys.calDay(v.date), data);
      invalidateCalendar(qc);
    },
  });
}

