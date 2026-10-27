// What each kind of AI call is called on the AI Usage page. The key is the `feature` a call is recorded under (see ai/metering.ts).
export const AI_FEATURES: Record<string, string> = {
  chat: "Assistant chat",
  reply: "Reply drafts",
  complete: "Finishing sentences in a reply",
  summary: "Thread summaries",
  gist: "One-line summaries",
  search: "Search (requests, answers, overviews)",
  catchup: "Catch-up on a thread",
  brief: "Daily brief",
  digest: "Feed digest",
  screener: "Screener suggestions",
  jev_screener: "Screener suggestions (Jev)",
  jev_phishing: "Phishing check (Jev)",
  jev_checks: "Quick checks (Jev)",
  contacts: "Contact review",
  actions: "Events and to-dos",
  agents: "Mail agents",
  workflows: "Workflows (drafts and AI conditions)",
  rescue: "Move to Imbox offers",
  vacation: "Away notices",
  learn: "Learning from your mail",
  other: "Other",
};

// Finishing a sentence needs a few letters to go on, enough for a greeting like "Dear Ram".
export const MIN_COMPLETE_CHARS = 4;

export const aiFeatureName = (key: string): string => AI_FEATURES[key] ?? key;
