/** What the assistant offers to start with, for the page the person is on. */
export interface Suggestions {
  suggestions: { label: string; prompt: string }[];
  emptyCards: { title: string; desc: string; prompt: string }[];
}

export function suggestionsFor(path: string, hasContext: boolean): Suggestions {
  const isThread = hasContext || path.startsWith("/t/");
  const isCalendar = path.startsWith("/calendar");
  const isContacts = path.startsWith("/contacts");
  const isScreener = path.startsWith("/screener");
  const isFeed = path.startsWith("/updates") || path.startsWith("/feed") || path.startsWith("/paper-trail");

  if (isThread) {
    return {
      suggestions: [
        { label: "What is the deadline?", prompt: "What are the deadlines or asks for me in this thread?" },
        { label: "Catch me up", prompt: "Catch me up on what changed in this thread." },
        { label: "Draft a reply", prompt: "Draft a reply to this email." },
        { label: "Reply briefly", prompt: "Draft a brief reply to this email." },
        { label: "Summarize", prompt: "Summarise this thread and tell me what, if anything, it needs from me." },
      ],
      emptyCards: [
        { title: "What is the deadline?", desc: "Find asks, deadlines and next steps in this thread", prompt: "What are the deadlines or asks for me in this thread?" },
        { title: "Catch me up", desc: "Summarize recent messages and agreements", prompt: "Catch me up on what changed in this thread." },
        { title: "Draft a reply", desc: "Compose a response in your voice", prompt: "Draft a reply to this email." },
        { title: "Summarize thread", desc: "Key points, decisions and questions", prompt: "Summarise this thread and tell me what it needs from me." },
      ],
    };
  }
  if (isCalendar) {
    return {
      suggestions: [
        { label: "What is on tomorrow?", prompt: "What is on my calendar tomorrow?" },
        { label: "Today's schedule", prompt: "What meetings and events do I have today?" },
        { label: "Find free time", prompt: "Find free time for a 30-minute meeting this week." },
        { label: "Propose event", prompt: "Propose an event for " },
      ],
      emptyCards: [
        { title: "What is on tomorrow?", desc: "Check tomorrow's schedule and meetings", prompt: "What is on my calendar tomorrow?" },
        { title: "Today's schedule", desc: "See your upcoming agenda today", prompt: "What meetings and events do I have today?" },
        { title: "Find free time", desc: "Find open meeting slots this week", prompt: "Find free time for a 30-minute meeting this week." },
        { title: "Schedule meeting", desc: "Propose a new calendar event", prompt: "Propose an event for " },
      ],
    };
  }
  if (isContacts) {
    return {
      suggestions: [
        { label: "Which senders are noisy?", prompt: "Which senders are noisy?" },
        { label: "Misfiled senders", prompt: "Are there any misfiled senders in my mail?" },
        { label: "Bundle a sender", prompt: "Bundle senders from " },
        { label: "Set destination", prompt: "Set contact destination for " },
      ],
      emptyCards: [
        { title: "Which senders are noisy?", desc: "Find high-volume senders in Imbox", prompt: "Which senders are noisy?" },
        { title: "Misfiled senders", desc: "AI recommendations for sender destinations", prompt: "Are there any misfiled senders in my mail?" },
        { title: "Bundle a sender", desc: "Group newsletters or notifications together", prompt: "Bundle senders from " },
        { title: "Change destination", desc: "Route a contact to Feed", prompt: "Set contact destination for " },
      ],
    };
  }
  if (isScreener) {
    return {
      suggestions: [
        { label: "Who is waiting?", prompt: "Who is waiting in the Screener?" },
        { label: "Recommend decisions", prompt: "Check the Screener and recommend where each waiting sender belongs." },
        { label: "What needs me today?", prompt: "What needs me today?" },
        { label: "Summarize unread", prompt: "Summarise my unread mail" },
      ],
      emptyCards: [
        { title: "Who is waiting?", desc: "Check senders waiting for approval", prompt: "Who is waiting in the Screener?" },
        { title: "Recommend decisions", desc: "Get AI recommendations for waiting senders", prompt: "Check the Screener and recommend where each waiting sender belongs." },
        { title: "What needs me today?", desc: "Priority emails and schedule brief", prompt: "What needs me today?" },
        { title: "Summarize unread", desc: "Get a quick digest of key messages", prompt: "Summarise my unread mail" },
      ],
    };
  }
  if (isFeed) {
    return {
      suggestions: [
        { label: "Summarize Feed", prompt: "Summarise recent newsletters in my Feed" },
        { label: "What needs me today?", prompt: "What needs me today?" },
        { label: "Find receipts", prompt: "Search recent receipts and invoices in Feed" },
        { label: "Misfiled senders", prompt: "Are there any misfiled senders in my mail?" },
      ],
      emptyCards: [
        { title: "Summarize Feed", desc: "Quick highlights of recent newsletters", prompt: "Summarise recent newsletters in my Feed" },
        { title: "What needs me today?", desc: "Check priority emails and today's schedule", prompt: "What needs me today?" },
        { title: "Find receipts", desc: "Look up invoices and statements", prompt: "Search recent receipts and invoices in Feed" },
        { title: "Misfiled senders", desc: "Senders that might belong elsewhere", prompt: "Are there any misfiled senders in my mail?" },
      ],
    };
  }
  // Default Imbox
  return {
    suggestions: [
      { label: "What needs me today?", prompt: "What needs me today?" },
      { label: "Review Screener", prompt: "Anything waiting in the Screener?" },
      { label: "Deadlines this week", prompt: "What are my deadlines and to-dos for this week?" },
      { label: "Summarize unread", prompt: "Summarise my unread mail" },
      { label: "Draft a reply", prompt: "Draft a reply to the latest email from " },
    ],
    emptyCards: [
      { title: "What needs me today?", desc: "Priority emails waiting for replies & daily brief", prompt: "What needs me today?" },
      { title: "Review Screener", desc: "Check senders waiting for approval", prompt: "Anything waiting in the Screener?" },
      { title: "Deadlines this week", desc: "Deadlines, asks and to-dos due this week", prompt: "What are my deadlines and to-dos for this week?" },
      { title: "Summarize unread", desc: "Get a quick digest of key messages", prompt: "Summarise my unread mail" },
    ],
  };
}
