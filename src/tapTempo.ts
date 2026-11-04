import { clampTempo } from "./settings";

// Taps further apart than this start a new sequence.
export const TAP_TIMEOUT_MS = 2000;
// The tempo is taken from at most this many of the latest intervals.
export const TAP_INTERVALS = 4;

export interface TapResult {
  // Tap times of the current sequence, oldest first; pass back in with the next tap.
  taps: number[];
  // Tempo in BPM, or null when the sequence has only one tap.
  tempo: number | null;
}

// Adds a tap at `now` (milliseconds) to the sequence `taps` and computes the tempo:
// 60 / the mean of the last up to TAP_INTERVALS intervals, rounded and clamped to the tempo range.
export function tapTempo(taps: readonly number[], now: number): TapResult {
  const last = taps.at(-1);
  const sequence = last === undefined || now - last > TAP_TIMEOUT_MS || now < last ? [now] : [...taps, now];
  const kept = sequence.slice(-(TAP_INTERVALS + 1));
  if (kept.length < 2) return { taps: kept, tempo: null };
  const meanMs = (kept[kept.length - 1] - kept[0]) / (kept.length - 1);
  // A zero mean gives Infinity, which clamps to the maximum tempo.
  return { taps: kept, tempo: clampTempo(Math.round(60000 / meanMs)) };
}
