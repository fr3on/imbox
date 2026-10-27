export type Step = "choose" | "setup" | "appearance" | "done";

export type ProviderMode = "stalwart" | "imap";

export const STEPS: { id: Step; label: string }[] = [
  { id: "choose", label: "Provider" },
  { id: "setup", label: "Setup" },
  { id: "appearance", label: "Appearance" },
  { id: "done", label: "Ready" },
];

export const STEP_INDEX: Record<Step, number> = {
  choose: 0,
  setup: 1,
  appearance: 2,
  done: 3,
};
