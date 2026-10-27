/**
 * Finding the "join the call" link on a calendar event. Calendars put it in different places: Google's own field,
 * the location, or a line in the description, and Google often wraps links in a google.com/url redirect. The worker uses
 * this when it reads a feed, and the browser uses it again on stored events, so ones synced before this existed work too.
 */

const HOSTS = [
  "meet\\.google\\.com",
  "zoom\\.us",
  "zoom\\.com",
  "teams\\.microsoft\\.com",
  "teams\\.live\\.com",
  "webex\\.com",
  "meet\\.jit\\.si",
  "whereby\\.com",
  "chime\\.aws",
  "gotomeet\\.me",
  "gotomeeting\\.com",
].join("|");

const CONF_RE = new RegExp(`https?://(?:[\\w-]+\\.)*(?:${HOSTS})/[^\\s<>"']+`, "i");
const GOOGLE_REDIRECT = /https?:\/\/(?:www\.)?google\.com\/url\?[^\s<>"']*?\bq=([^&\s<>"']+)[^\s<>"']*/gi;
const TAIL = /[.,;:!?)\]}>]+$/;

/** The first video-call link in a piece of text, or "". */
export function meetingLinkIn(text: string | null | undefined): string {
  if (!text) return "";
  const unwrapped = text.replace(GOOGLE_REDIRECT, (_m, q: string) => {
    try {
      return decodeURIComponent(q);
    } catch {
      return q;
    }
  });
  const m = CONF_RE.exec(unwrapped);
  return m ? m[0].replace(TAIL, "") : "";
}

/** The link to show behind a Join button: the event's own conference field first, then anything that looks like one. */
export function meetingLink(ev: { conference_url?: string | null; location?: string | null; description?: string | null; url?: string | null }): string {
  const direct = (ev.conference_url ?? "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  return meetingLinkIn(ev.location) || meetingLinkIn(ev.description) || meetingLinkIn(ev.url);
}
