export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: number } | { kind: "error"; message: string };

export const AUTOSAVE_DELAY = 1800;

export function savedLabel(s: SaveState, now: number): string {
  if (s.kind === "saving") return "Saving…";
  if (s.kind === "error") return "Couldn't save draft";
  if (s.kind === "saved") {
    const secs = Math.round((now - s.at) / 1000);
    if (secs < 8) return "Saved";
    if (secs < 60) return `Saved ${secs}s ago`;
    return `Saved ${Math.round(secs / 60)}m ago`;
  }
  return "";
}
