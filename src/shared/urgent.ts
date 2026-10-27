// Paperwork (receipts, notices, statements) is mostly noise, but now and then it demands something: a deadline, a payment problem, a
// dispute. This is the plain-text test for that, shared by the server (the daily brief, the thread page) and the Paper Trail's own list.
const URGENT =
  /\b(within \d+ (?:business |working |calendar )?days|deadline|due (?:on|by|date)|by (?:eod|end of)|action required|respond (?:by|within)|reply (?:by|within)|please (?:send|submit|provide|respond|reply|confirm|sign|approve)|payment (?:failed|declined|overdue|due)|overdue|final notice|dispute|chargeback|suspen(?:d|sion)|terminat(?:e|ion)|expires?|urgent|immediately)\b/i;

export interface UrgentSource {
  text_body?: string | null;
  html_body?: string | null;
  is_from_me?: boolean;
}

/** Whether one message reads like it demands a response. */
export function messageLooksUrgent(m: UrgentSource): boolean {
  if (m.is_from_me) return false;
  return URGENT.test((m.text_body || m.html_body || "").replace(/<[^>]*>/g, " ").slice(0, 8000));
}

/** Whether the latest incoming messages of a thread do. */
export function looksUrgent(messages: UrgentSource[]): boolean {
  return messages.filter((m) => !m.is_from_me).slice(-2).some(messageLooksUrgent);
}
