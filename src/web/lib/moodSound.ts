import { notifySoundEnabled } from "./notifications";
import type { Mood } from "../api";

/**
 * A short sound for each mood, made with the Web Audio API so no audio files ship. Each one follows the face on its button:
 * loved climbs three bright notes, happy two soft ones, meh stays flat and low, sad steps down. They obey the same sound setting as
 * the new-mail chime, and stay quiet when the browser has not allowed audio yet.
 */
let ctx: AudioContext | null = null;

const NOTES: Record<Mood, { f: number; at: number; len: number; type: OscillatorType; vol: number }[]> = {
  loved: [
    { f: 523.25, at: 0, len: 0.16, type: "sine", vol: 0.1 },
    { f: 659.25, at: 0.08, len: 0.16, type: "sine", vol: 0.1 },
    { f: 783.99, at: 0.16, len: 0.3, type: "triangle", vol: 0.09 },
  ],
  happy: [
    { f: 523.25, at: 0, len: 0.16, type: "sine", vol: 0.09 },
    { f: 659.25, at: 0.1, len: 0.28, type: "sine", vol: 0.09 },
  ],
  meh: [
    { f: 329.63, at: 0, len: 0.2, type: "sine", vol: 0.07 },
    { f: 311.13, at: 0.14, len: 0.24, type: "sine", vol: 0.06 },
  ],
  sad: [
    { f: 392, at: 0, len: 0.2, type: "sine", vol: 0.08 },
    { f: 311.13, at: 0.15, len: 0.4, type: "sine", vol: 0.08 },
  ],
};

export function playMoodSound(mood: Mood) {
  if (typeof window === "undefined" || !notifySoundEnabled()) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!ctx) ctx = new Ctx();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    for (const n of NOTES[mood]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.f, t0 + n.at);
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(n.vol, t0 + n.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.len + 0.02);
    }
  } catch {
    // The browser has not allowed audio yet, or there is no audio device: stay quiet.
  }
}
